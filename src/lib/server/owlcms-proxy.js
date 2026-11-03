/**
 * OWLCMS Reverse Proxy
 *
 * Proxies requests to the configured OWLCMS server (OWLCMS_URL / setOwlcmsTarget),
 * enabling:
 * - Vaadin pages to be embedded in iframes of tracker pages (same-origin)
 * - Vaadin PUSH (WebSocket) to work through the proxy
 *
 * Only the tracker's own pages may use the proxy (see isAllowedProxyRequest).
 * OWLCMS response headers are forwarded unchanged.
 * 
 * Usage:
 * - Dev: attachProxyToViteServer(server)
 * - Prod: createOwlcmsProxyMiddleware() with middleware.upgrade() for WebSocket upgrades
 */

import { createProxyMiddleware } from 'http-proxy-middleware';

// Default OWLCMS target - can be overridden via environment variable
const DEFAULT_OWLCMS_URL = 'http://localhost:8080';
const CONFIGURED_OWLCMS_URL = String(process.env.OWLCMS_URL || '').trim();

// Current target (mutable at runtime)
let currentTarget = CONFIGURED_OWLCMS_URL || DEFAULT_OWLCMS_URL;

/**
 * Get the OWLCMS target URL from environment or default
 */
export function getOwlcmsTarget() {
  return currentTarget;
}

/**
 * Update the OWLCMS target URL at runtime
 * @param {string} target - New OWLCMS base URL (e.g., http://192.168.1.42:8080)
 */
export function setOwlcmsTarget(target) {
  if (!target) return;
  currentTarget = target;
  console.log(`[OWLCMS Proxy] Updated target to ${target}`);
}

export function resolveOwlcmsTarget({ remoteAddress, port = 8080, scheme = 'http' } = {}) {
  let host = String(remoteAddress || '').trim();
  if (!host || host === 'unknown remote') return null;

  if (host.startsWith('::ffff:') && host.slice(7).includes('.')) {
    host = host.slice(7);
  } else {
    if (host.startsWith('[') && host.endsWith(']')) {
      host = host.slice(1, -1);
    }
    if (host.includes(':')) {
      host = `[${host.replace('%', '%25')}]`;
    }
  }

  const normalizedPort = Number(port);
  if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
    return null;
  }

  const normalizedScheme = String(scheme || '').trim().toLowerCase();
  if (normalizedScheme !== 'http' && normalizedScheme !== 'https') {
    return null;
  }

  return `${normalizedScheme}://${host}:${normalizedPort}`;
}

export function updateOwlcmsTargetFromConnection(connectionInfo) {
  if (CONFIGURED_OWLCMS_URL) return currentTarget;

  const target = resolveOwlcmsTarget(connectionInfo);
  if (target) setOwlcmsTarget(target);
  return target;
}

function firstHeaderValue(value) {
  return String(Array.isArray(value) ? value[0] : value ?? '').split(',')[0].trim();
}

/**
 * Decide whether a request may use the proxy. Browsers label requests with
 * Sec-Fetch-Site / Sec-Fetch-Dest; only the tracker's own pages (same-origin) pass.
 * @param {Object} req - Node request (only `headers` is used)
 * @param {Object} [options]
 * @param {boolean} [options.upgrade] - true for WebSocket upgrade requests
 * @returns {boolean}
 */
export function isAllowedProxyRequest(req, { upgrade = false } = {}) {
  const headers = req?.headers || {};
  const site = firstHeaderValue(headers['sec-fetch-site']).toLowerCase();

  if (upgrade) {
    if (site) return site === 'same-origin';
    const origin = firstHeaderValue(headers.origin);
    const host = (firstHeaderValue(headers['x-forwarded-host']) || firstHeaderValue(headers.host)).toLowerCase();
    if (!origin || !host) return false;
    try {
      return new URL(origin).host.toLowerCase() === host;
    } catch {
      return false;
    }
  }

  const dest = firstHeaderValue(headers['sec-fetch-dest']).toLowerCase();
  return site === 'same-origin' && dest !== 'document';
}

/**
 * Create the proxy middleware for OWLCMS. The result is a Connect middleware that
 * refuses requests failing isAllowedProxyRequest, and has an `upgrade(req, socket, head)`
 * method that applies the same gate to WebSocket upgrades.
 * @param {Object} options - Configuration options
 * @param {string} options.target - OWLCMS server URL (default: setOwlcmsTarget / OWLCMS_URL / localhost:8080)
 * @returns {Function} Express/Connect middleware
 */
export function createOwlcmsProxyMiddleware(options = {}) {
  const fixedTarget = options.target;
  const currentOwlcmsTarget = () => fixedTarget || getOwlcmsTarget();

  console.log(`[OWLCMS Proxy] Creating proxy with default target ${currentOwlcmsTarget()}`);

  const proxy = createProxyMiddleware({
    target: currentOwlcmsTarget(),
    // Always the configured target, never taken from the request
    router: currentOwlcmsTarget,
    changeOrigin: true,
    // Upgrades are wired explicitly through the gate below; ws:true would make the
    // proxy subscribe to the server 'upgrade' event itself and bypass it.
    ws: false,

    // Remove /proxy prefix when forwarding to OWLCMS
    pathRewrite: {
      '^/proxy': ''
    },

    on: {
      error: (err, req, res) => {
        console.error(`[OWLCMS Proxy] Error proxying ${req.url}:`, err.message);
        if (res && res.writeHead && !res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('Proxy error: Could not connect to OWLCMS');
        } else if (res && typeof res.destroy === 'function') {
          res.destroy();
        }
      }
    }
  });

  const gated = (req, res, next) => {
    if (!isAllowedProxyRequest(req)) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Forbidden');
      return;
    }
    return proxy(req, res, next);
  };

  gated.upgrade = (req, socket, head) => {
    if (!isAllowedProxyRequest(req, { upgrade: true })) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: 9\r\n\r\nForbidden');
      socket.destroy();
      return;
    }
    proxy.upgrade(req, socket, head);
  };

  return gated;
}

/**
 * Attach proxy to a Vite dev server
 * @param {Object} server - Vite server instance
 */
export function attachProxyToViteServer(server) {
  const proxyMiddleware = createOwlcmsProxyMiddleware();
  
  // Attach HTTP middleware
  server.middlewares.use('/proxy', proxyMiddleware);
  
  // Handle WebSocket upgrades for /proxy paths
  const httpServer = server.httpServer;
  if (httpServer) {
    // Add upgrade listener that only handles /proxy paths
    // Must be added BEFORE other upgrade listeners to handle first
    // Use 'prependListener' to ensure we get first shot at /proxy paths
    httpServer.prependListener('upgrade', (request, socket, head) => {
      const url = request.url || '';
      
      if (url.startsWith('/proxy')) {
        // Mark as handled so other listeners skip it
        request._proxyHandled = true;
        proxyMiddleware.upgrade(request, socket, head);
      }
      // For non-proxy paths, do nothing - let other handlers process
    });
    
    console.log('[OWLCMS Proxy] WebSocket upgrade handler attached');
  }
  
  console.log('[OWLCMS Proxy] Attached to Vite dev server at /proxy');
}

/**
 * Get proxy middleware for production HTTP server
 * For use with start-with-ws.js
 */
export function getProxyMiddleware() {
  return createOwlcmsProxyMiddleware();
}
