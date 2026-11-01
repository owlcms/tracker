/**
 * Checkpoints: storage and transfer, without scheduling or hub access.
 *
 * A checkpoint folder is a ready image of the competition (see OWLCMS compliance/150):
 *   <folder>/database_v2_<stamp>.json   latest export only
 *   <folder>/logs/                      latest copy of every log file
 *   <folder>/zips/<OWLCMS time>.zip     every checkpoint, as received
 */

import AdmZip from 'adm-zip';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve, sep } from 'node:path';

export const ZIPS_DIR = 'zips';

/** OWLCMS names checkpoints with its UTC time, colon-free: 2026-10-31T20-37-42.123Z.zip */
const CHECKPOINT_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.zip$/;

/** Folder names a user may create: one path segment, valid on Windows, macOS and Linux. */
const FORBIDDEN_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;

export function isCheckpointName(name) {
	return typeof name === 'string' && CHECKPOINT_NAME.test(name);
}

/** @returns the file name of a Content-Disposition header, or null */
export function dispositionFileName(header) {
	if (!header) return null;
	const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
	return match ? decodeURIComponent(match[1].trim()) : null;
}

/** @returns the checkpoint names in zips/, oldest first */
export function listCheckpoints(folder) {
	const dir = join(folder, ZIPS_DIR);
	if (!existsSync(dir)) return [];
	return readdirSync(dir).filter(isCheckpointName).sort();
}

/** @returns the newest checkpoint name in the folder's zips/, or null: the next `since` */
export function newestCheckpoint(folder) {
	const zips = listCheckpoints(folder);
	return zips.length > 0 ? zips[zips.length - 1] : null;
}

export function folderSummary(folder) {
	if (!folder || !existsSync(folder)) {
		return { exists: false, zipCount: 0, newest: null };
	}
	const zips = listCheckpoints(folder);
	return { exists: true, zipCount: zips.length, newest: zips.length > 0 ? zips[zips.length - 1] : null };
}

function isSafeEntryName(name) {
	if (!name || name.startsWith('/') || name.startsWith('\\') || /^[a-zA-Z]:/.test(name) || name.includes('\\')) {
		return false;
	}
	return !name.split('/').some((segment) => segment === '..');
}

/**
 * Checks a received checkpoint before anything is written.
 *
 * @returns {{ ok: true, zip: AdmZip, exports: string[] } | { ok: false, reason: string }}
 */
export function inspectCheckpoint(buffer) {
	let entries;
	let zip;
	try {
		zip = new AdmZip(buffer);
		entries = zip.getEntries();
		// reading every entry catches a zip truncated after its central directory was parsed
		for (const entry of entries) {
			if (!entry.isDirectory) entry.getData();
		}
	} catch (error) {
		return { ok: false, reason: `not a complete zip: ${error.message}` };
	}
	const unsafe = entries.find((entry) => !isSafeEntryName(entry.entryName));
	if (unsafe) {
		return { ok: false, reason: `entry outside the checkpoint: ${unsafe.entryName}` };
	}
	const exports = entries
		.filter((entry) => !entry.isDirectory && !entry.entryName.includes('/') && entry.entryName.endsWith('.json'))
		.map((entry) => entry.entryName);
	if (exports.length === 0) {
		return { ok: false, reason: 'no export (.json) in the checkpoint' };
	}
	return { ok: true, zip, exports };
}

/** Writes through a temporary name that does not end in .json or .zip, then renames. */
function writeAtomically(target, data) {
	mkdirSync(dirname(target), { recursive: true });
	const temporary = `${target}.${process.pid}.part`;
	writeFileSync(temporary, data);
	renameSync(temporary, target);
}

/**
 * Stores a checked checkpoint: the zip into zips/ under the name OWLCMS sent, then unpacked over the folder.
 * Older exports are removed so the folder keeps a single .json, the latest.
 */
export function storeCheckpoint(folder, name, buffer, inspected) {
	if (!isCheckpointName(name)) {
		throw new Error(`unexpected checkpoint name: ${name}`);
	}
	const root = resolve(folder);
	writeAtomically(join(root, ZIPS_DIR, name), buffer);
	for (const entry of inspected.zip.getEntries()) {
		if (entry.isDirectory) continue;
		const target = resolve(root, entry.entryName);
		if (!target.startsWith(root + sep)) {
			throw new Error(`entry outside the checkpoint: ${entry.entryName}`);
		}
		writeAtomically(target, entry.getData());
	}
	for (const file of readdirSync(root)) {
		if (file.endsWith('.json') && !inspected.exports.includes(file) && statSync(join(root, file)).isFile()) {
			rmSync(join(root, file));
		}
	}
}

