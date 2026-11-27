/**
 * SSE Broker - Central hub event listener and client broadcaster
 * 
 * Architecture:
 * - Listens to competitionHub events (hub_ready_broadcast, fop_update, etc.)
 * - Maintains a set of send functions for connected clients
 * - Broadcasts events to all connected clients
 */

import { competitionHub } from './competition-hub.js';
import { logger } from '@owlcms/tracker-core';

const SCOREBOARD_CLIENT_IDLE_MS = 30 * 60 * 1000;
const IDLE_REAPER_INTERVAL_MS = 60 * 1000;

class SSEBroker {
  constructor() {
    this.clients = new Set(); // Set of { send, connectionId, clientId, fopName } objects
    this.hubListenersAttached = false;
    this.reaperInterval = null;
  }

  startIdleReaper() {
    if (this.reaperInterval) return;

    this.reaperInterval = setInterval(() => this.reapIdleClients(), IDLE_REAPER_INTERVAL_MS);
    if (typeof this.reaperInterval.unref === 'function') {
      this.reaperInterval.unref();
    }
  }

  /**
   * Attach listeners to competition hub (called once on first client)
   */
  attachHubListeners() {
    if (this.hubListenersAttached) return;
    
    logger.debug('[SSE Broker] Attaching hub event listeners');

    competitionHub.on('protocol_error', (eventData) => {
      this.broadcast({
        type: 'protocol_error',
        reason: eventData?.reason || 'Protocol error',
        received: eventData?.received || null,
        minimum: eventData?.minimum || null,
        source: eventData?.source || null,
        timestamp: eventData?.timestamp || Date.now()
      });
    });

    competitionHub.on('protocol_ok', (eventData) => {
      this.broadcast({
        type: 'protocol_ok',
        timestamp: eventData?.timestamp || Date.now()
      });
    });
    
    competitionHub.on('fop_update', (eventData) => {
      this.broadcast({
        type: 'fop_update',
        fop: eventData.fop,
        data: eventData.data,
        timestamp: eventData.timestamp
      });
    });

    competitionHub.on('timer', (eventData) => {
      this.broadcast({
        type: 'timer',
        fop: eventData.fop,
        timer: eventData.timer,
        breakTimer: eventData.breakTimer,
        displayMode: eventData.displayMode,
        timestamp: eventData.timestamp
      });
    });

    competitionHub.on('decision', (eventData) => {
      this.broadcast({
        type: 'decision',
        fop: eventData.fop,
		data: eventData.data,
        decision: eventData.decision,
        displayMode: eventData.displayMode,
        timestamp: eventData.timestamp
      });
    });

    competitionHub.on('competition_initialized', (eventData) => {
      this.broadcast({
        type: 'competition_initialized',
        payload: eventData.payload,
        timestamp: eventData.timestamp
      });
    });

    competitionHub.on('hub_ready_broadcast', (eventData) => {
      logger.debug('[SSE Broker] hub_ready_broadcast received, broadcasting to', this.clients.size, 'clients');
      this.broadcast({
        type: 'hub_ready',
        message: eventData.message,
        timestamp: eventData.timestamp
      });
    });

    competitionHub.on('waiting', (eventData) => {
      this.broadcast({
        type: 'waiting',
        message: eventData.message,
        timestamp: eventData.timestamp
      });
    });

    this.hubListenersAttached = true;
  }

  /**
   * Register an external event source (e.g., OBS controller)
   * @param {EventEmitter} emitter - EventEmitter that emits events
   * @param {string} eventName - Event name to listen for
   */
  registerExternalSource(emitter, eventName) {
    emitter.on(eventName, (eventData) => {
      this.broadcast(eventData);
    });
  }

  /**
   * Register a new SSE client connection
   * @param {Function} sendFn - Function to send data to this client
   * @param {string} connectionId - Unique connection identifier
   * @param {string|null} fopName - FOP name to filter events (null = global events only)
   * @param {string[]|null} types - Optional list of event types to receive (null = all)
   * @param {Object} options - Optional client metadata
   * @param {string|null} options.clientId - Stable browser-tab id shared with /api/scoreboard
   * @param {Function|null} options.close - Function that closes this SSE stream
   * @returns {Function} Unregister function
   */
  registerClient(sendFn, connectionId, fopName = null, types = null, options = {}) {
    // Attach hub listeners on first client
    if (!this.hubListenersAttached) {
      this.attachHubListeners();
    }
    this.startIdleReaper();
    
    const typeSet = Array.isArray(types) && types.length > 0 ? new Set(types) : null;
    const clientId = options?.clientId || null;
    const close = typeof options?.close === 'function' ? options.close : null;
    // Scoreboard type drives the per-scoreboard watcher counts. Different
    // languages/settings of the same scoreboard are intentionally counted
    // together so the totals reflect load per scoreboard.
    const scoreboardType = options?.scoreboardType || null;

    // A tab keeps a stable clientId across reconnects. When it reconnects (e.g. a
    // hidden tab being reactivated re-opens its SSE stream before the old stream's
    // abort has fired), evict the stale registration so the same tab is counted
    // once instead of inflating the watcher totals.
    if (clientId) {
      for (const existing of this.clients) {
        if (existing.clientId === clientId) {
          this.clients.delete(existing);
          if (typeof existing.close === 'function') {
            try {
              existing.close();
            } catch {
              // stale stream may already be closed; ignore
            }
          }
        }
      }
    }

    const client = {
      send: sendFn,
      connectionId,
      clientId,
      fopName,
      scoreboardType,
      noExpiry: options?.noExpiry === true,
      types: typeSet,
      lastSeen: clientId ? Date.now() : null,
      close
    };
    this.clients.add(client);
    
    // Per-connection +1/-1 lines are intentionally omitted; only the aggregate
    // per-scoreboard/per-FOP distribution is logged on arrival/departure.
    this.logScoreboardDistribution({ byFop: true });
    
    return () => {
      this.clients.delete(client);
      this.logScoreboardDistribution({ byFop: true });
    };
  }

