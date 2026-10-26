import { competitionHub } from '$lib/server/competition-hub.js';
import { logger } from '@owlcms/tracker-core';

/**
 * Refresh the data a document is built from, before producing it.
 *
 * Asks OWLCMS (refresh:true) for a fresh database plus the archives the plugin
 * requires (e.g. logos_zip, flags_zip, gamx_zip), so OWLCMS rebuilds its cached
 * archives and the document reflects the current OWLCMS state. Waits for them,
 * then continues with whatever is loaded if the wait times out.
 *
 * We call through the hub singleton (globalThis.__competitionHub) and must NOT
 * import the WebSocket helpers from tracker-core directly: Vite may create a
 * separate module instance for SvelteKit SSR that has no OWLCMS connection.
 *
 * @param {Array<string>} requires - Resources declared in the plugin config (`config.requires`)
 * @param {number} timeoutMs - Max time to wait (default 10000ms)
 * @returns {Promise<boolean>} true if everything was refreshed, false if not sent or timed out
 */
export async function refreshResourcesForDocuments(requires = [], timeoutMs = 10000) {
	if (typeof competitionHub.refreshResources !== 'function') {
		logger.warn('[Documents] tracker-core does not support resource refresh; continuing with cached state');
		return false;
	}

	const resources = ['database', ...requires];
	logger.debug(`[Documents] Requesting fresh resources from OWLCMS: ${resources.join(', ')}`);
	const { sent, timedOut } = await competitionHub.refreshResources(resources, { timeoutMs });

	if (!sent) {
		logger.warn('[Documents] No OWLCMS connection; continuing with cached state');
		return false;
	}
	if (timedOut.length > 0) {
		logger.warn(`[Documents] Timed out after ${timeoutMs}ms waiting for ${timedOut.join(', ')}; continuing with cached state`);
		return false;
	}
	logger.debug('[Documents] Resources refreshed');
	return true;
}
