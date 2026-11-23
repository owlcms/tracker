<script>
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { translations } from '$lib/stores.js';
	import { subscribeSSE, connectSSE, getClientId, pauseSSEUntilVisible } from '$lib/sse-client.js';
	import { onMount, onDestroy } from 'svelte';
	
	// Pre-import all page*.svelte files using glob (supports nested plugins and additional pages)
	// Vite transforms this at build time into a map of path -> dynamic import function
	const pageModules = import.meta.glob('../../plugins/**/page*.svelte');
	
	export let data;
	
	let scoreboardData = null;
	let scoreboardError = null;
	let unsubscribeSSE = null;

	// Track direct decision SSE payloads so in-flight API fetches cannot overwrite
	// newer decision event state with an older snapshot.
	let lastDecisionSseTime = 0;
	let latestDecisionSse = null;
	let latestDecisionFopUpdate = null;
	let latestDecisionDisplayMode = null;
	let latestDecisionBlockSse = null;
	let serverClockOffsetMs = 0;
	
	// Check if this plugin manages its own SSE or doesn't need live updates
	// - documents: static content, no live updates needed
	// - customSSE: plugin has its own SSE connection (e.g., display-output, display-control)
	// Use direct property access since this is needed at mount time
	const skipRouteSSE = data.config?.category === 'documents' || 
	                      data.config?.customSSE === true;
	
	// Get language preference from URL parameter or config default or fallback to 'en'
	$: language = $page.url.searchParams.get('lang') || $page.url.searchParams.get('language') || data.config?.options?.find(o => o.key === 'language')?.default || 'en';
	
	function buildApiUrl() {
		const params = new URLSearchParams({ type: data.scoreboardType, lang: language });

		if (data.fopName) {
			params.set('fop', data.fopName);
		}

		// Correlate this stateless API call with our SSE stream so the server can
		// track liveness and reap streams whose client has stopped querying.
		if (browser) {
			params.set('clientId', getClientId());
		}

		for (const [key, value] of Object.entries(data.options || {})) {
			params.set(key, String(value));
		}

		return `/api/scoreboard?${params.toString()}`;
	}

	$: apiUrl = buildApiUrl();

	function reportCelebrationsDecisionSse(message) {
		if (!browser || data.scoreboardType !== 'celebrations') return;

		const decision = message.decision || {};
		void fetch('/api/client-log', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				source: 'celebrations',
				category: 'decision.sse',
				message: 'Received decision SSE event.',
				details: {
					action: 'decision_sse_received',
					fop: message.fop,
					fopState: message.data?.fopState || '',
					decisionType: decision.type || '',
					decisionVisible: decision.visible === true,
					athlete: decision.athleteName || '',
					attempt: Number.parseInt(decision.attemptNumber, 10) || null
				}
			}),
			keepalive: true
		}).catch((error) => console.warn('[Celebrations] Could not report decision SSE trace:', error));
	}

	// Hidden-tab grace period: when the tab is hidden we keep querying the API for
	// a short while so a quick tab switch does not make the scoreboard fall behind.
	// After the grace period a hidden tab stops querying; the server then reaps its
	// SSE stream once it has been silent long enough. Coming back to the foreground
	// resets this and triggers an immediate catch-up fetch.
	const HIDDEN_GRACE_MS = 5 * 60 * 1000; // 5 minutes
	let hiddenSince = null;
	let hiddenGraceTimer = null;

	function shouldQuery() {
		if (typeof document === 'undefined') return true;
		if (document.visibilityState === 'visible') return true;
		// Hidden: keep querying only during the grace window.
		return hiddenSince !== null && (Date.now() - hiddenSince) < HIDDEN_GRACE_MS;
	}

	function clearHiddenGraceTimer() {
		if (hiddenGraceTimer) {
			clearTimeout(hiddenGraceTimer);
			hiddenGraceTimer = null;
		}
	}

	function scheduleHiddenGracePause() {
		clearHiddenGraceTimer();
		hiddenGraceTimer = setTimeout(() => {
			hiddenGraceTimer = null;
			if (document.visibilityState === 'hidden' && !skipRouteSSE) {
				console.log(`[Scoreboard] Hidden grace exceeded; pausing SSE (clientId=${getClientId()})`);
				pauseSSEUntilVisible();
			}
		}, HIDDEN_GRACE_MS);
	}
	
	// Fetch scoreboard data from API
	async function fetchData() {
		// Skip API queries once a hidden tab is past its grace period.
		if (!shouldQuery()) {
			return;
		}
		// Capture timestamp before the async fetch so we can detect if a decision SSE
		// arrived while we were waiting for the response.
		const fetchStart = Date.now();
		try {
			const response = await fetch(apiUrl);
			const result = await response.json();
			
			if (result.success) {
				// console.log('[Scoreboard] API returned:', result.data?.currentAttempt?.weight || result.data?.weight || 'no weight');
				let nextData = result.data;
				const decisionSseIsNewer = lastDecisionSseTime > fetchStart && latestDecisionSse != null;

				if (decisionSseIsNewer) {
					nextData = {
						...nextData,
						decision: latestDecisionSse,
						fopUpdate: latestDecisionFopUpdate ?? nextData.fopUpdate
					};
					if (latestDecisionDisplayMode != null) {
						nextData = { ...nextData, displayMode: latestDecisionDisplayMode };
					}
				}
				if (latestDecisionBlockSse != null
					&& (latestDecisionBlockSse.sequence ?? -1) > (nextData.decisionBlock?.sequence ?? -1)) {
					nextData = { ...nextData, decisionBlock: latestDecisionBlockSse };
				}
				nextData = { ...nextData, serverClockOffsetMs };

				scoreboardData = nextData;
				scoreboardError = null;
			} else {
				console.error('[Scoreboard] API error:', result.error);
				scoreboardError = result.error || 'Scoreboard API error';
			}
		} catch (err) {
			console.error('[Scoreboard] Fetch error:', err);
			scoreboardError = err?.message || 'Network error fetching scoreboard data';
		}
	}

	function onVisibilityChange() {
		if (document.visibilityState === 'hidden') {
			if (hiddenSince === null) hiddenSince = Date.now();
			console.log(`[Scoreboard] Tab hidden; starting grace timer (clientId=${getClientId()}, graceMs=${HIDDEN_GRACE_MS})`);
			scheduleHiddenGracePause();
		} else {
			const hiddenDurationMs = hiddenSince === null ? 0 : Date.now() - hiddenSince;
			clearHiddenGraceTimer();
			hiddenSince = null;
			if (hiddenDurationMs >= HIDDEN_GRACE_MS) {
				console.log(`[Scoreboard] Tab visible after grace; reconnect/fetch path confirmed (clientId=${getClientId()}, hiddenMs=${hiddenDurationMs})`);
			}
			// Catch up immediately on return to the foreground.
			fetchData();
		}
	}
	
	onMount(() => {
		console.log('[Scoreboard] Mount - skipRouteSSE:', skipRouteSSE, 'category:', data.config?.category);
		
		// For plugins with customSSE or category=documents, use server load data directly
		// These plugins either manage their own data fetching or are static content
		if (skipRouteSSE) {
			console.log('[Scoreboard] Using server load data (skipRouteSSE=true)');
			scoreboardData = data;  // Pass the entire server load data object
			return;
		}
		
		// Initial fetch for regular scoreboards
		fetchData();

		// Track tab visibility to drive the hidden-tab grace period.
		if (browser) {
			document.addEventListener('visibilitychange', onVisibilityChange);
			if (document.visibilityState === 'hidden') {
				onVisibilityChange();
			}
		}
		
		// Connect to shared SSE (browser only) - skip for plugins that manage their own SSE
		if (browser && !skipRouteSSE) {
			// Pass fopName so SSE broker only sends events for this FOP (+ global events)
			// Pass scoreboardType so the server can count watchers per scoreboard.
			connectSSE(language, data.fopName, data.scoreboardType);
			unsubscribeSSE = subscribeSSE((message) => {
				// Per-message tracking silenced to reduce log noise during load tests.
				// console.log('[Scoreboard] SSE received:', message.type, message.fop || '', JSON.stringify(message.timer || message.decision || {}).substring(0, 100));
				
				if (typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)) {
					serverClockOffsetMs = message.timestamp - Date.now();
				}

				// Handle translation updates
				if (message.type === 'translations') {
					translations.setLocale(message.locale, message.data);
					return;
				}
				
				// Handle timer events directly (no API fetch)
				// Server provides displayMode computed with full FOP context
				if (message.type === 'timer' && message.fop === data.fopName) {
					if (message.decisionBlock) {
						latestDecisionBlockSse = message.decisionBlock;
					}
					if (scoreboardData) {
						scoreboardData = {
							...scoreboardData,
							timer: message.timer,
							breakTimer: message.breakTimer ?? scoreboardData.breakTimer,
							displayMode: message.displayMode,
							decisionBlock: message.decisionBlock ?? scoreboardData.decisionBlock,
							serverClockOffsetMs
						};
					}
					return;
				}
				
				// Handle decision events directly (no API fetch)
				// Server provides displayMode computed with full FOP context
				if (message.type === 'decision' && message.fop === data.fopName) {
					reportCelebrationsDecisionSse(message);
					lastDecisionSseTime = Date.now();
					latestDecisionSse = message.decision;
					latestDecisionFopUpdate = message.data ?? null;
					latestDecisionDisplayMode = message.displayMode;
					if (message.decisionBlock) {
						latestDecisionBlockSse = message.decisionBlock;
					}
					if (scoreboardData) {
						// A NEW record is announced only on the decision frame, so apply the
						// green banner directly (no API round-trip). The "attempt" banner is
						// deliberately NOT derived here: it reflects the CURRENT athlete's
						// challenge, which is owned by update frames. A decision/RESET frame
						// can echo a stale recordKind:"attempt"; honouring it would make the
						// purple banner stick. We only act on the genuine "new" outcome and
						// otherwise leave recordStatus to be (re)computed by update frames.
						const recordStatus = message.decision?.recordKind === 'new'
							? { kind: 'new', message: message.decision.recordMessage || null }
							: scoreboardData.recordStatus;
						scoreboardData = {
							...scoreboardData,
							fopUpdate: message.data ?? scoreboardData.fopUpdate,
							decision: message.decision,
							displayMode: message.displayMode,
							decisionBlock: message.decisionBlock ?? scoreboardData.decisionBlock,
							mode: message.data?.mode ?? scoreboardData.mode,
							serverClockOffsetMs,
							recordStatus
						};
					}
					return;
				}
				
				// Refresh data on any competition update or hub ready
				if (message.type === 'fop_update' || message.type === 'state_update' || message.type === 'competition_update' || message.type === 'hub_ready') {
					// console.log('[Scoreboard] Triggering fetchData() for', message.type);
					fetchData();
				}
			});
		}
	});
	
	onDestroy(() => {
		if (browser) {
			clearHiddenGraceTimer();
			document.removeEventListener('visibilitychange', onVisibilityChange);
		}
		if (unsubscribeSSE) {
			console.log('[Scoreboard Destroy] Unsubscribing from SSE');
			unsubscribeSSE();
		}
	});
	
	// Reconnect SSE if language changes (browser only)
	$: if (browser && language && !skipRouteSSE) {
		connectSSE(language, data.fopName, data.scoreboardType);
	}
