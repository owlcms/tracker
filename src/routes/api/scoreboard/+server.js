/**
 * Unified Scoreboard API Endpoint
 * 
 * Handles all scoreboard types with FOP and option parameters
 * Includes compression cache for optimized delivery
 * 
 * URL: /api/scoreboard?type=lifting-order&fop=Platform_A&showRecords=true
 */

import { json } from '@sveltejs/kit';
import crypto from 'crypto';
import { gzipSync, brotliCompressSync, constants as zlibConstants } from 'zlib';
import { scoreboardRegistry } from '$lib/server/scoreboard-registry.js';
import { competitionHub } from '$lib/server/competition-hub.js';
import { sseBroker } from '$lib/server/sse-broker.js';
import { buildOptions } from '$lib/server/build-options.js';
import { refreshResourcesForDocuments } from '$lib/server/document-refresh.js';
import { logger } from '@owlcms/tracker-core';

const responseCache = new Map();
const BROTLI_OPTS = { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } };

/**
 * Normalize a value for canonical representation
 * - true/'true' → 'true'
 * - false/'false' → 'false'
 * - null → 'null'
 * - numbers → string representation
 * - strings → NFKC normalized
 */
function canonicalValue(v) {
	if (v === true || v === 'true') return 'true';
	if (v === false || v === 'false') return 'false';
	if (v == null) return 'null';
	
	const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() && !isNaN(v) ? Number(v) : null);
	if (n !== null && Number.isFinite(n)) return String(Object.is(n, -0) ? 0 : n);
	
	return typeof v === 'string' ? v.normalize('NFKC') : String(v);
}

/**
 * Build canonical options object with sorted keys and normalized values
 */
function canonicalOptionsObject(options) {
	return Object.fromEntries(
		Object.entries(options || {})
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => [k, canonicalValue(v)])
	);
}

/**
 * Generate SHA256 hash of the variant identity (type, fop, options)
 * Immune to param order, unicode, spaces, delimiters
 */
function variantHash({ type, fop, options }) {
	const identity = {
		type: String(type).normalize('NFKC'),
		fop: String(fop || '').normalize('NFKC'),
		options: canonicalOptionsObject(options)
	};
	return crypto.createHash('sha256').update(JSON.stringify(identity)).digest('base64url');
}

