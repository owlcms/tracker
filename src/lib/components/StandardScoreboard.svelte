<script>
	import { createTimer } from '$lib/timer-logic.js';
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import { disconnectSSE } from '$lib/sse-client.js';
	import RecordsSection from '$lib/components/RecordsSection.svelte';
	import CurrentAttemptBar from '$lib/components/CurrentAttemptBar.svelte';
	import AthletesGrid from '$lib/components/AthletesGrid.svelte';
	
	// Props passed from parent route
	export let data = {};
	
	// Timer state using reusable timer logic (not used directly, but kept for compatibility)
	let timerState = { seconds: 0, isRunning: false, isWarning: false, display: '0:00' };
	
	// Create timer instance
	const timer = createTimer();
	const unsubscribe = timer.subscribe(state => {
		timerState = state;
	});
	
	// Use pre-translated headers from server (optimized for cloud)
	$: headers = data.headers || {};

	// --- Inactivity timeout -------------------------------------------------
	// Hidden scoreboards expire quickly because nobody is watching them. Visible
	// scoreboards expire only when the competition data has been quiet long enough
	// to indicate an end-of-day or dead-connection state. After either limit we
	// show the overlay and release the SSE stream so the page must be reloaded to
	// come back.
	//
	// This is the client-visible half of inactivity handling. Reclaiming the
	// server-side SSE stream for tabs that nobody is watching (switched away,
	// phone asleep) is handled separately and authoritatively on the server: the
	// page only queries /api/scoreboard while it is visible, and the SSE broker
	// reaps streams whose client has stopped querying.
	const HIDDEN_INACTIVITY_LIMIT_MS = 30 * 60 * 1000;      // 30 minutes hidden
	const COMPETITION_DEAD_LIMIT_MS = 30 * 60 * 1000;       // 30 minutes without data
	const INACTIVITY_CHECK_MS = 30 * 1000;                  // evaluate every 30 s
	let lastCompetitionActivity = Date.now();
	let hiddenStartedAt = null;
	let inactivityExpired = false;
	let inactivityCheckId = null;

	$: inactivityStrings = data.inactivity || {};

	function markCompetitionActivity() {
		// Once expired we stay expired until the user reloads explicitly.
		if (inactivityExpired) return;
		lastCompetitionActivity = Date.now();
	}

	function checkInactivity() {
		if (inactivityExpired) return;
		if (hiddenStartedAt !== null && Date.now() - hiddenStartedAt >= HIDDEN_INACTIVITY_LIMIT_MS) {
			console.warn(`[Inactivity] Expired: hidden too long (hiddenMs=${Date.now() - hiddenStartedAt})`);
			inactivityExpired = true;
			disconnectSSE();
			return;
		}
		if (document.visibilityState === 'hidden') return;
		if (Date.now() - lastCompetitionActivity < COMPETITION_DEAD_LIMIT_MS) return;
		console.warn(`[Inactivity] Expired: competition dead (quietMs=${Date.now() - lastCompetitionActivity})`);
		inactivityExpired = true;
		// Release the server-side SSE stream; do not auto-reconnect.
		disconnectSSE();
	}

	function checkVisibilityInactivity() {
		if (document.visibilityState === 'hidden') {
			if (hiddenStartedAt === null) hiddenStartedAt = Date.now();
			console.log(`[Inactivity] visibilitychange -> hidden (hiddenLimit=${HIDDEN_INACTIVITY_LIMIT_MS}ms)`);
		} else {
			const hiddenMs = hiddenStartedAt === null ? 0 : Date.now() - hiddenStartedAt;
			console.log(`[Inactivity] visibilitychange -> visible (hiddenMs=${hiddenMs})`);
			checkInactivity();
			hiddenStartedAt = null;
		}
	}

	function reloadPage() {
		window.location.reload();
	}

	// Fresh data from the server (lastUpdate changes on every SSE-driven refresh,
	// timer tick, or decision) counts as competition activity and resets the clock.
	$: if (data && data.lastUpdate !== undefined) {
		void data.lastUpdate;
		markCompetitionActivity();
	}
	
	onMount(() => {
		timer.start(data.timer);

		lastCompetitionActivity = Date.now();
		// On wake / tab focus, evaluate immediately instead of waiting for the tick.
		document.addEventListener('visibilitychange', checkVisibilityInactivity);
		inactivityCheckId = setInterval(checkInactivity, INACTIVITY_CHECK_MS);
	});
	
	onDestroy(() => {
		timer.stop();
		unsubscribe();

		if (inactivityCheckId) clearInterval(inactivityCheckId);
		document.removeEventListener('visibilitychange', checkVisibilityInactivity);
	});
	
	$: currentAttempt = data.currentAttempt;
	$: allAthletes = data.sortedAthletes || [];  // Standardized field name across all scoreboards
	$: decisionState = data.decision || {};
	
	// Use displayMode from server (computed by shared timer-decision-helpers)
	$: displayMode = data.displayMode || 'none';
	
	// Read showLeaders from URL parameter (default: true)
	$: showLeadersParam = $page.url.searchParams.get('showLeaders');
	$: showLeaders = showLeadersParam !== 'false';  // Default true unless explicitly set to false
	$: hasLeaders = data.leaders && data.leaders.length > 0;
	
	// Read showRecords from URL parameter (default: true)
	$: showRecordsParam = $page.url.searchParams.get('showRecords');
	$: showRecords = showRecordsParam !== 'false';  // Default true unless explicitly set to false
	$: hasRecords = (data.records && data.records.length > 0) || !!data.personalRecords;

	// Read vFill from URL parameter (default: true) - controls elastic spacer row
	// vFill=true: 1fr elastic row pushes leaders to bottom
	// vFill=false: 1.5em fixed height spacer
	$: vFillParam = $page.url.searchParams.get('vFill');
	$: vFill = vFillParam !== 'false';  // Default true unless explicitly set to false
	
	// Compute grid template rows based on showLeaders URL parameter and available leaders
	// vFill controls whether the spacer row is elastic (1fr) or fixed (1.5em)
	$: spacerSize = vFill ? '1fr' : '1.5em';
	$: computedGridTemplateRows = (() => {
		if (showLeaders && hasLeaders) {
			return `repeat(${data.resultRows || 0}, minmax(10px, auto)) ${spacerSize} repeat(${data.leaderRows || 0}, minmax(10px, auto))`;
		} else {
			return `repeat(${data.resultRows || 0}, minmax(10px, auto)) ${spacerSize}`;
		}
	})();
	
	// Sync timer with server when data changes
	$: if (data.timer) {
		timer.syncWithServer(data.timer);
	}
