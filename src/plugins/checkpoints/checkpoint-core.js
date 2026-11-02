/**
 * Checkpoints: storage and transfer, without scheduling or hub access.
 *
 * A checkpoint folder is a ready image of the competition (see OWLCMS compliance/150):
 *   <folder>/database_v2_<stamp>.json   latest export only
 *   <folder>/logs/                      latest copy of every log file
 *   <folder>/zips/<OWLCMS time>.zip     every checkpoint, as received
 */

import AdmZip from 'adm-zip';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve, sep } from 'node:path';

export const ZIPS_DIR = 'zips';
const PENDING_DIR = '.pending';
const PART_SUFFIX = '.part';

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

function inspectEntries(zip) {
	let entries;
	try {
		entries = zip.getEntries();
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
	return { ok: true, entries, exports };
}

/**
 * Checks a received checkpoint before anything is written.
 *
 * @returns {{ ok: true, zip: AdmZip, exports: string[] } | { ok: false, reason: string }}
 */
export function inspectCheckpoint(buffer) {
	let zip;
	try {
		zip = new AdmZip(buffer);
	} catch (error) {
		return { ok: false, reason: `not a complete zip: ${error.message}` };
	}
	const inspected = inspectEntries(zip);
	if (!inspected.ok) return inspected;
	try {
		// reading every entry catches a zip truncated after its central directory was parsed
		for (const entry of inspected.entries) {
			if (!entry.isDirectory) entry.getData();
		}
	} catch (error) {
		return { ok: false, reason: `not a complete zip: ${error.message}` };
	}
	return { ok: true, zip, exports: inspected.exports };
}

/** Writes through a temporary name that does not end in .json or .zip, then renames. */
function writeAtomically(target, data) {
	mkdirSync(dirname(target), { recursive: true });
	const temporary = `${target}.${process.pid}.part`;
	writeFileSync(temporary, data);
	renameSync(temporary, target);
}

function pendingArchiveName(file) {
	if (!file.endsWith(PART_SUFFIX)) return null;
	const name = file.slice(0, -PART_SUFFIX.length);
	return isCheckpointName(name) ? name : null;
}

function pendingArchives(folder) {
	const dir = join(folder, ZIPS_DIR);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.map((file) => ({ file, name: pendingArchiveName(file) }))
		.filter(({ name }) => name !== null)
		.sort((a, b) => a.name.localeCompare(b.name));
}

function removeIfEmpty(path) {
	if (existsSync(path) && readdirSync(path).length === 0) {
		rmSync(path, { recursive: true });
	}
}

function pendingDirectory(root) {
	return join(root, ZIPS_DIR, PENDING_DIR);
}

function discardPending(root, partPath) {
	rmSync(pendingDirectory(root), { recursive: true, force: true });
	rmSync(partPath, { force: true });
	removeIfEmpty(join(root, ZIPS_DIR));
}

function stageArchive(root, buffer) {
	let zip;
	try {
		zip = new AdmZip(buffer);
	} catch (error) {
		return { outcome: 'invalid', message: `not a complete zip: ${error.message}` };
	}
	const inspected = inspectEntries(zip);
	if (!inspected.ok) {
		return { outcome: 'invalid', message: inspected.reason };
	}

	const pending = pendingDirectory(root);
	rmSync(pending, { recursive: true, force: true });
	try {
		for (const entry of inspected.entries) {
			if (entry.isDirectory) continue;
			let data;
			try {
				data = entry.getData();
			} catch (error) {
				rmSync(pending, { recursive: true, force: true });
				return { outcome: 'invalid', message: `not a complete zip: ${error.message}` };
			}
			writeAtomically(resolve(pending, entry.entryName), data);
		}
	} catch (error) {
		rmSync(pending, { recursive: true, force: true });
		return { outcome: 'local-error', message: `cannot extract the checkpoint: ${error.message}` };
	}
	return {
		outcome: 'staged',
		exports: inspected.exports,
		files: [...new Set(inspected.entries.filter((entry) => !entry.isDirectory).map((entry) => entry.entryName))]
	};
}

function moveStagedFile(root, name) {
	const pending = resolve(pendingDirectory(root));
	const source = resolve(pending, name);
	const target = resolve(root, name);
	if (!source.startsWith(pending + sep) || !target.startsWith(root + sep)) {
		throw new Error(`entry outside the checkpoint: ${name}`);
	}
	mkdirSync(dirname(target), { recursive: true });
	renameSync(source, target);
}

function completePendingArchive(folder, name, partPath, buffer = null) {
	const root = resolve(folder);
	const finalPath = join(root, ZIPS_DIR, name);
	if (existsSync(finalPath)) {
		discardPending(root, partPath);
		return { outcome: 'stored', name, bytes: statSync(finalPath).size, recovered: true };
	}

	let archive;
	try {
		archive = buffer ?? readFileSync(partPath);
	} catch (error) {
		return { outcome: 'local-error', message: `cannot read pending checkpoint ${name}: ${error.message}` };
	}
	const staged = stageArchive(root, archive);
	if (staged.outcome === 'invalid') {
		discardPending(root, partPath);
		return { outcome: 'discarded', message: `discarded incomplete checkpoint ${name}: ${staged.message}` };
	}
	if (staged.outcome === 'local-error') {
		return staged;
	}

	try {
		// Publish the database first. It remains usable even if merging the logs fails.
		for (const file of staged.exports) {
			moveStagedFile(root, file);
		}
		for (const file of staged.files) {
			if (!staged.exports.includes(file)) {
				moveStagedFile(root, file);
			}
		}
		// Cleanup is deliberately last: until this succeeds, both the old and new databases remain loadable.
		for (const file of readdirSync(root)) {
			if (file.endsWith('.json') && !staged.exports.includes(file) && statSync(join(root, file)).isFile()) {
				rmSync(join(root, file));
			}
		}
		rmSync(pendingDirectory(root), { recursive: true });
		const bytes = statSync(partPath).size;
		renameSync(partPath, finalPath);
		return { outcome: 'stored', name, bytes, recovered: buffer === null };
	} catch (error) {
		rmSync(pendingDirectory(root), { recursive: true, force: true });
		return { outcome: 'local-error', message: `cannot apply checkpoint ${name}: ${error.message}` };
	}
}

/** Stores and applies a checkpoint, leaving its cursor unfinished until the complete image has been updated. */
export function storeCheckpoint(folder, name, buffer) {
	if (!isCheckpointName(name)) {
		return { outcome: 'discarded', message: `unexpected checkpoint name: ${name}` };
	}
	const root = resolve(folder);
	const partPath = join(root, ZIPS_DIR, `${name}${PART_SUFFIX}`);
	try {
		mkdirSync(dirname(partPath), { recursive: true });
		writeFileSync(partPath, buffer);
	} catch (error) {
		rmSync(partPath, { force: true });
		removeIfEmpty(join(root, ZIPS_DIR));
		return { outcome: 'local-error', message: `cannot save checkpoint ${name}: ${error.message}` };
	}
	return completePendingArchive(root, name, partPath, buffer);
}

/**
 * Finishes checkpoints interrupted before their .part archive was marked complete.
 * A corrupt archive is discarded; a local filesystem failure is retained for another retry.
 */
export function recoverPendingCheckpoints(folder) {
	if (!folder || !existsSync(folder)) return { outcome: 'none' };
	let recovered = null;
	const discarded = [];
	for (const pending of pendingArchives(folder)) {
		const result = completePendingArchive(folder, pending.name, join(folder, ZIPS_DIR, pending.file));
		if (result.outcome === 'local-error') return result;
		if (result.outcome === 'discarded') {
			discarded.push(result.message);
		} else if (result.outcome === 'stored') {
			recovered = result;
		}
	}
	if (recovered) return recovered;
	if (discarded.length > 0) return { outcome: 'discarded', message: discarded.join('; ') };
	rmSync(pendingDirectory(resolve(folder)), { recursive: true, force: true });
	return { outcome: 'none' };
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
 *   | { outcome: 'local-error', message: string }
 *   | { outcome: 'refused', status: number, message: string }>}
 */
export async function pullCheckpoint({ owlcmsUrl, secret, folder, fetchImpl = fetch, timeoutMs = 120000 }) {
	const recovered = recoverPendingCheckpoints(folder);
	if (recovered.outcome === 'stored' || recovered.outcome === 'local-error') {
		return recovered;
	}

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
	const stored = storeCheckpoint(folder, name, buffer);
	if (stored.outcome === 'discarded') {
		return { outcome: 'unreachable', message: stored.message };
	}
	return stored;
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