export async function GET({ url, request }) {
	try {
		const clientId = url.searchParams.get('clientId');
		if (clientId) {
			sseBroker.markSeen(clientId);
		}

		// Check for protocol mismatch first - nothing works if versions don't match
		const protocolError = typeof competitionHub.getProtocolError === 'function'
			? competitionHub.getProtocolError()
			: null;
		if (protocolError) {
			return json({
				success: false,
				error: 'protocol_mismatch',
				message: `OWLCMS protocol version mismatch: ${protocolError.reason}`,
				received: protocolError.received,
				minimum: protocolError.minimum
			}, { status: 503 });
		}

		// Initialize registry on first call
		await scoreboardRegistry.initialize();

		// Extract parameters
		const type = url.searchParams.get('type') || 'lifting-order';
		const fopName = url.searchParams.get('fop');

		// Check if FOP is required for this scoreboard type
		const scoreboard = scoreboardRegistry.getScoreboard(type);
		const fopRequired = scoreboard?.config?.fopRequired !== false; // Default to required if not specified

		// If no FOP specified and FOP is required, return error
		if (!fopName && fopRequired) {
			return json({
				success: false,
				error: 'missing_fop',
				message: 'FOP name is required. Example: ?type=lifting-order&fop=Platform_A'
			}, { status: 400 });
		}

		// Extract all other parameters as options
		const options = buildOptions({
			scoreboard,
			url,
			reservedKeys: new Set(['type', 'fop', 'clientId']),
			registry: scoreboardRegistry
		});

		if (scoreboard?.config?.category === 'documents') {
			await refreshResourcesForDocuments(scoreboard.config.requires || []);
		}
		
		if (fopName === '*') {
			const data = await scoreboardRegistry.processData(type, fopName, options);
			return json({
				success: true,
				type,
				fop: fopName,
				options,
				data,
				timestamp: Date.now()
			});
		}
		
		// Get current FOP version for cache validation
		const currentVersion = competitionHub.getFopStateVersion?.({ fopName }) ?? null;
		
		// If no versioning support, bypass cache
		if (currentVersion === null) {
			const data = await scoreboardRegistry.processData(type, fopName, options);
			return json({
				success: true,
				type,
				fop: fopName,
				options,
				data,
				timestamp: Date.now()
			});
		}
		
		// Generate cache key from variant hash
		const cacheKey = `scoreboard:${variantHash({ type, fop: fopName, options })}`;
		let cached = responseCache.get(cacheKey);
		
		// Cache miss or version mismatch - recompute
		if (!cached || cached.version !== currentVersion) {
			const data = await scoreboardRegistry.processData(type, fopName, options);
			const responseData = {
				success: true,
				type,
				fop: fopName,
				options,
				data,
				timestamp: Date.now()
			};
			
			// Serialize to JSON
			const jsonString = JSON.stringify(responseData);
			
			// Pre-compress with gzip and brotli
			const gzip = gzipSync(jsonString);
			const br = brotliCompressSync(jsonString, BROTLI_OPTS);
			
			// Create cache entry with version
			const newEntry = { version: currentVersion, json: jsonString, gzip, br };
			
			// CAS-like check: only update if existing version is older (prevent stale overwrites)
			const existing = responseCache.get(cacheKey);
			if (!existing || (existing.version ?? -1) <= currentVersion) {
				responseCache.set(cacheKey, newEntry);
				cached = newEntry;
				logger.debug(`[API /api/scoreboard] Cache MISS/UPDATE: ${cacheKey} (v${currentVersion})`);
			} else {
				cached = existing;
				logger.debug(`[API /api/scoreboard] Cache collision avoided: ${cacheKey} (kept v${existing.version})`);
			}
		} else {
			logger.debug(`[API /api/scoreboard] Cache HIT: ${cacheKey}`);
		}
		
		// Determine best compression based on Accept-Encoding
		const acceptEncoding = request.headers.get('accept-encoding') || '';
		if (acceptEncoding.includes('br')) {
			return new Response(cached.br, {
				headers: {
					'Content-Type': 'application/json',
					'Content-Encoding': 'br',
					'Cache-Control': 'no-cache',
					'Vary': 'Accept-Encoding'
				}
			});
		}
		if (acceptEncoding.includes('gzip')) {
			return new Response(cached.gzip, {
				headers: {
					'Content-Type': 'application/json',
					'Content-Encoding': 'gzip',
					'Cache-Control': 'no-cache',
					'Vary': 'Accept-Encoding'
				}
			});
		}
		
		return new Response(cached.json, {
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-cache'
			}
		});
		
	} catch (error) {
		console.error('[API /api/scoreboard] Error:', error.message);
		return json({
			success: false,
			error: error.message,
			timestamp: Date.now()
		}, { status: 500 });
	}
}

/**
 * Get list of available scoreboards and FOPs
 */
export async function POST({ request }) {
	try {
		await scoreboardRegistry.initialize();
		
		const body = await request.json();
		const action = body.action;
		
		if (action === 'list_scoreboards') {
			const scoreboards = scoreboardRegistry.getAllScoreboards();
			return json({
				success: true,
				scoreboards: scoreboards.map(s => ({
					type: s.type,
					name: s.config.name,
					description: s.config.description,
					options: s.config.options
				}))
			});
		}
		
		if (action === 'list_fops') {
			// Get available FOPs from competition hub
			const { competitionHub } = await import('$lib/server/competition-hub.js');
			const fops = competitionHub.getAvailableFOPs();
			
			return json({
				success: true,
				fops
			});
		}
		
		return json({
			success: false,
			error: 'unknown_action',
			message: 'Valid actions: list_scoreboards, list_fops'
		}, { status: 400 });
		
	} catch (error) {
		console.error('[API /api/scoreboard POST] Error:', error);
		return json({
			success: false,
			error: error.message
		}, { status: 500 });
	}
}