function refusalMessage(status) {
	switch (status) {
		case 401:
			return 'OWLCMS refused the secret (missing or wrong token or PIN)';
		case 403:
			return 'OWLCMS refused access (role or address not allowed)';
		case 429:
			return 'OWLCMS is refusing attempts after repeated failures';
		default:
			return `OWLCMS refused the request (HTTP ${status})`;
	}
}

/** fetch reports "fetch failed"; the cause (an AggregateError when several addresses were tried) says why. */
function networkError(error) {
	if (error.name === 'AbortError') return 'no answer from OWLCMS (timed out)';
	const cause = error.cause;
	const code = cause?.code || cause?.errors?.find((e) => e?.code)?.code;
	return code ? `cannot reach OWLCMS (${code})` : cause?.message || error.message;
}

export function checkpointUrl(owlcmsUrl, since) {
	const base = owlcmsUrl.includes('://') ? owlcmsUrl : `http://${owlcmsUrl}`;
	const url = new URL('/competition/checkpoint', base);
	if (since) url.searchParams.set('since', since);
	return url;
}

/**
 * Pulls one checkpoint from OWLCMS and stores it.
 *
 * Unreachable outcomes (no response, 5xx, incomplete or unexpected zip) are retried by the caller. Refused outcomes
 * (400, 401, 403, 429) are not: OWLCMS counts wrong secrets with the officials PIN logins, so retrying would keep
 * the officials locked out.
 *
 * @param {object} p
 * @param {string} p.owlcmsUrl  base URL, e.g. http://owlcms.local:8080
 * @param {string} [p.secret]   account token or officials PIN, sent as a Bearer header
 * @param {string} p.folder     checkpoint folder
 * @returns {Promise<{ outcome: 'stored', name: string, bytes: number }
 *   | { outcome: 'unreachable', message: string }
 *   | { outcome: 'refused', status: number, message: string }>}
 */
export async function pullCheckpoint({ owlcmsUrl, secret, folder, fetchImpl = fetch, timeoutMs = 120000 }) {
	const url = checkpointUrl(owlcmsUrl, newestCheckpoint(folder));
	const headers = secret ? { Authorization: `Bearer ${secret}` } : {};

	let response;
	let buffer = null;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		response = await fetchImpl(url, { headers, signal: controller.signal });
		if (response.status === 200) {
			buffer = Buffer.from(await response.arrayBuffer());
		}
	} catch (error) {
		return { outcome: 'unreachable', message: networkError(error) };
	} finally {
		clearTimeout(timer);
	}

	if ([400, 401, 403, 429].includes(response.status)) {
		return { outcome: 'refused', status: response.status, message: refusalMessage(response.status) };
	}
	if (response.status !== 200) {
		return { outcome: 'unreachable', message: `HTTP ${response.status}` };
	}
	const name = dispositionFileName(response.headers.get('content-disposition'));
	if (!isCheckpointName(name)) {
		return { outcome: 'unreachable', message: `unexpected checkpoint name: ${name}` };
	}
	const inspected = inspectCheckpoint(buffer);
	if (!inspected.ok) {
		return { outcome: 'unreachable', message: inspected.reason };
	}
	storeCheckpoint(folder, name, buffer, inspected);
	return { outcome: 'stored', name, bytes: buffer.length };
}

/** @returns the sub-folders of a folder, for the folder picker; hidden folders are left out */
export function listFolders(path) {
	const dir = resolve(path);
	const folders = readdirSync(dir, { withFileTypes: true })
		.filter((entry) => !entry.name.startsWith('.'))
		.filter((entry) => {
			if (entry.isDirectory()) return true;
			if (!entry.isSymbolicLink()) return false;
			try {
				return statSync(join(dir, entry.name)).isDirectory();
			} catch {
				return false;
			}
		})
		.map((entry) => entry.name)
		.sort((a, b) => a.localeCompare(b));
	const parent = dirname(dir);
	return { path: dir, parent: parent === dir ? null : parent, root: parse(dir).root, folders };
}

export function isValidFolderName(name) {
	return (
		typeof name === 'string' &&
		name.trim() === name &&
		name.length > 0 &&
		name !== '.' &&
		name !== '..' &&
		!name.endsWith('.') &&
		!FORBIDDEN_NAME_CHARS.test(name)
	);
}

/** Creates one folder inside parent; @returns its path */
export function createFolder(parent, name) {
	if (!isValidFolderName(name)) {
		throw new Error(`not a valid folder name: ${name}`);
	}
	const target = join(resolve(parent), name);
	if (existsSync(target)) {
		throw new Error(`already exists: ${target}`);
	}
	mkdirSync(target);
	return target;
}
