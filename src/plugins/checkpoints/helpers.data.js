/**
 * Checkpoints - server side.
 *
 * Pulls checkpoints from OWLCMS (/competition/checkpoint) into a checkpoint folder while started. The page drives it
 * through actions: status, save, start, stop, checkpoint, browse, mkdir. Settings and the started state are kept in this
 * plugin's config-override.json5, so a tracker restart resumes polling if it was started.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import JSON5 from 'json5';
import { competitionHub } from '$lib/server/competition-hub.js';
import { createFolder, folderSummary, listFolders, pullCheckpoint } from './checkpoint-core.js';
import { CheckpointRunner } from './checkpoint-runner.js';

const TAG = '[Checkpoints]';
const SETTINGS_KEYS = ['owlcmsUrl', 'secret', 'folder', 'intervalMinutes', 'started'];
const STATE_PATH = resolve(process.cwd(), 'src/plugins/checkpoints/config-override.json5');

function isFolder(path) {
	try {
		return !!path && statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function loadSaved() {
	if (!existsSync(STATE_PATH)) return {};
	try {
		const parsed = JSON5.parse(readFileSync(STATE_PATH, 'utf8'));
		const saved = {};
		for (const option of parsed?.options || []) {
			if (SETTINGS_KEYS.includes(option?.key)) saved[option.key] = option.default;
		}
		return saved;
	} catch (error) {
		console.warn(`${TAG} cannot read ${STATE_PATH}: ${error.message}`);
		return {};
	}
}

function save(runner) {
	const values = { ...runner.settings, started: runner.started };
	const payload = { options: SETTINGS_KEYS.map((key) => ({ key, default: values[key] })) };
	const header = '// Checkpoints settings, written by the plugin page. JSON5.\n';
	try {
		mkdirSync(dirname(STATE_PATH), { recursive: true });
		writeFileSync(STATE_PATH, `${header}${JSON.stringify(payload, null, 2)}\n`, 'utf8');
	} catch (error) {
		console.warn(`${TAG} cannot save ${STATE_PATH}: ${error.message}`);
	}
}

const runner = (globalThis.__checkpointRunner ??= createRunner());

function createRunner() {
	const created = new CheckpointRunner({
		pull: async (settings) => {
			const result = await pullCheckpoint(settings);
			if (result.outcome === 'stored') {
				console.log(`${TAG} stored ${result.name} (${result.bytes} bytes) in ${settings.folder}`);
			} else {
				console.warn(`${TAG} ${result.outcome}: ${result.message}`);
			}
			return result;
		},
		persist: save
	});
	const saved = loadSaved();
	created.settings = {
		...created.settings,
		...Object.fromEntries(Object.entries(saved).filter(([key, value]) => key !== 'started' && value != null))
	};
	created.started = saved.started === true;
	return created;
}

// Hub listeners, registered again if the hub was recreated (the OBS plugin does the same).
const onDatabase = () => runner.databaseReceived();

function ensureListeners() {
	if (!competitionHub.listeners('database:received').includes(onDatabase)) {
		competitionHub.on('database:received', onDatabase);
	}
}

ensureListeners();
if (runner.started && !globalThis.__checkpointRunnerResumed) {
	globalThis.__checkpointRunnerResumed = true;
	console.log(`${TAG} resuming checkpoints into ${runner.settings.folder}`);
	runner.resume();
}

function status() {
	return { success: true, ...runner.snapshot(), folder: folderSummary(runner.settings.folder) };
}

export function processData() {
	ensureListeners();
	return { checkpoints: status() };
}

export async function handleAction({ action, options = {} }) {
	ensureListeners();
	switch (action) {
		case 'status':
			return status();
		case 'save': {
			const result = runner.configure({
				owlcmsUrl: options.owlcmsUrl,
				secret: options.secret,
				folder: options.folder,
				intervalMinutes: options.intervalMinutes
			});
			return result.success ? status() : result;
		}
		case 'start': {
			const result = runner.start(isFolder);
			return result.success ? status() : result;
		}
		case 'stop':
			runner.stop();
			return status();
		case 'checkpoint': {
			const result = await runner.requestCheckpoint(isFolder);
			return result.success ? { ...status(), name: result.name } : result;
		}
		case 'browse': {
			const requested = options.path || homedir();
			const path = isFolder(requested) ? requested : homedir();
			try {
				return { success: true, ...listFolders(path) };
			} catch (error) {
				return { success: false, message: `Cannot list ${path}: ${error.message}` };
			}
		}
		case 'mkdir': {
			try {
				const created = createFolder(options.parent, options.name);
				return { success: true, created, ...listFolders(options.parent) };
			} catch (error) {
				return { success: false, message: error.message };
			}
		}
		default:
			return { success: false, message: `Unknown action: ${action}` };
	}
}
