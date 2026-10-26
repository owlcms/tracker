<script>
	// Current attempt information bar component - shared across all scoreboards
	// Displays: start number, athlete name, team, attempt label, weight, timer, and decision lights
	// Display mode is computed server-side and passed in via displayMode prop:
	//   'decision' - show referee decision lights
	//   'break' - show break timer
	//   'athlete' - show athlete countdown timer
	//   'none' - show neither timer nor decision
    
	import CountdownTimer from './CountdownTimer.svelte';

	export let currentAttempt = {};
	export let decisionState = {};
	export let timerData = null;      // Athlete timer data from parent
	export let breakTimerData = null; // Break timer data from parent
	export let displayMode = 'none';  // Server-computed: 'decision' | 'break' | 'athlete' | 'none'
	export let scoreboardName = 'Scoreboard';
	export let sessionStatus = {};
	export let competition = {};
	export let showDecisionLights = true;
	export let showTimer = true;
	export let compactMode = false;
	export let showLifterInfo = true;
	export let translations = {};
	export let breakTitle = null;     // Group name during breaks (e.g., "Group M1")
    
	// Timer colors (no state, just constants)
	const ATHLETE_TIMER_COLOR = '#4ade80';    // Green
	const ATHLETE_TIMER_WARNING = '#fbbf24';  // Yellow
	const BREAK_TIMER_COLOR = '#00d4d4';      // Turquoise
	const BREAK_TIMER_WARNING = '#00d4d4';    // Keep turquoise

	function getRefereeClass(value) {
		if (value === 'good') return 'good';
		if (value === 'bad') return 'bad';
		return 'pending';
	}
	
	// Computed visibility based on server-side displayMode
	$: showAthleteTimer = displayMode === 'athlete' && showTimer && competition?.showTimer;
	$: showBreakTimer = displayMode === 'break' && showTimer && competition?.showTimer;
	$: showDecisions = displayMode === 'decision' && showDecisionLights;
	
	// During breaks, show breakTitle instead of sessionInfo
	$: isBreak = currentAttempt?.isBreak || false;
	$: displaySessionInfo = isBreak && breakTitle ? breakTitle : (competition?.sessionInfo || 'Session');
</script>

