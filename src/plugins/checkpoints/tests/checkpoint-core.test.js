import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	checkpointUrl,
	createFolder,
	dispositionFileName,
	folderSummary,
	inspectCheckpoint,
	isValidFolderName,
	listFolders,
	newestCheckpoint,
	pullCheckpoint
} from '../checkpoint-core.js';

const FIRST = '2026-11-01T12-30-44.783Z.zip';
const SECOND = '2026-11-01T12-30-46.860Z.zip';

function checkpointZip(files) {
	const zip = new AdmZip();
	for (const [name, content] of Object.entries(files)) {
		zip.addFile(name, Buffer.from(content));
	}
	return zip.toBuffer();
}

/** adm-zip cleans `..` out of names it adds; a hostile server would not, so the name bytes are rewritten. */
function zipWithRawName(placeholder, rawName) {
	const zip = new AdmZip();
	zip.addFile('database_v2_x.json', Buffer.from('{}'));
	zip.addFile(placeholder, Buffer.from('x'));
	return Buffer.from(zip.toBuffer().toString('latin1').split(placeholder).join(rawName), 'latin1');
}

function okResponse(buffer, name) {
	return new Response(buffer, {
		status: 200,
		headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}"` }
	});
}

describe('checkpoint core', () => {
	let folder;

	beforeEach(() => {
		folder = mkdtempSync(join(tmpdir(), 'checkpoints-'));
	});

	afterEach(() => {
		rmSync(folder, { recursive: true, force: true });
	});

	it('stores the zip as received and unpacks it into a ready image with a single export', async () => {
		const first = checkpointZip({
			'database_v2_2026-11-01_07h30.json': '{"v":1}',
			'logs/owlcms.log': 'one',
			'logs/audit/A_sealed_2026-11-01T12-30-30.641Z.log': 'sealed'
		});
		const second = checkpointZip({ 'database_v2_2026-11-01_07h31.json': '{"v":2}', 'logs/owlcms.log': 'one two' });
		const requests = [];
		const responses = [okResponse(first, FIRST), okResponse(second, SECOND)];
		const fetchImpl = async (url, init) => {
			requests.push({ url: String(url), auth: init.headers.Authorization });
			return responses.shift();
		};

		expect(await pullCheckpoint({ owlcmsUrl: 'owlcms.local:8080', secret: '4821', folder, fetchImpl })).toMatchObject({
			outcome: 'stored',
			name: FIRST
		});
		expect(await pullCheckpoint({ owlcmsUrl: 'http://owlcms.local:8080', folder, fetchImpl })).toMatchObject({
			outcome: 'stored',
			name: SECOND
		});

		expect(requests[0]).toEqual({ url: 'http://owlcms.local:8080/competition/checkpoint', auth: 'Bearer 4821' });
		expect(requests[1].url).toBe(`http://owlcms.local:8080/competition/checkpoint?since=${encodeURIComponent(FIRST)}`);
		expect(requests[1].auth).toBeUndefined();

		expect(readdirSync(folder).filter((name) => name.endsWith('.json'))).toEqual(['database_v2_2026-11-01_07h31.json']);
		expect(readFileSync(join(folder, 'logs/owlcms.log'), 'utf8')).toBe('one two');
		expect(readFileSync(join(folder, 'logs/audit/A_sealed_2026-11-01T12-30-30.641Z.log'), 'utf8')).toBe('sealed');
		expect(readdirSync(join(folder, 'zips'))).toEqual([FIRST, SECOND]);
		expect(readFileSync(join(folder, 'zips', SECOND)).equals(second)).toBe(true);
		expect(newestCheckpoint(folder)).toBe(SECOND);
		expect(folderSummary(folder)).toEqual({ exists: true, zipCount: 2, newest: SECOND });
		const leftovers = readdirSync(folder, { recursive: true }).filter((name) => String(name).endsWith('.part'));
		expect(leftovers).toEqual([]);
	});

	it('classifies refusals, which are not retried, apart from failures to reach OWLCMS', async () => {
		for (const status of [400, 401, 403, 429]) {
			const result = await pullCheckpoint({
				owlcmsUrl: 'http://x',
				folder,
				fetchImpl: async () => new Response('', { status })
			});
			expect(result).toMatchObject({ outcome: 'refused', status });
		}
		const down = await pullCheckpoint({
			owlcmsUrl: 'http://x',
			folder,
			fetchImpl: async () => {
				throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
			}
		});
		expect(down).toEqual({ outcome: 'unreachable', message: 'cannot reach OWLCMS (ECONNREFUSED)' });
		const failing = await pullCheckpoint({ owlcmsUrl: 'http://x', folder, fetchImpl: async () => new Response('', { status: 500 }) });
		expect(failing.outcome).toBe('unreachable');
		expect(existsSync(join(folder, 'zips'))).toBe(false);
	});

	it('changes nothing when the zip is incomplete, misnamed, has no export, or reaches outside the folder', async () => {
		const good = checkpointZip({ 'database_v2_x.json': '{}', 'logs/owlcms.log': 'x' });
		const cases = [
			okResponse(good.subarray(0, good.length - 30), FIRST),
			okResponse(good, 'backup.zip'),
			okResponse(checkpointZip({ 'logs/owlcms.log': 'x' }), FIRST),
			okResponse(zipWithRawName('AAAescape.log', '../escape.log'), FIRST)
		];
		for (const response of cases) {
			const result = await pullCheckpoint({ owlcmsUrl: 'http://x', folder, fetchImpl: async () => response });
			expect(result.outcome).toBe('unreachable');
		}
		expect(readdirSync(folder)).toEqual([]);
	});

	it('rejects entries that are absolute or climb out of the folder', () => {
		expect(inspectCheckpoint(zipWithRawName('logs/AAAAAAetc/passwd', 'logs/../../etc/passwd'))).toMatchObject({
			ok: false
		});
		expect(inspectCheckpoint(zipWithRawName('Aetc/passwd', '/etc/passwd'))).toMatchObject({ ok: false });
		expect(inspectCheckpoint(zipWithRawName('logsAowlcms.log', 'logs\\owlcms.log'))).toMatchObject({ ok: false });
	});

	it('reads the name OWLCMS sends and builds the request', () => {
		expect(dispositionFileName(`attachment; filename="${FIRST}"`)).toBe(FIRST);
		expect(dispositionFileName(null)).toBeNull();
		expect(String(checkpointUrl('localhost:8080', null))).toBe('http://localhost:8080/competition/checkpoint');
		expect(String(checkpointUrl('https://owlcms.example.org', FIRST))).toBe(
			`https://owlcms.example.org/competition/checkpoint?since=${encodeURIComponent(FIRST)}`
		);
	});

	it('lists sub-folders without hidden ones and creates new folders with safe names only', () => {
		mkdirSync(join(folder, 'b'));
		mkdirSync(join(folder, 'a'));
		mkdirSync(join(folder, '.hidden'));
		writeFileSync(join(folder, 'file.txt'), 'x');
		const listed = listFolders(folder);
		expect(listed.folders).toEqual(['a', 'b']);
		expect(listed.parent).not.toBeNull();

		const created = createFolder(folder, 'Checkpoints 2026');
		expect(existsSync(created)).toBe(true);
		expect(() => createFolder(folder, 'Checkpoints 2026')).toThrow(/already exists/);
		for (const name of ['', '..', 'a/b', 'a\\b', 'x:', 'trailing.', ' padded']) {
			expect(isValidFolderName(name)).toBe(false);
		}
	});
});
