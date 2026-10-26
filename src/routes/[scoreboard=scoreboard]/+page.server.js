/**
 * Dynamic Scoreboard Route
 * 
 * Handles URLs like:
 * /lifting-order?fop=Platform_A&showRecords=true
 * /results?fop=Platform_B&sortBy=sinclair
 * /team-rankings?fop=Platform_C&showTop=5
 */

import { scoreboardRegistry } from '$lib/server/scoreboard-registry.js';
import { competitionHub } from '$lib/server/competition-hub.js';
import { buildOptions } from '$lib/server/build-options.js';
import { refreshResourcesForDocuments } from '$lib/server/document-refresh.js';
import { error } from '@sveltejs/kit';

export async function load({ params, url }) {
	try {
		// Initialize registry
		await scoreboardRegistry.initialize();
		
		// Get scoreboard type from route param (e.g., "lifting-order")
		const type = params.scoreboard;
		
		// Check if scoreboard exists
		const scoreboard = scoreboardRegistry.getScoreboard(type);
		if (!scoreboard) {
			throw error(404, {
				message: `Scoreboard type "${type}" not found`,
				available: scoreboardRegistry.getAllScoreboards().map(s => s.type)
			});
		}
		
		// Check if FOP is required for this scoreboard type
		const fopRequired = scoreboard.config?.fopRequired !== false; // Default to required if not specified
		
		// Extract FOP from query string, or auto-select if only one FOP exists
		let fopName = url.searchParams.get('fop');
		if (!fopName && fopRequired) {
			// Try to auto-select if only one FOP is available
			const availableFOPs = competitionHub.getAvailableFOPs();
			if (availableFOPs.length === 1) {
				fopName = availableFOPs[0];
				console.log(`[Scoreboard Route] Auto-selected single FOP: ${fopName}`);
			} else if (availableFOPs.length > 1) {
				throw error(400, {
					message: 'FOP parameter is required (multiple FOPs available)',
					example: `/${type}?fop=Platform_A`,
					availableFOPs
				});
			} else {
				throw error(400, {
					message: 'FOP parameter is required (no FOPs available yet - waiting for OWLCMS connection)',
					example: `/${type}?fop=Platform_A`
				});
			}
		} else if (!fopName && !fopRequired) {
			// Scoreboards that aggregate across the competition still need a stable
			// token so the shared route SSE/API path can subscribe to all platform updates.
			fopName = '*';
		}
		
		// Build options: config defaults (base then extension) + URL overrides
		const options = buildOptions({
			scoreboard,
			url,
			reservedKeys: new Set(['fop']),
			registry: scoreboardRegistry
		});

		if (scoreboard.config?.category === 'documents') {
			await refreshResourcesForDocuments(scoreboard.config.requires || []);
		}
		
		// Get live data from plugin helpers (includes current config with overrides).
		// Go through processData so that config.requires resources (flags/logos/gamx)
		// are pulled from OWLCMS before the helper runs.
		let liveData = null;
		if (scoreboard.dataHelper) {
			try {
				liveData = await scoreboardRegistry.processData(type, fopName, options);
			} catch (err) {
				console.warn(`[Scoreboard Route] Failed to get live data for ${type}:`, err.message);
			}
		}
		
		// Return metadata for the page
		// For plugins with category=documents or customSSE=true, include full liveData
		// since they use server load data directly (skipRouteSSE=true in +page.svelte)
		const returnData = {
			scoreboardType: type,
			pluginPath: scoreboard.pluginPath || scoreboard.folderName,  // For component loading
			scoreboardName: scoreboard.config.name,
			scoreboardDescription: scoreboard.config.description,
			fopName,
			config: scoreboard.config,  // Static config with defaults
			liveConfig: liveData?.config,  // Current config with overrides (if available)
			...(liveData || {})  // Include all data for skipRouteSSE plugins
		};

		// Always preserve the canonical route options (config defaults + URL overrides).
		// Some helpers return a reduced `options` object for presentation, but the route
		// uses `data.options` to build subsequent API URLs and must not lose query flags.
		returnData.options = options;
		return returnData;
		
	} catch (err) {
		console.error('[Scoreboard Route] Error:', err);
		if (err.status) throw err;
		throw error(500, { message: err.message });
	}
}