</script>

<script context="module">
	export function shouldRenderFlag(url) {
		if (!url) return false;
		if (typeof url === 'string' && url.startsWith('data:image/')) return false;
		return true;
	}
</script>

<svelte:head>
	<title>{data.scoreboardName || 'Scoreboard'} - {data.competition?.name || 'OWLCMS'}</title>
</svelte:head>

<div class="scoreboard">
	<!-- Current Lifter Header (only show when we have data and session is selected) -->
	{#if data.status !== 'waiting' && data.attemptBarClass !== 'hide-because-null-session'}
		<CurrentAttemptBar 
			currentAttempt={data.currentAttempt}
			timerData={data.timer}
			breakTimerData={data.breakTimer}
			displayMode={displayMode}
			decisionState={data.decision}
			scoreboardName={data.scoreboardName}
			sessionStatus={data.sessionStatus}
			competition={data.competition}
			breakTitle={data.breakTitle}
			showDecisionLights={true}
			showTimer={true}
			compactMode={false}
		/>
	{/if}

	<!-- Main Scoreboard Table -->
	<main class="main">
		{#if data.status === 'waiting'}
			<div class="waiting">
				<p>{data.message || 'Waiting for competition data...'}</p>
			</div>
		{:else if data.attemptBarClass === 'hide-because-null-session'}
			<div class="waiting">
				<p>{headers.waitingNextSession}</p>
			</div>
		{:else}
			<div class="grid-container" class:no-vfill={!vFill} style="--template-rows: {computedGridTemplateRows}">
				<AthletesGrid 
					allAthletes={allAthletes}
					headers={headers} 
					showLeaders={showLeaders}
					hasLeaders={hasLeaders}
					data={data}
				/>
			</div>

			<!-- Records Section (Below Grid, Not Part of Grid) -->
			{#if showRecords && hasRecords}
				<RecordsSection records={data.records} personalRecords={data.personalRecords} headers={headers} recordStatus={data.recordStatus} />
			{/if}
		{/if}
	</main>
</div>

{#if inactivityExpired}
	<div class="inactivity-overlay">
		<div class="inactivity-panel">
			<h1 class="inactivity-title">{inactivityStrings.title || 'Inactivity Delay Exceeded'}</h1>
			<p class="inactivity-text">
				{inactivityStrings.text || 'This page has been inactive for too long. You can reload the page by using the button below.'}
			</p>
			<button class="inactivity-reload" type="button" on:click={reloadPage}>
				{inactivityStrings.reload || 'Reload'}
			</button>
		</div>
	</div>
{/if}

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		background: #000;
		color: #fff;
		font-family: Arial, sans-serif;
		overflow: hidden;
	}
	
	.scoreboard {
		width: 100vw;
		height: 100vh;
		height: 100dvh;
		background: #000;
		color: #fff;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	
	/* Main grid */
	.main {
		flex: 1;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		padding: 8px;
		background: #000;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	/* Waiting state */
	.waiting {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		font-size: 1.5rem;
		color: #888;
	}

	/* The athlete grid includes the previous-session leaders section. Fill
	   available space when rows are short, but do not shrink below the grid's
	   actual row content when rows exceed the viewport. */
	.grid-container {
		flex: 1 0 auto;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.grid-container :global(.scoreboard-grid) {
		flex: 1 0 auto;
	}

	/* Records are a separate block after the grid; keep them in the scroll flow
	   instead of letting flexbox compress them. */
	.main :global(.records-section) {
		flex: 0 0 auto;
	}

	/* When vFill=false, don't expand - let grid use natural height */
	.grid-container.no-vfill {
		flex: 0 0 auto;
	}

	/* Scrollbar styling */
	.main::-webkit-scrollbar {
		width: 0.625rem;
	}

	.main::-webkit-scrollbar-track {
		background: #000;
	}

	.main::-webkit-scrollbar-thumb {
		background: #333;
		border-radius: 0.3125rem;
	}

	.main::-webkit-scrollbar-thumb:hover {
		background: #555;
	}

	/* Responsive adjustments for landscape mode */
	@media (max-width: 1366px) and (orientation: landscape) {
		.main {
			padding: 6px;
		}
	}

	@media (max-width: 1280px) and (orientation: landscape) {
		.main {
			padding: 5px;
		}
	}

	@media (max-width: 926px) and (orientation: landscape) {
		.main {
			padding: 4px;
		}

		.waiting {
			font-size: 1.2rem;
		}
	}

	/* Inactivity timeout overlay */
	.inactivity-overlay {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.85);
		padding: 1rem;
	}

	.inactivity-panel {
		max-width: 32rem;
		width: 100%;
		background: #1b2a4a;
		border-radius: 0.75rem;
		padding: 2rem;
		text-align: center;
		box-shadow: 0 0.5rem 2rem rgba(0, 0, 0, 0.5);
	}

	.inactivity-title {
		margin: 0 0 1rem;
		color: #f5a623;
		font-size: 1.75rem;
		font-weight: 700;
	}

	.inactivity-text {
		margin: 0 0 1.75rem;
		color: #fff;
		font-size: 1.1rem;
		line-height: 1.5;
	}

	.inactivity-reload {
		display: inline-block;
		padding: 0.75rem 2rem;
		background: #2e7d32;
		color: #fff;
		border: none;
		border-radius: 0.375rem;
		font-size: 1.1rem;
		font-weight: 600;
		cursor: pointer;
	}

	.inactivity-reload:hover {
		background: #388e3c;
	}
</style>
