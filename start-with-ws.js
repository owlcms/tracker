#!/usr/bin/env node

/**
 * Start SvelteKit built server and attach the WebSocket upgrade handler
 * so the /ws endpoint accepts OWLCMS WebSocket connections in production.
 */

// Mark that start-with-ws.js is handling WebSocket - MUST be before handler import
// This prevents hooks.server.js from also trying to init WebSocket
globalThis.__startWithWsActive = true;

import { createServer } from 'http';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { handler } from './build/handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const buildClientDir = path.join(__dirname, 'build', 'client');

function shouldReturnMissingImmutableAsset(req) {
  if (!req.url) return false;

  const pathname = req.url.split('?')[0];
  if (!pathname?.startsWith('/_app/immutable/')) return false;

  const normalizedPath = path.normalize(pathname).replace(/^([/\\])+/, '');
  const resolvedPath = path.resolve(buildClientDir, normalizedPath);

  if (!resolvedPath.startsWith(buildClientDir + path.sep)) {
    return false;
  }

  return !existsSync(resolvedPath);
}

// Add global uncaught exception handler to prevent crashes from abrupt connection resets
process.on('uncaughtException', (err) => {
  // ECONNRESET is normal when OWLCMS disconnects abruptly - log but don't crash
  if (err.code === 'ECONNRESET' || err.message.includes('ECONNRESET')) {
    console.warn('[Error] Connection reset by OWLCMS (normal during disconnection)');
    return; // Don't crash
  }
  
  // Log other unexpected errors but try to continue
  console.error('❌ Uncaught Exception:', err.message);
  console.error('Stack:', err.stack);
  // For critical errors, you could still exit: process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.warn('[Warning] Unhandled Rejection:', reason);
  // Don't exit - let the app continue running
});

(async () => {
  try {
    // Set port for adapter-node (default 5173, but we want 8096)
    const PORT = process.env.PORT || '8096';

    // Import OWLCMS proxy middleware
    let proxyMiddleware = null;
    try {
      const { createOwlcmsProxyMiddleware } = await import('./build/lib/server/owlcms-proxy.js');
      proxyMiddleware = createOwlcmsProxyMiddleware();
      console.log('[Startup] OWLCMS proxy middleware loaded');
    } catch (err) {
      console.warn('[Startup] OWLCMS proxy not available:', err?.message || err);
    }

    // Create HTTP server with proxy middleware before SvelteKit handler
    const httpServer = createServer((req, res) => {
      // Browsers can keep old immutable chunk URLs cached across rebuilds.
      // Return 404 for stale assets instead of letting adapter-node try a missing
      // .br/.gz variant and crash the local preview server.
      if (shouldReturnMissingImmutableAsset(req)) {
        res.statusCode = 404;
        res.setHeader('Cache-Control', 'no-store');
        res.end('Not found');
        return;
      }

      // Route /proxy requests through OWLCMS proxy
      if (proxyMiddleware && req.url.startsWith('/proxy')) {
        return proxyMiddleware(req, res, () => handler(req, res));
      }
      // All other requests go to SvelteKit
      handler(req, res);
    });

    // Vaadin push WebSocket upgrades for /proxy go through the same-origin gate
    if (proxyMiddleware) {
      httpServer.on('upgrade', (req, socket, head) => {
        if (req.url?.startsWith('/proxy')) {
          proxyMiddleware.upgrade(req, socket, head);
        }
      });
    }

    // Attach WebSocket server for OWLCMS connections
    try {
      const { initializeWebSocketServer } = await import('./build/lib/server/initialize-server.js');
      await initializeWebSocketServer(httpServer);
      console.log('[Startup] WebSocket server attached to HTTP server');
    } catch (err) {
      console.warn('[Startup] WebSocket initialization warning:', err?.message || err);
      console.warn('[Startup] OWLCMS connections will not work without WebSocket');
    }

    // Start the server
    httpServer.listen(PORT, () => {
      console.log(`[Startup] Server running on http://localhost:${PORT}`);
    });

    // Store HTTP server reference for shutdown gracefully
    globalThis.__httpServer = httpServer;

  } catch (error) {
    console.error('❌ Startup error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
})();
