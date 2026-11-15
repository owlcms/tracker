/**
 * Generic Plugin Action API Endpoint
 * 
 * Dynamically routes action requests to plugin handlers.
 * Plugins export a `handleAction({ action, options })` function in helpers.data.js
 * 
 * GET/POST: /api/plugin-action?plugin=remoteControl&action=status&...options
 * POST may carry the options as a JSON object body instead, which keeps secrets out of URLs.
 */

import { json } from '@sveltejs/kit';
import { scoreboardRegistry } from '$lib/server/scoreboard-registry.js';
import { buildOptions } from '$lib/server/build-options.js';

export async function GET({ url }) {
  return handleRequest(url);
}

// JSON rather than a form body: SvelteKit refuses form posts whose Origin differs from the origin it computes, which
// adapter-node assumes is https unless ORIGIN is set, so form posts fail on a plain-http Tracker.
export async function POST({ url, request }) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return handleRequest(url);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'invalid_options' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ success: false, error: 'invalid_options' }, { status: 400 });
  }
  const searchParams = new URLSearchParams(url.searchParams);
  for (const [key, value] of Object.entries(body)) {
    if (key === 'plugin' || key === 'action' || (value !== null && typeof value === 'object')) {
      return json({ success: false, error: 'invalid_options' }, { status: 400 });
    }
    if (value !== undefined && value !== null) searchParams.set(key, String(value));
  }
  return handleRequest(url, searchParams);
}

async function handleRequest(url, optionParams = url.searchParams) {
  const pluginName = url.searchParams.get('plugin');
  const action = url.searchParams.get('action') || 'status';

  if (!pluginName) {
    return json({
      success: false,
      error: 'missing_plugin',
      message: 'Plugin name is required. Example: ?plugin=remoteControl&action=status'
    }, { status: 400 });
  }

  // Initialize registry if needed
  await scoreboardRegistry.initialize();

  // Get the plugin
  const scoreboard = scoreboardRegistry.getScoreboard(pluginName);
  if (!scoreboard) {
    return json({
      success: false,
      error: 'plugin_not_found',
      message: `Plugin "${pluginName}" not found`
    }, { status: 404 });
  }

  // Check if plugin has an action handler
  if (typeof scoreboard.handleAction !== 'function' && action !== 'saveOptions') {
    return json({
      success: false,
      error: 'no_action_handler',
      message: `Plugin "${pluginName}" does not support actions`
    }, { status: 400 });
  }

  // Build options: config defaults (base then extension) + URL overrides
  const options = buildOptions({
    scoreboard,
    url: { searchParams: optionParams },
    reservedKeys: new Set(['plugin', 'action']),
    registry: scoreboardRegistry
  });

  try {
    let result;

    if (action === 'saveOptions') {
      // Generic handler: persist supplied option values as defaults.
      // Available for every plugin that declares options (unless persistOptions: false).
      if (scoreboard.config?.persistOptions === false) {
        return json({
          success: false,
          error: 'save_disabled',
          message: `Plugin "${pluginName}" has persistOptions disabled`
        }, { status: 400 });
      }
      result = scoreboardRegistry.saveOptionDefaults(pluginName, options);
      if (result.success) {
        result = {
          ...result,
          message: `Saved defaults for ${result.savedKeys.length} option(s).`,
          refreshRegistry: true,
          refreshData: true
        };
      } else {
        result = {
          ...result,
          message: result.message || `Could not save defaults: ${result.error}`
        };
      }
    } else {
      result = await scoreboard.handleAction({ action, options });
    }

    if (result?.refreshRegistry === true) {
      const registryRefreshed = await scoreboardRegistry.reloadScoreboard(pluginName);
      result = {
        ...result,
        registryRefreshed
      };
    }
    
    // Handle binary responses (e.g., Excel files)
    if (result.binary === true && result.buffer && result.contentType && result.filename) {
      const buffer = Buffer.from(result.buffer, 'base64');
      return new Response(buffer, {
        headers: {
          'Content-Type': result.contentType,
          'Content-Disposition': `attachment; filename="${result.filename}"`,
          'Cache-Control': 'no-cache'
        }
      });
    }
    
    // Default JSON response
    return json(result);
  } catch (error) {
    console.error(`[Plugin Action] Error in ${pluginName}.${action}:`, error);
    return json({
      success: false,
      error: 'action_failed',
      message: error.message
    }, { status: 500 });
  }
}
