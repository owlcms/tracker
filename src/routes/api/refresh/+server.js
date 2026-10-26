import { json } from '@sveltejs/kit';
import { competitionHub } from '@owlcms/tracker-core';
import { scoreboardRegistry } from '$lib/server/scoreboard-registry.js';

/**
 * Manual refresh endpoint
 * POST - Flush all plugin caches (keeps hub data, rebuilds from last OWLCMS data)
 * POST with ?fullRefresh=true - Ask OWLCMS to resend fresh copies of everything the
 *   tracker holds (database, translations, flags, and logos/pictures/GAMX when loaded),
 *   wait for them, then flush caches. The OWLCMS connection stays open.
 * 
 * Both modes broadcast an SSE event so browsers automatically re-fetch data.
 */
export async function POST({ url }) {
  try {
    const fullRefresh = url.searchParams.get('fullRefresh') === 'true';
    
    console.log('[API] Refresh requested: fullRefresh=' + fullRefresh);
    
    // Full refresh: fetch fresh data from OWLCMS before flushing, so browsers re-fetch fresh data
    let refresh = null;
    if (fullRefresh) {
      refresh = await competitionHub.requestFullRefresh();
    }
    
    // Flush all plugin caches via the registry
    const cacheEpoch = scoreboardRegistry.flushCaches();
    
    // Broadcast refresh event to all connected browsers via SSE
    // This triggers browsers to re-fetch their scoreboard data immediately
    const fops = competitionHub.getAvailableFOPs();
    for (const fop of fops) {
      competitionHub.emit('fop_update', {
        fop,
        data: { refreshTriggered: true, cacheEpoch },
        timestamp: Date.now()
      });
    }
    // Also emit for browsers not listening to a specific FOP
    competitionHub.emit('fop_update', {
      fop: 'ALL',
      data: { refreshTriggered: true, cacheEpoch },
      timestamp: Date.now()
    });
    
    return json({
      success: true,
      message: fullRefresh 
        ? (!refresh.sent
            ? 'Full refresh requested but no active OWLCMS connection'
            : refresh.timedOut.length > 0
              ? `Full refresh - timed out waiting for ${refresh.timedOut.join(', ')}`
              : 'Full refresh - fresh data received from OWLCMS')
        : 'Plugin caches flushed - browsers notified to re-fetch',
      fullRefresh,
      ...(refresh ? { refreshed: refresh.received, timedOut: refresh.timedOut } : {}),
      cacheEpoch,
      browsersNotified: fops.length + 1,
      timestamp: Date.now()
    });
  } catch (err) {
    console.error('[API] Refresh error:', err);
    return json({ 
      error: 'internal_error',
      message: err.message,
      timestamp: Date.now()
    }, { status: 500 });
  }
}

/**
 * Get refresh status
 */
export async function GET() {
  // Import hub dynamically to avoid circular dependencies
  const { competitionHub } = await import('@owlcms/tracker-core');
  
  return json({
    isReady: competitionHub.isReady(),
    fops: competitionHub.getAvailableFOPs(),
    timestamp: Date.now()
  });
}