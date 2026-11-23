<script>
	/**
	 * Bottom decision section for standard scoreboards.
	 * Follows the OWLCMS Results.js (.decisionSection) layout and visibility rules:
	 *   [dsTimerSlot] [dsDecisionAthlete: startNumber + name + (ageGroups)] ... [dsDecisions: juryMessage + referee lights]
	 * Shows referee decisions and jury outcomes with the 20 s hold behavior (no live jury/panel vote circles, no down signal).
	 */
	import { onDestroy } from 'svelte';
	import CountdownTimer from './CountdownTimer.svelte';
	import { computeDecisionBlockView } from '$lib/decision-block-display.js';

	export let decisionBlock = null;
	export let mode = 'WAIT';
	export let currentAttempt = null;
	export let currentAthleteAgeGroups = '';
	export let breakText = '';
	export let timerData = null;
	export let breakTimerData = null;
	export let labels = {};
	export let options = {};
	export let competition = {};
	export let serverClockOffsetMs = 0;

	const ATHLETE_TIMER_COLOR = '#4ade80';
	const ATHLETE_TIMER_WARNING = '#fbbf24';
	const BREAK_TIMER_COLOR = '#00d4d4';
	const BREAK_TIMER_WARNING = '#00d4d4';

	let now = Date.now();
	let holdTimeoutId = null;
	let stopwatchIntervalId = null;

	$: showStopwatch = options?.showStopwatch === true;
	$: showAgeGroups = options?.showAgeGroups === true;

	$: view = computeDecisionBlockView({
		decisionBlock,
		mode,
		currentAttempt,
		currentAthleteAgeGroups,
		breakText,
		timerData: competition?.showTimer === false ? null : timerData,
		breakTimerData: competition?.showTimer === false ? null : breakTimerData,
		labels,
		showStopwatch,
		showAgeGroups,
		now,
		serverClockOffsetMs
	});

	function syncTimers(remainingHoldMs, stopwatchVisible) {
		clearTimeout(holdTimeoutId);
		holdTimeoutId = null;
		if (remainingHoldMs !== null) {
			holdTimeoutId = setTimeout(() => {
				now = Date.now();
			}, remainingHoldMs + 25);
		}
		if (stopwatchVisible && !stopwatchIntervalId) {
			stopwatchIntervalId = setInterval(() => {
				now = Date.now();
			}, 250);
		} else if (!stopwatchVisible && stopwatchIntervalId) {
			clearInterval(stopwatchIntervalId);
			stopwatchIntervalId = null;
		}
	}

	function touchNow() {
		now = Date.now();
	}

	// Schedule local 20 s expiry timeout and review stopwatch ticks without reactive cycle
	$: syncTimers(view.remainingHoldMs, view.stopwatchVisible);

	// Re-evaluate local clock whenever a new decisionBlock arrives
	$: if (decisionBlock) {
		touchNow();
	}

	onDestroy(() => {
		clearTimeout(holdTimeoutId);
		if (stopwatchIntervalId) clearInterval(stopwatchIntervalId);
	});

	function getRefLightClass(cell) {
		if (cell === 'white') return 'good';
		if (cell === 'red') return 'bad';
		return 'pending';
	}
</script>