  markSeen(clientId) {
    if (!clientId) return 0;

    const now = Date.now();
    let seen = 0;
    for (const client of this.clients) {
      if (client.clientId === clientId) {
        client.lastSeen = now;
        seen++;
      }
    }
    logger.debug(`[SSE Broker] markSeen clientId=${clientId} matched=${seen}`);
    return seen;
  }

  reapIdleClients() {
    if (this.clients.size === 0) return;

    const now = Date.now();
    for (const client of Array.from(this.clients)) {
      if (client.noExpiry || !client.clientId || !client.lastSeen) continue;

      const idleMs = now - client.lastSeen;
      if (idleMs < SCOREBOARD_CLIENT_IDLE_MS) continue;

      logger.info(`[SSE Broker] Reaping idle scoreboard client ${client.connectionId} (clientId=${client.clientId}, idleMs=${idleMs})`);
      if (client.close) {
        client.close();
      } else {
        this.clients.delete(client);
      }
    }
  }

  /**
   * Broadcast message to connected clients (optimized with FOP filtering)
   * Serializes JSON once and encodes once, then sends same bytes to matching clients
   * 
   * FOP Filtering Rules:
  * - message.fop is null (global event) → send to ALL clients
  * - message.fop is set → send to exact FOP subscribers and all-FOP subscribers ('*')
  * - client.fopName is null → only receives global events (message.fop is null)
   */
  broadcast(message) {
    if (this.clients.size === 0) return;

    const eventFop = message.fop || null;  // null = global event

    // Serialize JSON once for all clients
    let jsonString;
    try {
      jsonString = JSON.stringify(message);
    } catch (error) {
      console.error('[SSE Broker] Failed to serialize message:', error.message);
      return;
    }

    // Format SSE message once
    const sseMessage = `data: ${jsonString}\n\n`;

    // Encode to bytes once
    const encoder = new TextEncoder();
    const encodedBytes = encoder.encode(sseMessage);

    // Send to matching clients only
    for (const client of this.clients) {
      // FOP filtering:
      // - Global events (eventFop === null) go to everyone
      // - FOP-specific events go to exact FOP subscribers and all-FOP subscribers
      const isGlobalEvent = eventFop === null;
      const clientMatchesFop = client.fopName === eventFop;
      const clientWantsAllFops = client.fopName === '*';
      const clientWantsType = !client.types || client.types.has(message.type);
      
      if (clientWantsType && (isGlobalEvent || clientMatchesFop || clientWantsAllFops)) {
        try {
          client.send(encodedBytes);
        } catch (error) {
          logger.debug(`[SSE Broker] Error sending to client ${client.connectionId}:`, error.message);
          this.clients.delete(client);
        }
      }
    }

    // Per-event delivery stats are intentionally silenced to keep the logs
    // focused on scoreboard watcher counts (see logScoreboardDistribution).
  }

  /**
   * Get watcher counts per scoreboard type (aggregated across languages/settings).
   * @param {Object} [options]
   * @param {boolean} [options.byFop=false] - When true, slice each scoreboard by FOP:
   *   returns { [scoreboardType]: { total, fops: { [fopName]: count } } }.
   *   When false (default), returns the flat { [scoreboardType]: count } map.
   * @returns {Object}
   */
  getScoreboardStats({ byFop = false } = {}) {
    if (!byFop) {
      const counts = {};
      for (const client of this.clients) {
        const sb = client.scoreboardType || 'other';
        counts[sb] = (counts[sb] || 0) + 1;
      }
      return counts;
    }

    const sliced = {};
    for (const client of this.clients) {
      const sb = client.scoreboardType || 'other';
      const fop = client.fopName || 'global';
      if (!sliced[sb]) {
        sliced[sb] = { total: 0, fops: {} };
      }
      sliced[sb].total += 1;
      sliced[sb].fops[fop] = (sliced[sb].fops[fop] || 0) + 1;
    }
    return sliced;
  }

  /**
   * Log the number of active connections to each scoreboard.
   * @param {Object} [options]
   * @param {boolean} [options.byFop=false] - When true, also break each scoreboard down by FOP.
   */
  logScoreboardDistribution({ byFop = false } = {}) {
    const total = this.clients.size;

    if (byFop) {
      const sliced = this.getScoreboardStats({ byFop: true });
      const parts = [];
      for (const [sb, { fops }] of Object.entries(sliced).sort(([a], [b]) => a.localeCompare(b))) {
        for (const [fop, count] of Object.entries(fops).sort(([a], [b]) => a.localeCompare(b))) {
          parts.push(`${sb}/${fop}=${count}`);
        }
      }
      logger.info(`[Scoreboards] watchers: ${parts.join(', ') || 'none'} (total=${total})`);
      return;
    }

    const counts = this.getScoreboardStats();
    const parts = Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sb, count]) => `${sb}=${count}`);
    logger.info(`[Scoreboards] watchers: ${parts.join(', ') || 'none'} (total=${total})`);
  }

  getActiveClientCount() {
    return this.clients.size;
  }

  /**
   * Get metrics object
   */
  getMetrics() {
    return {
      activeClients: this.clients.size
    };
  }
}

// Singleton instance
if (!globalThis.__sseBroker) {
  globalThis.__sseBroker = new SSEBroker();
} else {
  Object.setPrototypeOf(globalThis.__sseBroker, SSEBroker.prototype);
  globalThis.__sseBroker.reaperInterval ??= null;
}

export const sseBroker = globalThis.__sseBroker;