{#if compactMode}
	<!-- Compact mode for team scoreboard -->
	<header class="header compact" data-scoreboard={scoreboardName}>
		{#if !sessionStatus?.isDone}
			{#if showLifterInfo}
				<div class="lifter-info">
					<div class="name-and-team">
						<span class="lifter-name">{currentAttempt?.fullName || translations?.noAthleteLifting || 'No athlete currently lifting'}</span>
						{#if currentAttempt?.teamName}
							<span class="team">{currentAttempt.teamName}</span>
						{/if}
						{#if !sessionStatus?.isDone}
							<span class="portrait-session-info">{@html displaySessionInfo}</span>
						{/if}
					</div>
					<span class="attempt-label">{@html currentAttempt?.attempt || ''}</span>
					{#if competition?.showWeight && currentAttempt?.weight}
						<span class="weight">{currentAttempt.weight} kg</span>
					{/if}

					{#if (showTimer && competition?.showTimer) || showDecisionLights}
						<div class="timer-decision-container compact-container">
							<!-- Athlete timer shown when displayMode is 'athlete' -->
							{#if showAthleteTimer}
								<div class="timer-slot">
									<CountdownTimer 
										{timerData}
										color={ATHLETE_TIMER_COLOR} 
										warningColor={ATHLETE_TIMER_WARNING}
									/>
								</div>
							{/if}
							<!-- Break timer shown when displayMode is 'break' -->
							{#if showBreakTimer}
								<div class="break-slot">
									<CountdownTimer 
										timerData={breakTimerData} 
										color={BREAK_TIMER_COLOR} 
										warningColor={BREAK_TIMER_WARNING}
									/>
								</div>
							{/if}
						<!-- Decision display: down signal (▼) or referee lights -->
						{#if showDecisions}
							<div class="decision-slot">
								{#if decisionState?.down && !decisionState?.ref1 && !decisionState?.ref2 && !decisionState?.ref3}
									<!-- Down signal: green triangle -->
									<div class="down-signal" aria-label="Down signal">▼</div>
								{:else}
									<!-- Referee decision lights -->
									<div class="decision-lights" aria-label="Referee decisions">
										{#if !decisionState?.isSingleReferee}
											<div class="referee-light {getRefereeClass(decisionState?.ref1)}"></div>
										{/if}
										<div class="referee-light {getRefereeClass(decisionState?.ref2)}"></div>
										{#if !decisionState?.isSingleReferee}
											<div class="referee-light {getRefereeClass(decisionState?.ref3)}"></div>
										{/if}
									</div>
								{/if}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		{/if}
		<div class="session-info">
			{@html competition?.sessionInfo || 'Session'}
		</div>
	</header>
{:else}
	<!-- Full mode for grid scoreboards (session-results, lifting-order, rankings) -->
	<header class="header" data-scoreboard={scoreboardName}>
		{#if showLifterInfo}
			<div class="lifter-info">
				{#if sessionStatus?.isDone}
					<span class="lifter-name">{sessionStatus.statusMessage || 'Session Done.'}</span>
				{:else}
					<div class="name-and-team">
						<span class="lifter-name">{currentAttempt?.fullName || translations?.noAthleteLifting || 'No athlete currently lifting'}</span>
						{#if currentAttempt?.teamName}
							<span class="team">{currentAttempt.teamName}</span>
						{/if}
						{#if !sessionStatus?.isDone}
							<span class="portrait-session-info">{@html displaySessionInfo}</span>
						{/if}
					</div>
					<span class="attempt-label">{@html currentAttempt?.attempt || ''}</span>
					{#if competition?.showWeight && currentAttempt?.weight}
						<span class="weight">{currentAttempt.weight} kg</span>
					{/if}
					{#if (showTimer && competition?.showTimer) || showDecisionLights}
						<div class="timer-decision-container">
							<!-- Athlete timer shown when displayMode is 'athlete' -->
							{#if showAthleteTimer}
								<div class="timer-slot">
									<CountdownTimer 
										{timerData}
										color={ATHLETE_TIMER_COLOR} 
										warningColor={ATHLETE_TIMER_WARNING}
									/>
								</div>
							{/if}
							<!-- Break timer shown when displayMode is 'break' -->
							{#if showBreakTimer}
								<div class="break-slot">
									<CountdownTimer 
										timerData={breakTimerData} 
										color={BREAK_TIMER_COLOR} 
										warningColor={BREAK_TIMER_WARNING}
									/>
								</div>
							{/if}
							<!-- Decision display: down signal (▼) or referee lights -->
							{#if showDecisions}
								<div class="decision-slot">
									{#if decisionState?.down && !decisionState?.ref1 && !decisionState?.ref2 && !decisionState?.ref3}
										<!-- Down signal: green triangle -->
										<div class="down-signal" aria-label="Down signal">▼</div>
									{:else}
										<!-- Referee decision lights -->
										<div class="decision-lights" aria-label="Referee decisions">
											{#if !decisionState?.isSingleReferee}
												<div class="referee-light {getRefereeClass(decisionState?.ref1)}"></div>
											{/if}
											<div class="referee-light {getRefereeClass(decisionState?.ref2)}"></div>
											{#if !decisionState?.isSingleReferee}
												<div class="referee-light {getRefereeClass(decisionState?.ref3)}"></div>
											{/if}
										</div>
									{/if}
								</div>
							{/if}
						</div>
					{/if}
				{/if}
			</div>
		{/if}
		<div class="session-info">
			{#if sessionStatus?.isDone}
				{@html '&nbsp;'}
			{:else}
				{@html displaySessionInfo}
			{/if}
		</div>
	</header>
{/if}

<style>
	/* Header - Current Lifter */
	.header {
		background: #000;
		padding: 0.75rem 1.5rem;
		border-bottom: 0.125rem solid #333;
	}

	.header.compact {
		padding: 0.5rem 1.5rem;
	}

	.lifter-info {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 0;
	}

	.name-and-team {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		flex: 1;
		min-width: 0;
	}

	.lifter-name {
		font-size: 1.5rem;
		font-weight: bold;
		color: #fff;
		flex-shrink: 1;
		min-width: 0;
	}

	.team {
		font-size: 1.2rem;
		font-weight: 600;
		color: #cbd5f5;
		flex-shrink: 0;
		white-space: nowrap;
	}

	.attempt-label {
		font-size: 1.5rem; /* Same as lifter name */
		font-weight: bold;
		color: #aaa;
	}

	.weight {
		font-size: 1.5rem;
		font-weight: bold;
		color: #4ade80;
	}

	.timer {
		background: #1a1a1a;
		color: #fbbf24;
		font-weight: bold;
		font-size: 1.5rem;
		font-family: 'Courier New', monospace;
		letter-spacing: 2px;
		padding: 0.35rem 0.75rem;
		border-radius: 0.25rem;
		width: 9rem;
		text-align: center;
	}

	.timer.running {
		color: #4ade80;
	}

	.timer.warning {
		color: #fbbf24;
		background: rgba(239, 68, 68, 0.2);
	}

	.timer-decision-container {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		min-width: 9rem;
		height: 2.5rem;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.timer-slot,
	.break-slot,
	.decision-slot {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		width: 100%;
		border-radius: 0.25rem;
		padding: 0.35rem 0.75rem;
	}

	.timer-slot,
	.break-slot {
		background: transparent;
		font-weight: bold;
		--timer-font-size: 1.5rem;
	}

	/* Override CountdownTimer component styles */
	.timer-slot :global(.timer-display),
	.break-slot :global(.timer-display) {
		font-family: 'Courier New', monospace;
		letter-spacing: 2px;
	}

	.decision-slot {
		background: transparent;
	}

	.down-signal {
		font-size: 2.5rem;
		color: #4ade80;
		font-weight: bold;
		line-height: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 0.5rem;
	}

	.decision-lights {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	/* OWLCMS scoreboard proportions: rounded rectangles 1.25 times as wide as tall */
	.referee-light {
		width: 2.75rem;
		height: 2.2rem;
		box-sizing: border-box;
		border-radius: 5%;
		background: rgba(255, 255, 255, 0.2);
		border: 2px dashed #ffffff;
	}

	.referee-light.good {
		background: #ffffff;
		border-style: solid;
	}

	.referee-light.bad {
		background: red;
		border-style: solid;
	}

	.session-info {
		font-size: 1.2rem;
		color: #ccc;
		font-weight: bold;
		padding: 0;
	}

	.portrait-session-info {
		display: none;
		color: #ccc;
		font-weight: bold;
		font-size: 1rem;
		line-height: 1.1;
	}

	/* Responsive adjustments for landscape mode */
	/* iPad landscape and 1366x768: Slight reduction */
	@media (max-width: 1366px) and (orientation: landscape) {
		.lifter-name {
			font-size: 1.4rem;
		}

		.team {
			font-size: 1.15rem;
		}

		.attempt-label,
		.weight {
			font-size: 1.4rem;
		}

		.timer-slot,
		.break-slot {
			--timer-font-size: 1.4rem;
		}

		.referee-light {
			width: 2.5rem;
			height: 2rem;
		}

		.down-signal {
			font-size: 2.3rem;
		}
	}

	/* 720p (1280x720) and iPad Mini landscape: More compact */
	@media (max-width: 1280px) and (orientation: landscape) {
		.header {
			padding: 0.6rem 1.2rem;
		}

		.header.compact {
			padding: 0.4rem 1.2rem;
		}

		.lifter-info {
			gap: 0.8rem;
		}

		.lifter-name {
			font-size: 1.3rem;
		}

		.team {
			font-size: 1.1rem;
		}

		.attempt-label,
		.weight {
			font-size: 1.3rem;
		}

		.timer-slot,
		.break-slot {
			--timer-font-size: 1.3rem;
			padding: 0.3rem 0.6rem;
		}

		.decision-slot {
			padding: 0.3rem 0.6rem;
		}

		.referee-light {
			width: 2.25rem;
			height: 1.8rem;
		}

		.down-signal {
			font-size: 2.1rem;
		}

		.session-info {
			font-size: 1.1rem;
		}
	}

	/* iPhone XR+ landscape (896x414) and smaller tablets: Very compact */
	@media (max-width: 960px) and (orientation: landscape) {
		.header {
			padding: 0.4rem 0.8rem;
			border-bottom-width: 1px;
		}

		.header.compact {
			padding: 0.3rem 0.8rem;
		}

		.lifter-info {
			gap: 0.6rem;
			margin-bottom: 0.15rem;
		}

		.name-and-team {
			gap: 0.6rem;
		}

		.lifter-name {
			font-size: 1.1rem;
		}

		.team {
			font-size: 0.95rem;
		}

		.attempt-label,
		.weight {
			font-size: 1.1rem;
		}

		.timer-decision-container {
			min-width: 7rem;
			height: 2rem;
		}

		.timer-slot,
		.break-slot {
			--timer-font-size: 1.1rem;
			padding: 0.25rem 0.5rem;
		}

		.decision-slot {
			padding: 0.25rem 0.4rem;
		}

		.referee-light {
			width: 1.875rem;
			height: 1.5rem;
		}

		.decision-lights {
			gap: 0.35rem;
		}

		.down-signal {
			font-size: 1.8rem;
		}

		.session-info {
			display: none;
		}
	}

	/* ===== PORTRAIT MODE ===== */

	/* iPad portrait (768x1024): Stack layout vertically */
	@media (max-width: 1024px) and (orientation: portrait) {
		.header {
			padding: 0.5rem 1rem;
			flex-wrap: wrap;
		}

		.header.compact {
			padding: 0.4rem 1rem;
		}

		.lifter-info {
			gap: 0.8rem;
			flex: 1 1 100%;
			flex-wrap: wrap;
			align-items: flex-start;
			justify-content: flex-start;
			margin-bottom: 0.3rem;
		}

		.name-and-team {
			flex: 0 0 100%;
			width: 100%;
			flex-direction: column;
			align-items: stretch;
			gap: 0.15rem;
		}

		.lifter-name {
			font-size: 1.2rem;
			display: block;
			width: 100%;
		}

		.team {
			font-size: 1rem;
			display: block;
			width: 100%;
		}

		.portrait-session-info {
			display: block;
			font-size: 1rem;
			width: 100%;
		}

		.timer-decision-container {
			margin-left: auto;
		}

		.attempt-label,
		.weight {
			font-size: 1.2rem;
		}

		.timer-slot,
		.break-slot {
			--timer-font-size: 1.2rem;
			padding: 0.3rem 0.6rem;
		}

		.referee-light {
			width: 2.0rem;
			height: 1.6rem;
		}

		.session-info {
			font-size: 1rem;
		}
	}

	/* Large phones portrait (430px - iPhone Plus/Pro Max) */
	@media (max-width: 430px) and (orientation: portrait) {
		.header {
			padding: 0.4rem 0.6rem;
			flex-wrap: wrap;
		}

		.header.compact {
			padding: 0.3rem 0.6rem;
		}

		.lifter-info {
			gap: 0.5rem;
			flex: 1 1 100%;
			justify-content: flex-start;
			margin-bottom: 0.25rem;
		}

		.name-and-team {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.1rem;
		}

		.lifter-name {
			font-size: 1rem;
		}

		.team {
			font-size: 0.85rem;
		}

		.portrait-session-info {
			font-size: 0.85rem;
		}

		.attempt-label,
		.weight {
			font-size: 1rem;
		}

		.timer-decision-container {
			min-width: 5rem;
			height: 1.8rem;
		}

		.timer-slot,
		.break-slot {
			--timer-font-size: 1rem;
			padding: 0.2rem 0.4rem;
		}

		.referee-light {
			width: 1.625rem;
			height: 1.3rem;
		}

		.decision-lights {
			gap: 0.25rem;
		}

		.down-signal {
			font-size: 1.5rem;
		}

		.session-info {
			font-size: 0.85rem;
		}
	}

	/* Standard phones portrait (390px - iPhone 15/16) */
	@media (max-width: 390px) and (orientation: portrait) {
		.header {
			padding: 0.3rem 0.4rem;
		}

		.header.compact {
			padding: 0.25rem 0.4rem;
		}

		.lifter-info {
			gap: 0.4rem;
		}

		.lifter-name {
			font-size: 0.9rem;
		}

		.team {
			font-size: 0.75rem;
		}

		.portrait-session-info {
			font-size: 0.75rem;
		}

		.attempt-label,
		.weight {
			font-size: 0.9rem;
		}

		.timer-decision-container {
			min-width: 4rem;
			height: 1.6rem;
		}

		.timer-slot,
		.break-slot {
			--timer-font-size: 0.9rem;
			padding: 0.15rem 0.3rem;
		}

		.referee-light {
			width: 1.375rem;
			height: 1.1rem;
		}

		.down-signal {
			font-size: 1.3rem;
		}

		.session-info {
			font-size: 0.75rem;
		}
	}

	/* Portrait mode: Hide session info */
	@media (orientation: portrait) {
		.session-info {
			display: none;
		}
	}
</style>
