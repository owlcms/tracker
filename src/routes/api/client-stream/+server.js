import { competitionHub } from '$lib/server/competition-hub.js';
import { sseBroker } from '$lib/server/sse-broker.js';
import { logger } from '@owlcms/tracker-core';

/**
 * Server-Sent Events endpoint for browser clients
 * One-way push from server to browsers
 * 
 * The SSE broker listens to hub events and broadcasts to all clients.
 * This endpoint registers clients with the broker and sends initial state.
 */
export async function GET({ request, url }) {
  const connectionId = Math.random().toString(36).substr(2, 9);
  
  // Get language preference from query parameter (default: 'en')
  const language = url.searchParams.get('lang') || 'en';
  // Get FOP filter (null = global events only, specific FOP = that FOP + global)
  const fopName = url.searchParams.get('fop') || null;
  const mode = url.searchParams.get('mode') || null;
  const clientId = url.searchParams.get('clientId') || null;
  // Scoreboard type (e.g. lifting-order, rankings, start-order) used to count
  // how many people are watching each scoreboard.
  const scoreboardType = url.searchParams.get('sb') || null;
  const noExpiry = url.searchParams.get('noExpiry') === 'true';

  const modeLabel = mode ? `, mode: ${mode}` : '';
  logger.debug(`[SSE] New client connection: ${connectionId} (clientId: ${clientId || 'none'}, language: ${language}, FOP: ${fopName || 'global'}, scoreboard: ${scoreboardType || 'none'}${modeLabel})`);
  
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let isClosed = false;
      let unregisterClient = () => {};
      
      const send = (dataOrBytes) => {
        if (isClosed) {
          return;
        }

        try {
          // Check if we received pre-encoded bytes or raw data
          if (dataOrBytes instanceof Uint8Array) {
            // Pre-encoded from broker - send directly
            controller.enqueue(dataOrBytes);
          } else {
            // Raw data (initial state, translations) - encode here
            const message = `data: ${JSON.stringify(dataOrBytes)}\n\n`;
            controller.enqueue(encoder.encode(message));
          }
        } catch (error) {
          const errorMessage = error?.message || String(error);
          if (errorMessage.includes('already closed')) {
            logger.debug(`[SSE] ${connectionId}: Error sending message: ${errorMessage}`);
          } else {
            logger.warn(`[SSE] ${connectionId}: Error sending message: ${errorMessage}`);
          }
          cleanup();
        }
      };

      const cleanup = () => {
        if (isClosed) return;
        
        logger.debug(`[SSE] ${connectionId}: Cleaning up connection (clientId: ${clientId || 'none'})`);
        isClosed = true;
        
        // Unregister client from broker
        unregisterClient();
        
        try {
          controller.close();
        } catch (error) {
          // Controller might already be closed - ignore
        }
      };
      
      // Register client with broker - broker handles hub events and broadcasts
      // Pass fopName so broker can filter FOP-specific events
      // Pass optional type filters to isolate control/display SSE
      let typeFilter = null;
      if (mode === 'display') {
        typeFilter = ['display_command'];
      } else if (mode === 'control') {
        typeFilter = ['display_state'];
      }

      unregisterClient = sseBroker.registerClient(send, connectionId, fopName, typeFilter, {
        clientId,
        scoreboardType,
        noExpiry,
        close: cleanup
      });
      
      // Handle client disconnect
      request.signal.addEventListener('abort', cleanup);
      if (request.signal.aborted) {
        cleanup();
        return;
      }

      // For display/control modes, skip hub/init payloads to keep SSE minimal
      if (!mode) {
        // Send initial state if available
        const currentState = competitionHub.getState();
        if (currentState) {
          send({
            type: 'state_update',
            data: currentState,
            timestamp: Date.now()
          });
        } else {
          send({
            type: 'waiting',
            message: 'No competition data available yet',
            timestamp: Date.now()
          });
        }

		// If a protocol error was latched before this client connected, send it immediately
		const protocolError = typeof competitionHub.getProtocolError === 'function'
			? competitionHub.getProtocolError()
			: null;
		if (protocolError) {
			send({
				type: 'protocol_error',
				reason: protocolError.reason,
				received: protocolError.received,
				minimum: protocolError.minimum,
				source: protocolError.source,
				timestamp: protocolError.timestamp || Date.now()
			});
		} else {
			// Explicitly tell clients protocol is OK so they can clear any stale UI state
			send({
				type: 'protocol_ok',
				timestamp: Date.now()
			});
		}
        
        // If hub is already ready, explicitly send hub_ready so browser knows to fetch data
        if (competitionHub.isReady()) {
          send({
            type: 'hub_ready',
            message: 'Hub ready - reconnected with data available',
            timestamp: Date.now()
          });
        }

        // Send translations for the requested language
        const translations = competitionHub.getTranslations({ locale: language });
        if (translations && Object.keys(translations).length > 0) {
          send({
            type: 'translations',
            locale: language,
            data: translations,
            keyCount: Object.keys(translations).length,
            timestamp: Date.now()
          });
        } else if (language !== 'en') {
          // Fallback to English if requested language not available
          const enTranslations = competitionHub.getTranslations({ locale: 'en' });
          if (enTranslations && Object.keys(enTranslations).length > 0) {
            console.log(`[SSE] ${connectionId}: Language '${language}' not available, falling back to 'en'`);
            send({
              type: 'translations',
              locale: 'en',
              data: enTranslations,
              keyCount: Object.keys(enTranslations).length,
              timestamp: Date.now()
            });
          }
        }
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    }
  });
}