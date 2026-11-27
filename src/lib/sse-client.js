/**
 * Global SSE client - shared across all scoreboard tabs in the same browser
 * Prevents hitting the 6-connection-per-host browser limit
 */

let eventSource = null;
let subscribers = new Set();
let connectionId = Math.random().toString(36).substr(2, 9);
let language = 'en';
let currentFop = null;
let currentScoreboard = null;
let currentNoExpiry = false;
let clientCount = 0;
let reconnectTimer = null;
let reconnectDelayMs = 2000;
// Set true when a reconnect was suppressed because the tab was hidden, so we can
// reconnect as soon as the tab becomes visible again (see ensureVisibilityHook).
let reconnectWhenVisible = false;
let visibilityHookInstalled = false;

/**
 * Stable per-tab client id. The same id is sent on the SSE connection and on
 * every /api/scoreboard request, letting the server correlate the stateless API
 * calls with this SSE stream and reap streams whose client has stopped querying.
 */
export function getClientId() {
	return connectionId;
}

/**
 * Hidden URL parameter (?noExpiry=true or ?noExpiry) for broadcast/kiosk views
 * (e.g. vMix, OBS) that must never pause or expire when hidden or idle.
 */
export function isNoExpiryEnabled(searchParams) {
	if (!searchParams || typeof searchParams.get !== 'function') return false;
	const value = searchParams.get('noExpiry');
	return value === 'true' || value === '';
}

function isHidden() {
	return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * Install a one-time visibilitychange hook that reconnects the SSE stream when
 * the tab becomes visible again, if a reconnect was deferred while hidden.
 */
function ensureVisibilityHook() {
	if (visibilityHookInstalled || typeof document === 'undefined') return;
	visibilityHookInstalled = true;
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible' && reconnectWhenVisible && subscribers.size > 0) {
			console.log(`[SSE] Reconnecting hidden-paused stream (clientId=${connectionId}, lang=${language}, fop=${currentFop || 'global'})`);
			reconnectWhenVisible = false;
			connectSSE(language, currentFop, currentScoreboard, currentNoExpiry);
		}
	});
}

/**
 * Connect to SSE stream (called once, reused by all pages)
 * @param {string} lang - Language code (default: 'en')
 * @param {string|null} fop - FOP name to filter events (null = global events only)
 * @param {string|null} scoreboard - Scoreboard type (used for per-scoreboard watcher counts)
 * @param {boolean} noExpiry - When true, keep stream alive and reconnecting even while hidden
 */
export function connectSSE(lang = 'en', fop = null, scoreboard = currentScoreboard, noExpiry = currentNoExpiry) {
	const keepAlive = noExpiry === true;
	// If a matching stream is already open or still connecting, reuse it. EventSource
	// starts in CONNECTING, so treating only OPEN as reusable causes rapid close/reopen
	// churn when subscribeSSE or Svelte reactive statements call connectSSE again.
	if (eventSource && eventSource.readyState !== EventSource.CLOSED && language === lang && currentFop === fop && currentScoreboard === scoreboard && currentNoExpiry === keepAlive) {
		return eventSource;
	}

	language = lang;
	
	// Close old connection if language or FOP changed
	if (eventSource) {
		eventSource.close();
		eventSource = null;
	}
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	
	currentFop = fop;
	currentScoreboard = scoreboard;
	currentNoExpiry = keepAlive;
	reconnectWhenVisible = false;
	ensureVisibilityHook();
	const fopParam = fop ? `&fop=${encodeURIComponent(fop)}` : '';
	const sbParam = scoreboard ? `&sb=${encodeURIComponent(scoreboard)}` : '';
	const noExpiryParam = keepAlive ? '&noExpiry=true' : '';
	const clientParam = `&clientId=${encodeURIComponent(connectionId)}`;
	console.log(`[SSE] Opening stream (clientId=${connectionId}, lang=${lang}, fop=${fop || 'global'}, sb=${scoreboard || 'none'}${keepAlive ? ', noExpiry=true' : ''})`);
	eventSource = new EventSource(`/api/client-stream?lang=${lang}${fopParam}${sbParam}${noExpiryParam}${clientParam}`);
	
	eventSource.onmessage = (event) => {
		try {
			const message = JSON.parse(event.data);
			// Broadcast to all subscribers
			subscribers.forEach(callback => {
				try {
					callback(message);
				} catch (err) {
					console.error('[SSE] Subscriber error:', err);
				}
			});
		} catch (err) {
			console.error('[SSE] Message parse error:', err);
		}
	};
	
	eventSource.onerror = (error) => {
		console.error('[SSE] Connection error:', error);
		if (eventSource.readyState === EventSource.CLOSED) {
			eventSource = null;
			if (subscribers.size === 0) return;
			// Do not reconnect while hidden unless noExpiry is active: a tab nobody is
			// watching should stay disconnected (e.g. after the server reaped its idle
			// stream) until the user brings it back to the foreground.
			if (isHidden() && !currentNoExpiry) {
				reconnectWhenVisible = true;
				return;
			}
			if (!reconnectTimer) {
				reconnectTimer = setTimeout(() => {
					reconnectTimer = null;
					connectSSE(language, currentFop, currentScoreboard, currentNoExpiry);
				}, reconnectDelayMs);
			}
		}
	};
	
	return eventSource;
}

/**
 * Subscribe to SSE messages
 * @param {Function} callback - Called with each message
 * @returns {Function} Unsubscribe function
 */
export function subscribeSSE(callback) {
	subscribers.add(callback);
	clientCount++;
	console.log(`[SSE] Client connected (${clientCount} active, lang=${language}, fop=${currentFop || 'global'})`);
	
	// Ensure connection is open
	if (!eventSource || eventSource.readyState !== EventSource.OPEN) {
		connectSSE(language, currentFop, currentScoreboard, currentNoExpiry);
	}
	
	// Return unsubscribe function
	return () => {
		subscribers.delete(callback);
		clientCount--;
		console.log(`[SSE] Client disconnected (lang=${language}). ${clientCount} active`);
		
		// Close connection if no more subscribers
		if (subscribers.size === 0 && eventSource) {
			eventSource.close();
			eventSource = null;
		}
	};
}

/**
 * Get current language
 */
export function getLanguage() {
	return language;
}

/**
 * Get subscriber count (for debugging)
 */
export function getSubscriberCount() {
	return subscribers.size;
}

/**
 * Close the current EventSource while keeping subscribers registered.
 * Used when a tab has stayed hidden past its grace period; the visibility hook
 * reconnects the stream when the user returns to the tab.
 */
export function pauseSSEUntilVisible() {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	ensureVisibilityHook();
	reconnectWhenVisible = subscribers.size > 0;
	console.log(`[SSE] Pausing stream until visible (clientId=${connectionId}, subscribers=${subscribers.size}, lang=${language}, fop=${currentFop || 'global'})`);
	if (eventSource) {
		eventSource.close();
		eventSource = null;
	}
}

/**
 * Forcibly close the shared SSE connection and drop all subscribers.
 * Used by the inactivity timeout: once a tab is declared idle we release the
 * server-side stream (triggers the server abort/cleanup path) and prevent any
 * automatic reconnect until the user explicitly reloads the page.
 */
export function disconnectSSE() {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	reconnectWhenVisible = false;
	subscribers.clear();
	clientCount = 0;
	if (eventSource) {
		eventSource.close();
		eventSource = null;
	}
}
