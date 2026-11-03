/**
 * Server Initialization Helper
 * 
 * Attaches the WebSocket server to the HTTP server for both dev and production modes.
 * Called from:
 * - vite.config.js (Vite dev server)
 * - build/index.js (Production server)
 * - start-with-ws.js (Custom production startup)
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { competitionHub } from './competition-hub.js';
import { updateOwlcmsTargetFromConnection } from './owlcms-proxy.js';
import { attachWebSocketToServer } from '@owlcms/tracker-core/websocket';
import { logger } from '@owlcms/tracker-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Track if WebSocket server is already attached to prevent double initialization
// Use globalThis so both bundled and copied server files share the same flag.
const WS_ATTACHED_FLAG = '__websocketServerAttached';

/**
 * Initialize WebSocket server on the given HTTP server
 */
export async function initializeWebSocketServer(httpServer) {
  // Prevent double initialization - this can happen when both start-with-ws.js
  // and hooks.server.js try to initialize the WebSocket server
  if (globalThis[WS_ATTACHED_FLAG]) {
    logger.debug('[WebSocket] Already initialized, skipping duplicate init');
    return true;
  }
  globalThis[WS_ATTACHED_FLAG] = true;

  try {
    attachWebSocketToServer({
      server: httpServer,
      path: '/ws',
      hub: competitionHub,
      localFilesDir: path.join(process.cwd(), 'local'),
      localUrlPrefix: '/local',
      onConnect: () => logger.info('[WebSocket] OWLCMS connected'),
      onAuthenticatedConnection: (connectionInfo) => {
        updateOwlcmsTargetFromConnection(connectionInfo);
      },
      onServerInfo: (serverInfo) => {
        updateOwlcmsTargetFromConnection(serverInfo);
      },
      onDisconnect: () => logger.info('[WebSocket] OWLCMS disconnected'),
      onError: (error) => logger.error('[WebSocket] Error:', error.message)
    });
    
    console.log('[WebSocket] Server initialized on /ws');
    return true;
  } catch (error) {
    console.error('[WebSocket] Failed to initialize:', error.message);
    return false;
  }
}

/**
 * Get the HTTP server from a SvelteKit/adapter-node server
 * Different adapters expose the HTTP server differently
 */
export function getHttpServer(svelteKitServer) {
  // Try different possible locations of the HTTP server
  if (svelteKitServer?.server?.server) {
    return svelteKitServer.server.server; // Polka adapter
  }
  if (svelteKitServer?.server) {
    return svelteKitServer.server; // Direct HTTP server
  }
  if (svelteKitServer?.httpServer) {
    return svelteKitServer.httpServer; // Vite dev server
  }
  return null;
}

export { competitionHub };