{#if view.sectionVisible}
	<footer class="decision-section" aria-label="Decision section">
		{#if view.timerSlotVisible}
			<div class="ds-timer-slot">
				{#if view.athleteTimerVisible}
					<div class="ds-timer ds-athlete-timer">
						<CountdownTimer
							{timerData}
							color={ATHLETE_TIMER_COLOR}
							warningColor={ATHLETE_TIMER_WARNING}
						/>
					</div>
				{:else if view.breakCountdownVisible}
					<div class="ds-timer ds-break-timer">
						<CountdownTimer
							timerData={breakTimerData}
							color={BREAK_TIMER_COLOR}
							warningColor={BREAK_TIMER_WARNING}
						/>
					</div>
				{:else if view.stopwatchVisible}
					<div class="ds-timer ds-stopwatch" aria-label="Review stopwatch">
						{view.stopwatchText}
					</div>
				{/if}
			</div>
		{/if}

		{#if view.athleteSlotVisible}
			<div class="ds-decision-athlete">
				{#if view.showStartNumber}
					<span class="ds-start-number">{view.startNumber}</span>
				{/if}
				<span class="ds-athlete-name">
					<span class="ds-athlete-full-name">{view.displayName}</span>
					{#if view.ageGroups}
						<span class="ds-athlete-age-groups">({view.ageGroups})</span>
					{/if}
				</span>
			</div>
		{/if}

		<div class="ds-decisions">
			{#if view.juryMessage}
				<div class="ds-jury-message">{view.juryMessage}</div>
			{/if}

			{#if view.showRefLights && view.refLights}
				<div class="ds-referee-slot" aria-label="Referee decisions">
					<div class="ds-decision-lights">
						{#if view.refLights.singleRef}
							<div class="ds-referee-light {getRefLightClass(view.refLights.refs[1])}"></div>
						{:else}
							<div class="ds-referee-light {getRefLightClass(view.refLights.refs[0])}"></div>
							<div class="ds-referee-light {getRefLightClass(view.refLights.refs[1])}"></div>
							<div class="ds-referee-light {getRefLightClass(view.refLights.refs[2])}"></div>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</footer>
{/if}

<style>
	/* Follows OWLCMS public/resultsDecisionSection.css flex-row layout */
	.decision-section {
		flex: 0 0 auto;
		display: flex;
		flex-direction: row;
		align-items: center;
		width: 100%;
		min-height: 3.1rem;
		padding: 0.45rem 1.5rem;
		background: #000;
		border-top: 0.125rem solid #333;
		color: #fff;
		gap: 1rem;
		box-sizing: border-box;
	}

	.ds-timer-slot {
		flex: 0 0 6.5rem;
		min-width: 6.5rem;
		display: flex;
		justify-content: center;
		align-items: center;
		font-weight: bold;
	}

	.ds-timer {
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: bold;
		--timer-font-size: 1.5rem;
	}

	.ds-timer :global(.timer-display) {
		font-family: 'Courier New', monospace;
		letter-spacing: 2px;
	}

	.ds-stopwatch {
		color: #fff;
		font-size: 1.5rem;
		font-family: 'Courier New', monospace;
		letter-spacing: 2px;
	}

	.ds-decision-athlete {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: 0.5rem;
		font-size: 1.35rem;
		font-weight: bold;
		color: #fff;
	}

	.ds-start-number {
		font-size: 0.85em;
		font-weight: bold;
		border: 2px solid #888;
		border-radius: 0.2rem;
		min-width: 2em;
		padding: 0.05em 0.3em;
		display: inline-flex;
		justify-content: center;
		align-items: center;
		flex: 0 0 auto;
	}

	.ds-athlete-name {
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
		overflow: hidden;
	}

	.ds-athlete-full-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.ds-athlete-age-groups {
		flex: 0 0 auto;
		white-space: nowrap;
		font-weight: 600;
		color: #cbd5f5;
		font-size: 0.9em;
	}

	.ds-decisions {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex: 0 0 auto;
		margin-inline-start: auto;
	}

	.ds-jury-message {
		flex: 0 1 auto;
		color: #fff;
		font-size: 1.3rem;
		font-weight: bold;
		white-space: nowrap;
	}

	.ds-referee-slot {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.ds-decision-lights {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	/* OWLCMS scoreboard proportions: rounded rectangles 1.25 times as wide as tall */
	.ds-referee-light {
		width: 2.5rem;
		height: 2rem;
		box-sizing: border-box;
		border-radius: 5%;
		background: rgba(255, 255, 255, 0.2);
		border: 2px dashed #ffffff;
	}

	.ds-referee-light.good {
		background: #ffffff;
		border-style: solid;
	}

	.ds-referee-light.bad {
		background: red;
		border-style: solid;
	}

	/* Responsive adjustments matching CurrentAttemptBar */
	@media (max-width: 1366px) and (orientation: landscape) {
		.ds-decision-athlete {
			font-size: 1.25rem;
		}
		.ds-jury-message {
			font-size: 1.2rem;
		}
		.ds-timer {
			--timer-font-size: 1.4rem;
		}
		.ds-stopwatch {
			font-size: 1.4rem;
		}
		.ds-referee-light {
			width: 2.25rem;
			height: 1.8rem;
		}
	}

	@media (max-width: 1280px) and (orientation: landscape) {
		.decision-section {
			padding: 0.4rem 1.2rem;
			min-height: 2.75rem;
			gap: 0.8rem;
		}
		.ds-decision-athlete {
			font-size: 1.15rem;
		}
		.ds-jury-message {
			font-size: 1.1rem;
		}
		.ds-timer {
			--timer-font-size: 1.3rem;
		}
		.ds-stopwatch {
			font-size: 1.3rem;
		}
		.ds-referee-light {
			width: 2rem;
			height: 1.6rem;
		}
	}

	@media (max-width: 960px) and (orientation: landscape) {
		.decision-section {
			padding: 0.3rem 0.8rem;
			min-height: 2.25rem;
			border-top-width: 1px;
			gap: 0.6rem;
		}
		.ds-timer-slot {
			flex: 0 0 4.5rem;
			min-width: 4.5rem;
		}
		.ds-decision-athlete {
			font-size: 1rem;
		}
		.ds-jury-message {
			font-size: 0.95rem;
		}
		.ds-timer {
			--timer-font-size: 1.1rem;
		}
		.ds-stopwatch {
			font-size: 1.1rem;
		}
		.ds-decision-lights {
			gap: 0.35rem;
		}
		.ds-referee-light {
			width: 1.75rem;
			height: 1.4rem;
		}
	}

	@media (max-width: 1024px) and (orientation: portrait) {
		.decision-section {
			padding: 0.4rem 0.8rem;
			flex-wrap: wrap;
			gap: 0.4rem 0.75rem;
		}
		.ds-timer-slot {
			flex: 0 0 auto;
			min-width: 4rem;
		}
		.ds-decision-athlete {
			font-size: 1.05rem;
		}
		.ds-decisions {
			flex-wrap: wrap;
			gap: 0.5rem;
		}
		.ds-jury-message {
			font-size: 1rem;
			white-space: normal;
		}
		.ds-referee-light {
			width: 1.85rem;
			height: 1.5rem;
		}
	}

	@media (max-width: 430px) and (orientation: portrait) {
		.decision-section {
			padding: 0.35rem 0.6rem;
			min-height: 2.2rem;
		}
		.ds-decision-athlete {
			font-size: 0.95rem;
		}
		.ds-jury-message {
			font-size: 0.9rem;
		}
		.ds-timer {
			--timer-font-size: 1rem;
		}
		.ds-stopwatch {
			font-size: 1rem;
		}
		.ds-decision-lights {
			gap: 0.25rem;
		}
		.ds-referee-light {
			width: 1.5rem;
			height: 1.2rem;
		}
	}
</style>
