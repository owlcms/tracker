/**
 * Scoreboard Plugin Registry
 *
 * Discovers and manages all scoreboard types.
 * Each scoreboard plugin has:
 * - config.js: metadata (name, description, options)
 * - helpers.data.js: server-side data processing function
 * - page.svelte: display component
 *
 * Static discovery (build-time): Vite import.meta.glob eagerly imports all
 * plugins under src/plugins/* so production builds include them without
 * runtime filesystem access.
 * 
 * Runtime discovery: Plugins added to src/plugins/ after build can be
 * discovered at runtime via filesystem scan (Node.js only).
 */

import { bumpCacheEpoch } from './cache-epoch.js';
import { competitionHub } from './competition-hub.js';
import { protectStoredSecrets, revealSecretDefault, valueForStorage, writeOverrideFile } from './override-secrets.js';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { dirname, resolve, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import JSON5 from 'json5';

// Eager imports so Vite includes all plugins at build time
// Note: import.meta.glob is a Vite COMPILE-TIME feature - it gets transformed
// into actual imports during build. It does NOT exist as a function at runtime.
// 
// Uses ** to support nested plugins (e.g., books/iwf-startbook, books/iwf-results)
const configModules = import.meta.glob('../../plugins/**/config.js', { eager: true });
const helperModules = import.meta.glob('../../plugins/**/helpers.data.js', { eager: true });

function findPackageRoot(startDir) {
	let current = startDir;
	for (let i = 0; i < 6; i += 1) {
		if (existsSync(join(current, 'package.json'))) {
			return current;
		}
		const parent = resolve(current, '..');
		if (parent === current) break;
		current = parent;
	}
	return startDir;
}

function toFileUrl(filePath, cacheBust = null) {
	if (!filePath) return null;
	const normalized = filePath.replace(/\\/g, '/');
	return cacheBust === null ? `file:///${normalized}` : `file:///${normalized}?t=${cacheBust}`;
}

async function importFromFileUrl(fileUrl) {
	const dynamicImport = new Function('u', 'return import(u)');
	return dynamicImport(fileUrl);
}

function clonePluginConfig(config) {
	if (!config || typeof config !== 'object') return config;
	return {
		...config,
		options: Array.isArray(config.options)
			? config.options.map((option) => ({
				...option,
				options: Array.isArray(option.options) ? [...option.options] : option.options
			}))
			: config.options,
		modalActions: Array.isArray(config.modalActions)
			? config.modalActions.map((action) => ({ ...action }))
			: config.modalActions,
		pages: Array.isArray(config.pages)
			? config.pages.map((page) => ({ ...page }))
			: config.pages
	};
}

function applyConfigOverrideDefaults(config, overrideConfig) {
	const merged = clonePluginConfig(config);
	if (!Array.isArray(merged?.options) || !Array.isArray(overrideConfig?.options)) {
		return { config: merged, overriddenKeys: [] };
	}

	const defaultsByKey = new Map();
	for (const option of overrideConfig.options) {
		if (!option?.key || !Object.prototype.hasOwnProperty.call(option, 'default')) continue;
		defaultsByKey.set(option.key, option.default);
	}

	if (defaultsByKey.size === 0) {
		return { config: merged, overriddenKeys: [] };
	}

	const overriddenKeys = [];
	merged.options = merged.options.map((option) => {
		if (!option?.key || !defaultsByKey.has(option.key)) return option;
		overriddenKeys.push(option.key);
		return {
			...option,
			default: option.type === 'password'
				? revealSecretDefault(option.key, defaultsByKey.get(option.key))
				: defaultsByKey.get(option.key)
		};
	});

	return { config: merged, overriddenKeys };
}

function getRuntimeConfigOverrideCandidates(pluginPath, runtimePaths = null) {
	const candidates = [];

	if (runtimePaths?.configPath) {
		candidates.push(join(dirname(runtimePaths.configPath), 'config-override.json5'));
	}

	try {
		const moduleDir = fileURLToPath(new URL('.', import.meta.url));
		const moduleRoot = findPackageRoot(moduleDir);
		candidates.push(resolve(process.cwd(), 'src/plugins', pluginPath, 'config-override.json5'));
		candidates.push(resolve(moduleRoot, 'src/plugins', pluginPath, 'config-override.json5'));
	} catch {
		candidates.push(resolve(process.cwd(), 'src/plugins', pluginPath, 'config-override.json5'));
	}

	return Array.from(new Set(candidates));
}

async function loadRuntimeConfigOverride(pluginPath, runtimePaths = null) {
	for (const overridePath of getRuntimeConfigOverrideCandidates(pluginPath, runtimePaths)) {
		if (!existsSync(overridePath)) continue;
		try {
			const raw = readFileSync(overridePath, 'utf8');
			return { path: overridePath, config: JSON5.parse(raw) };
		} catch (err) {
			console.error(`[ScoreboardRegistry] Failed to parse ${overridePath}:`, err.message);
			continue;
		}
	}

	return null;
}

/**
 * Resolve the preferred path to write a generated/updated override file.
 * Reuses an existing config-override.json5 if present; otherwise picks
 * the first candidate location.
 */
function getRuntimeConfigOverrideWritePath(pluginPath, runtimePaths = null) {
	const candidates = getRuntimeConfigOverrideCandidates(pluginPath, runtimePaths);
	const existing = candidates.find((p) => existsSync(p));
	return existing || candidates[0] || null;
}

/**
 * Discover plugins at runtime that weren't included in the build
 * This enables adding plugins to a pre-built application
 * 
 * @returns {Promise<Map<string, {configPath: string, helpersPath: string}>>}
 */
async function discoverRuntimePlugins({ verbose = true } = {}) {
	const runtimePlugins = new Map();
	
	// Only run in Node.js environment (not browser)
	if (typeof process === 'undefined' || !process.cwd) {
		return runtimePlugins;
	}
	
	try {
		const moduleDir = fileURLToPath(new URL('.', import.meta.url));
		const moduleRoot = findPackageRoot(moduleDir);

		// Recursively find plugin folders (folders containing config.js)
		const findPlugins = (dir, prefix = '') => {
			const entries = readdirSync(dir);
			
			for (const entry of entries) {
				// Skip hidden folders and node_modules
				if (entry.startsWith('.') || entry === 'node_modules') continue;
				
				const fullPath = join(dir, entry);
				const stat = statSync(fullPath);
				
				if (stat.isDirectory()) {
					const configPath = join(fullPath, 'config.js');
					const helpersPath = join(fullPath, 'helpers.data.js');
					
					if (existsSync(configPath)) {
						// Found a plugin
						const pluginPath = prefix ? `${prefix}/${entry}` : entry;
						const globKey = `../../plugins/${pluginPath}/config.js`;
						
						// Only add if not already in build-time modules
						if (!configModules[globKey]) {
							runtimePlugins.set(pluginPath, {
								configPath: configPath,
								helpersPath: existsSync(helpersPath) ? helpersPath : null
							});
							if (verbose) console.log(`[ScoreboardRegistry] Runtime discovery: found ${pluginPath}`);
						}
					}
					
					// Recurse into subdirectories
					findPlugins(fullPath, prefix ? `${prefix}/${entry}` : entry);
				}
			}
		};
		
		// Scan multiple plugin directories
		// In development: src/plugins (bundled plugins)
		// In production: extensions (user-added runtime plugins)
		// Use both process.cwd() and the module root to handle different launchers
		const pluginsDirs = [
			resolve(process.cwd(), 'src/plugins'),
			resolve(process.cwd(), 'extensions'),
			resolve(moduleRoot, 'src/plugins'),
			resolve(moduleRoot, 'extensions')
		];
		const uniquePluginDirs = Array.from(new Set(pluginsDirs));
		
		let foundAnyDir = false;
		for (const pluginsDir of uniquePluginDirs) {
			if (!existsSync(pluginsDir)) {
				continue;
			}
			foundAnyDir = true;
			if (verbose) console.log(`[ScoreboardRegistry] Runtime discovery: scanning ${pluginsDir}`);
			findPlugins(pluginsDir);
		}
		
		if (!foundAnyDir) {
			if (verbose) console.log('[ScoreboardRegistry] Runtime discovery: no plugin directories found, skipping');
		}
		
	} catch (err) {
		console.error('[ScoreboardRegistry] Runtime discovery error:', err.message);
	}
	
	return runtimePlugins;
}


class ScoreboardRegistry {
	constructor() {
		this.scoreboards = new Map();
		this.initialized = false;
		this.initializingPromise = null;  // Track ongoing initialization to prevent race conditions
		this.lastRuntimeSignature = null;  // Cache to skip no-op refreshes
	}

	/**
	 * Auto-discover scoreboard plugins in src/plugins/
	 * Looks for folders in plugins/ directory (excluding system folders starting with .)
	 * 
	 * Uses initialization lock to prevent race condition when multiple concurrent requests
	 * all see initialized=false and try to initialize simultaneously
	 */
	async initialize() {
		// If already initialized, return immediately. Runtime plugins are
		// discovered once on first init; if you add a new runtime plugin
		// (e.g. a new folder under extensions/), restart the server.
		if (this.initialized) {
			return;
		}
		
		// If initialization is in progress, wait for it
		if (this.initializingPromise) {
			console.log('[ScoreboardRegistry] Initialization in progress, waiting...');
			await this.initializingPromise;
			return;
		}

		// Start initialization and create promise to block other requests
		this.initializingPromise = this._doInitialize();
		await this.initializingPromise;
		this.initializingPromise = null;  // Clear after completion
	}

	async _doInitialize() {
		const discovered = new Map(); // pluginPath -> { folderName, runtime, paths }

		// Build-time plugins (from import.meta.glob)
		for (const configPath of Object.keys(configModules)) {
			// Extract plugin path relative to plugins/ directory
			// Examples:
			//   ../../plugins/lifting-order/config.js -> "lifting-order"
			//   ../../plugins/books/iwf-startbook/config.js -> "books/iwf-startbook"
			const match = configPath.match(/\.\.\/\.\.\/plugins\/(.+)\/config\.js$/);
			if (!match) continue;
			
			const pluginPath = match[1]; // e.g., "lifting-order" or "books/iwf-startbook"
			const folderName = pluginPath.split('/').pop(); // e.g., "iwf-startbook"
			discovered.set(pluginPath, { folderName, runtime: false });
		}

		// Runtime plugins (not in build)
		const runtimePlugins = await discoverRuntimePlugins();
		for (const [pluginPath, paths] of runtimePlugins) {
			const folderName = pluginPath.split('/').pop();
			discovered.set(pluginPath, { folderName, runtime: true, paths });
		}

		// Register all discovered plugins
		for (const [pluginPath, info] of discovered) {
			await this.registerScoreboard(pluginPath, info.folderName, info.runtime ? info.paths : null);
		}

		this.initialized = true;
		console.log(`[ScoreboardRegistry] Initialized with ${this.scoreboards.size} scoreboards`);
	}

	async refreshRuntimePlugins() {
		const runtimePlugins = await discoverRuntimePlugins({ verbose: false });

		if (runtimePlugins.size === 0) {
			this.lastRuntimeSignature = '';
			return;
		}

		// Build a signature from plugin paths and source-file mtimes; skip
		// re-registration when nothing on disk has changed since last call.
		const signatureParts = [];
		for (const [pluginPath, paths] of Array.from(runtimePlugins).sort(([a], [b]) => a.localeCompare(b))) {
			let configMtime = 0;
			let helpersMtime = 0;
			try { configMtime = statSync(paths.configPath).mtimeMs; } catch {}
			if (paths.helpersPath) {
				try { helpersMtime = statSync(paths.helpersPath).mtimeMs; } catch {}
			}
			signatureParts.push(`${pluginPath}|${configMtime}|${helpersMtime}`);
		}
		const signature = signatureParts.join('\n');
		if (signature === this.lastRuntimeSignature) {
			return;
		}
		this.lastRuntimeSignature = signature;

		for (const [type, scoreboard] of Array.from(this.scoreboards.entries())) {
			if (scoreboard.runtime) {
				this.scoreboards.delete(type);
			}
		}

		for (const [pluginPath, paths] of runtimePlugins) {
			const folderName = pluginPath.split('/').pop();
			await this.registerScoreboard(pluginPath, folderName, paths);
		}
	}

	async reloadScoreboard(type) {
		const existing = this.scoreboards.get(type);
		if (!existing) {
			return false;
		}

		await this.registerScoreboard(
			existing.pluginPath,
			existing.folderName,
			existing.runtime ? existing.runtimePaths : null
		);
		return this.scoreboards.has(type);
	}

	/**
	 * Register a single scoreboard plugin
	 * @param {string} pluginPath - Path relative to plugins/ (e.g., "books/iwf-startbook")
	 * @param {string} folderName - Folder name (e.g., "iwf-startbook")
	 * @param {Object|null} runtimePaths - Paths for runtime-discovered plugins
	 */
	async registerScoreboard(pluginPath, folderName = null, runtimePaths = null) {
		if (!folderName) {
			folderName = pluginPath;
		}
		
		try {
			let config, configModule, dataHelper, actionHandler;
			
			if (runtimePaths) {
				// Runtime-discovered plugin - use dynamic import
				// Use direct file URL strings (no percent-encoding) for accented paths on Windows
				try {
					const configMtime = statSync(runtimePaths.configPath).mtimeMs;
					const configUrl = toFileUrl(runtimePaths.configPath, configMtime) || `${pathToFileURL(runtimePaths.configPath).href}?t=${configMtime}`;
					configModule = await importFromFileUrl(configUrl);
					config = configModule.default || configModule;
					
					if (runtimePaths.helpersPath) {
						const helpersMtime = statSync(runtimePaths.helpersPath).mtimeMs;
						const helpersUrl = toFileUrl(runtimePaths.helpersPath, helpersMtime) || `${pathToFileURL(runtimePaths.helpersPath).href}?t=${helpersMtime}`;
						const helpersModule = await importFromFileUrl(helpersUrl);
						dataHelper = helpersModule.getScoreboardData || helpersModule.processData || helpersModule.default;
						actionHandler = helpersModule.handleAction || null;
					}
				} catch (importErr) {
					console.error(`[ScoreboardRegistry] Failed to import runtime plugin ${pluginPath}:`, importErr.message);
					return;
				}
			} else {
				// Build-time plugin - use pre-imported modules
				configModule = configModules[`../../plugins/${pluginPath}/config.js`];
				if (!configModule) {
					console.warn(`[ScoreboardRegistry] Skipping ${pluginPath}: no config.js`);
					return;
				}
				config = configModule.default || configModule;

				const helpersModule = helperModules[`../../plugins/${pluginPath}/helpers.data.js`];
				dataHelper = helpersModule
					? helpersModule.getScoreboardData || helpersModule.processData || helpersModule.default
					: null;
				actionHandler = helpersModule?.handleAction || null;
			}

			config = clonePluginConfig(config);
			const runtimeConfigOverride = await loadRuntimeConfigOverride(pluginPath, runtimePaths);
			if (runtimeConfigOverride) {
				protectStoredSecrets(runtimeConfigOverride, config);
				const overrideResult = applyConfigOverrideDefaults(config, runtimeConfigOverride.config);
				config = overrideResult.config;
				if (overrideResult.overriddenKeys.length > 0) {
					console.log(`[ScoreboardRegistry] Applied config-override.json5 for ${pluginPath}: ${overrideResult.overriddenKeys.join(', ')}`);
				}
			}

			// Handle delegateTo pattern: config-only plugins that extend a base plugin
			// If no dataHelper but config has delegateTo, load base plugin's createHelpers
			if (!dataHelper && config.delegateTo) {
				try {
					const basePluginPath = config.delegateTo;
					console.log(`[ScoreboardRegistry] ${folderName}: delegating to ${basePluginPath}`);
					
					// Get base plugin's helpers module
					let baseHelpersModule;
					const baseGlobKey = `../../plugins/${basePluginPath}/helpers.data.js`;
					
					if (helperModules[baseGlobKey]) {
						// Build-time: use pre-imported module
						baseHelpersModule = helperModules[baseGlobKey];
					} else {
						// Runtime: try dynamic import from src/plugins
						const baseHelpersPath = resolve(process.cwd(), `src/plugins/${basePluginPath}/helpers.data.js`);
						if (existsSync(baseHelpersPath)) {
							baseHelpersModule = await import(/* @vite-ignore */ 'file://' + baseHelpersPath);
						}
					}
					
					if (baseHelpersModule?.createHelpers) {
						// Check if config exports a custom calculateScore function
						const customCalculateScore = configModule.calculateScore || null;
						
						if (customCalculateScore) {
							console.log(`[ScoreboardRegistry] ${folderName}: using custom calculateScore from config`);
						}
						
						// Create helpers with custom scoring (or null for default)
						const derivedHelpers = baseHelpersModule.createHelpers(customCalculateScore);
						dataHelper = derivedHelpers.getScoreboardData;
						if (!actionHandler && derivedHelpers.handleAction) {
							actionHandler = derivedHelpers.handleAction;
						}

						// Inherit pages from base config if extension doesn't define its own
						if (!config.pages) {
							const baseConfigModule = configModules[`../../plugins/${basePluginPath}/config.js`];
							const baseConfig = baseConfigModule?.default || baseConfigModule;
							if (baseConfig?.pages) {
								config.pages = baseConfig.pages;
							}
						}
					} else {
						console.warn(`[ScoreboardRegistry] ${folderName}: base plugin ${basePluginPath} has no createHelpers export`);
					}
				} catch (delegateErr) {
					console.error(`[ScoreboardRegistry] ${folderName}: delegation failed:`, delegateErr.message);
				}
			}

			const type = folderName;

			this.scoreboards.set(type, {
				type,
				folderName,
				pluginPath,
				config,
				dataHelper,
				handleAction: actionHandler,
				path: `../../plugins/${pluginPath}`,
				runtime: !!runtimePaths,
				runtimePaths
			});

			console.log(`[ScoreboardRegistry] Registered: ${type} (path: ${pluginPath}${runtimePaths ? ', runtime' : ''}${actionHandler ? ', has actions' : ''})`);

			// Register additional pages if config declares them
			if (config.pages && Array.isArray(config.pages)) {
				for (const page of config.pages) {
					if (!page.key || !page.component) {
						console.warn(`[ScoreboardRegistry] ${type}: invalid page entry (missing key or component)`);
						continue;
					}

					const pageType = page.key;
					const pageConfig = {
						...config,
						name: page.name || config.name,
						icon: page.icon,
						pageComponent: page.component,
						isSubPage: true,
						parentType: type
					};

					this.scoreboards.set(pageType, {
						type: pageType,
						folderName,
						pluginPath,
						config: pageConfig,
						dataHelper,
						handleAction: actionHandler,
						path: `../../plugins/${pluginPath}`,
						runtime: !!runtimePaths,
						runtimePaths,
						isSubPage: true,
						parentType: type
					});

					console.log(`[ScoreboardRegistry] Registered sub-page: ${pageType} (parent: ${type}, component: ${page.component})`);
				}
			}
		} catch (err) {
			console.error(`[ScoreboardRegistry] Failed to register ${pluginPath}:`, err);
		}
	}

	/**
	 * Get scoreboard by type
	 */
	getScoreboard(type) {
		return this.scoreboards.get(type);
	}

	/**
	 * Persist the supplied option values as defaults for `type` by writing
	 * (or updating) a sibling config-override.json5 file. Only keys that the
	 * plugin actually declares as options are saved.
	 *
	 * Returns { success, path, savedKeys } on success or { success: false, error }.
	 */
	saveOptionDefaults(type, suppliedOptions = {}) {
		const scoreboard = this.scoreboards.get(type);
		if (!scoreboard) {
			return { success: false, error: 'plugin_not_found' };
		}

		const declaredOptions = Array.isArray(scoreboard.config?.options) ? scoreboard.config.options : [];
		if (declaredOptions.length === 0) {
			return { success: false, error: 'no_options_declared' };
		}

		const writePath = getRuntimeConfigOverrideWritePath(scoreboard.pluginPath, scoreboard.runtimePaths);
		if (!writePath) {
			return { success: false, error: 'no_writable_location' };
		}

		const savedKeys = [];
		let payload;
		try {
			payload = {
				options: declaredOptions
					.filter((opt) => opt?.key && Object.prototype.hasOwnProperty.call(suppliedOptions, opt.key))
					.map((opt) => {
						savedKeys.push(opt.key);
						const value = suppliedOptions[opt.key];
						return { key: opt.key, default: valueForStorage(opt, value) };
					})
			};
		} catch (err) {
			return { success: false, error: 'encryption_failed', message: `Could not encrypt a saved secret: ${err.message}` };
		}

		if (payload.options.length === 0) {
			return { success: false, error: 'no_matching_options' };
		}

		try {
			writeOverrideFile(writePath, payload);
		} catch (err) {
			return { success: false, error: 'write_failed', message: err.message };
		}

		return { success: true, path: writePath, savedKeys };
	}

	/**
	 * Get base scoreboard if this scoreboard delegates to another
	 * Returns null if no delegation or base not found
	 */
	getBaseScoreboard(type) {
		const scoreboard = this.scoreboards.get(type);
		if (!scoreboard?.config?.delegateTo) return null;
		
		// Find the base plugin by its path
		const basePath = scoreboard.config.delegateTo;
		for (const [baseType, baseScoreboard] of this.scoreboards) {
			if (baseScoreboard.pluginPath === basePath) {
				return baseScoreboard;
			}
		}
		return null;
	}

	/**
	 * Get all registered scoreboards
	 */
	getAllScoreboards() {
		return Array.from(this.scoreboards.values());
	}

	/**
	 * Check if any registered scoreboard requires pictures
	 */
	anyScoreboardRequiresPictures() {
		for (const scoreboard of this.scoreboards.values()) {
			if (scoreboard.config && scoreboard.config.requiresPictures === true) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Process data for a specific scoreboard type
	 * 
	 * Resource preconditions (config.requires) are checked only on cache miss.
	 * If a valid cache entry exists, resources were already loaded when it was built.
	 */
	async processData(type, fopName, options = {}) {
		const scoreboard = this.getScoreboard(type);

		if (!scoreboard) {
			throw new Error(`Unknown scoreboard type: ${type}`);
		}

		if (!scoreboard.dataHelper) {
			throw new Error(`Scoreboard ${type} has no data helper`);
		}

		// Resource preconditions are checked inside helpers on cache miss.
		// Helpers call competitionHub methods which short-circuit if already loaded.
		// We move the check here to centralize it, but helpers still have caching.
		// 
		// Note: ensurePluginPreconditions is fast when resources are loaded (flag check only).
		// We could skip this on cache hit, but that requires helpers to return cache status.
		// Current design: check every time (fast path) for simplicity.
		const requires = scoreboard.config?.requires || [];
		if (requires.length > 0) {
			const ready = await competitionHub.ensurePluginPreconditions(requires);
			if (!ready) {
				return { status: 'waiting', message: 'Waiting for resources...' };
			}
		}

		// Call the scoreboard's data processing function
		return scoreboard.dataHelper(fopName, options);
	}

	/**
	 * Flush all plugin caches
	 * Called when OWLCMS establishes a new connection to clear stale cached data
	 */
	flushCaches() {
		// Force invalidation of any cache keys that include the global cache epoch.
		// Many plugin helpers build cache keys using $lib/server/cache-utils.js; we append
		// this epoch there. Document plugins that build custom keys should include it too.
		//
		// Note: we do not attempt to directly clear plugin-private Map instances.
		// This avoids tight coupling and keeps plugins in control of their own caches.
		//
		const newEpoch = bumpCacheEpoch();
		console.log(`[ScoreboardRegistry] Cache epoch bumped to ${newEpoch} (was ${newEpoch - 1})`);
		return newEpoch;
	}
}

// Singleton instance
export const scoreboardRegistry = new ScoreboardRegistry();