</script>

<svelte:head>
	<title>{data.scoreboardName} - {data.fopName === '*' ? 'All FOPs' : `FOP ${data.fopName}`}</title>
</svelte:head>

{#if scoreboardData}
	<!-- Dynamically import the scoreboard component using pluginPath -->
	<!-- Uses glob map to support nested plugins (e.g., books/iwf-startbook) -->
	<!-- Runtime plugins can use delegateTo to use a built-in plugin's page component -->
	<!-- Additional pages (from config.pages[]) use pageComponent field -->
	{@const delegatePath = data.config?.delegateTo}
	{@const componentFile = data.config?.pageComponent || 'page.svelte'}
	{@const modulePath = delegatePath 
		? `../../plugins/${delegatePath}/${componentFile}`
		: `../../plugins/${data.pluginPath}/${componentFile}`}
	{@const moduleLoader = pageModules[modulePath]}
	{#if moduleLoader}
		{#await moduleLoader()}
			<div class="loading">Loading scoreboard...</div>
		{:then module}
			<svelte:component this={module.default} data={scoreboardData} config={data.config} options={data.options} scoreboardType={data.scoreboardType} />
		{:catch error}
			<div class="error">
				<h1>Error Loading Scoreboard</h1>
				<p>{error.message}</p>
				<p>Scoreboard type: <code>{data.scoreboardType}</code></p>
				<p>Plugin path: <code>{data.pluginPath}</code></p>
			</div>
		{/await}
	{:else}
		<div class="error">
			<h1>Scoreboard Component Not Found</h1>
			<p>No page.svelte at path: <code>{modulePath}</code></p>
			<p>Scoreboard type: <code>{data.scoreboardType}</code></p>
		</div>
	{/if}
{:else}
	<div class="loading">
		<h1>Loading {data.scoreboardName}...</h1>
		<p>{data.fopName === '*' ? 'All FOPs' : `FOP: ${data.fopName}`}</p>
		{#if scoreboardError}
			<p class="error-note">{scoreboardError}</p>
		{/if}
	</div>
{/if}

<style>
	.loading, .error {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		background: #1a1a1a;
		color: white;
		font-family: Arial, sans-serif;
	}
	
	.error {
		background: #2a1a1a;
	}
	
	.error code {
		background: #3a2a2a;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		font-family: 'Courier New', monospace;
	}
	
	h1 {
		font-size: 2rem;
		margin-bottom: 1rem;
	}
	
	p {
		font-size: 1.2rem;
		color: #aaa;
	}

	.error-note {
		margin-top: 0.75rem;
		max-width: 60rem;
		padding: 0.75rem 1rem;
		background: #2a1a1a;
		border: 1px solid #7f1d1d;
		border-radius: 6px;
		color: #fecaca;
		font-size: 1rem;
	}
</style>
