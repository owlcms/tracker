<script>
	/**
	 * Attempt Board - Full screen layout
	 * Matches OWLCMS Attempt Board design and mode handling
	 * 
	 * Modes (from OWLCMS):
	 * - WAIT: No session, show competition name + waiting message
	 * - INTRO_COUNTDOWN: Break before introduction, show break timer
	 * - LIFT_COUNTDOWN: Break before lift type, show break timer
	 * - LIFT_COUNTDOWN_CEREMONY: Break before lift with ceremony
	 * - CURRENT_ATHLETE: Normal lifting, show athlete info + athlete timer
	 * - INTERRUPTION: Technical break, show STOP
	 * - SESSION_DONE: Session complete
	 * - CEREMONY: Medal/introduction ceremony
	 */
	import CountdownTimer from '$lib/components/CountdownTimer.svelte';
	import PlatesElement from '$lib/components/PlatesElement.svelte';
	import { onDestroy } from 'svelte';
	import { adjudicationKey, buildDecisionView, isCardVisible, latchAdjudicationCard } from './decision-display.js';
	
	export let data = {};
	
	// Timer colors (match owlcms colors.css exactly)
	const ATHLETE_TIMER_COLOR = 'yellow';      // --athleteTimerColor
	const ATHLETE_TIMER_WARNING = 'yellow';    // Same as main timer
	const BREAK_TIMER_COLOR = 'skyblue';       // --breakTimerColor
	
	// Reactive data
	$: currentAttempt = data.currentAttempt;
	$: plates = data.plates || [];
	$: decision = data.decision || {};
	$: options = data.options || {};
	
	// Board mode from OWLCMS
	$: mode = data.mode || 'WAIT';
	$: breakType = data.breakType;
	
	// Mode-based display logic (mirrors OWLCMS AttemptBoard.js)
	$: isBreak = data.isBreak || false;
	$: isCountdown = data.isCountdown || false;
	$: isWaitMode = mode === 'WAIT';
	$: isCurrentAthlete = mode === 'CURRENT_ATHLETE';
	// OWLCMS 69 sends decisionState (cells computed by OWLCMS); older versions only send the legacy referee fields
	$: decisionState = decision?.decisionState || null;
	$: decisionVisible = decisionState
		? (isCurrentAthlete && decisionState.visible === true)
		: (decision?.visible && isCurrentAthlete);
	
	// Break content (computed by tracker using its own translations)
	$: breakTitle = data.breakTitle || '';
	$: breakMessage = data.breakMessage || '';
	
	// What to show in name areas
	$: displayLastName = isBreak ? breakTitle : (currentAttempt?.lastName || '');
	$: displayFirstName = isBreak ? breakMessage : (currentAttempt?.firstName || '');
	
	// Element visibility based on mode (matching OWLCMS)
	// the decision area does not use the team row: the team stays during decisions, as on the OWLCMS attempt board
	$: showTeamName = !isBreak;
	$: showTeamFlag = !isBreak && isCurrentAthlete;
	// the picture ends above the two bottom rows used by the decision area: it stays during decisions
	$: showAthletePicture = isCurrentAthlete;
	$: showStartNumber = !isBreak;
	$: showAttempt = !isBreak && !decisionVisible;
	$: showWeight = mode === 'LIFT_COUNTDOWN' || isCurrentAthlete || (mode === 'INTERRUPTION' && breakType === 'TECHNICAL');
	$: showBarbell = (mode === 'LIFT_COUNTDOWN' || (isCurrentAthlete && !decisionVisible) || (mode === 'INTERRUPTION' && breakType === 'TECHNICAL'));
	$: showAthleteTimer = isCurrentAthlete && !decisionVisible;
	$: showBreakTimer = isCountdown && data.breakTimer?.visible === true;
	$: decisionView = buildDecisionView(decision, {
		isCurrentAthlete,
		isBreak,
		breakType,
		showDecisions: options.showDecisions,
		showJuryVotes: options.showJuryVotes
	});
	$: showDecisionArea = decisionView.shown;
	$: showDownSignal = decisionView.down;
	$: singleRef = decisionView.singleRef;
	$: refCells = decisionView.refs;
	$: juryCells = decisionView.jury;
	$: showJuryRow = decisionView.showJuryRow;
	
	// Jury Good Lift / No Lift card: kept after later messages (RESET, updates) clear adjudicationDecision
	let cardLatch = null;
	let cardNow = Date.now();
	let cardTimer = null;
	$: updateCard(decision, data);
	$: cardVisible = isCardVisible(cardLatch, cardNow);
	$: card = cardVisible ? cardLatch.card : null;
	
	function updateCard(currentDecision, currentData) {
		const adjudication = currentDecision?.adjudicationDecision || currentData?.fopUpdate?.adjudicationDecision || null;
		if (!adjudication) return;
		const receivedAt = currentDecision?.adjudicationDecisionReceivedAt || currentData?.fopUpdate?.adjudicationDecisionReceivedAt || null;
		const key = adjudicationKey(adjudication, receivedAt);
		const now = Date.now();
		const latched = latchAdjudicationCard(cardLatch, {
			adjudication,
			receivedAt,
			// a live decision message is new; a fetched one carries the age measured by the server
			ageMs: currentData?.adjudicationKey === key ? currentData.adjudicationAgeMs : 0,
			labels: currentData?.juryLabels,
			athleteName: currentDecision?.athleteFull || currentData?.fopUpdate?.athleteFull || '',
			durationMs: (Number(currentData?.options?.juryCardSeconds ?? 5)) * 1000,
			now
		});
		if (latched === cardLatch) return;
		cardLatch = latched;
		cardNow = now;
		clearTimeout(cardTimer);
		if (latched?.card) {
			cardTimer = setTimeout(() => { cardNow = Date.now(); }, Math.max(0, latched.expiresAt - now) + 50);
		}
	}
	
	onDestroy(() => clearTimeout(cardTimer));
	
	// Long name handling (matches owlcms AbstractAttemptBoard.java)
	$: isLongLastName = (displayLastName?.length || 0) > 18;
	$: lastNameStyle = isLongLastName 
		? 'font-size: 8vh; line-height: 8vh; text-wrap: balance; overflow: hidden;' 
		: '';
	$: firstNameStyle = isLongLastName 
		? 'font-size: 8vh; line-height: 12vh; text-wrap: wrap; overflow: hidden;' 
		: '';
	
	// Flag display (only when not in break)
	$: hasFlag = !isBreak && !!currentAttempt?.flagUrl;
	
	// Picture display (only when not in break)
	$: hasPicture = !isBreak && !!currentAttempt?.pictureUrl;
	
	// Decision cell class: empty (none), voted, white or red (legacy values are mapped to the same vocabulary)
	function getRefClass(value) {
		if (value === 'white' || value === 'red' || value === 'voted') return value;
		return 'none';
	}
</script>

<svelte:head>
	<title>{data.scoreboardName || 'Attempt Board'} - {data.competition?.name || 'OWLCMS'}</title>
</svelte:head>

<div class="wrapper">
	{#if isWaitMode}
		<!-- WAIT mode: Show competition name and waiting message -->
		<div class="waiting-message">
			<div class="big-title">
				<div class="competition-name">{data.competition?.name || ''}</div>
				<div class="next-group">{data.message || ''}</div>
			</div>
		</div>
	{:else}
		<!-- Active mode: Show attempt board (athlete or break) -->
		<div class="attempt-board">
			<!-- Last Name (or break title during breaks) -->
			<div class="last-name" class:with-picture={hasPicture} style={lastNameStyle}>{displayLastName}</div>
			
			<!-- First Name (or break message during breaks) -->
			<div class="first-name" class:with-flag={hasFlag} class:with-picture={hasPicture} style={firstNameStyle}>{displayFirstName}</div>
			
			<!-- Team Flag (hidden during breaks) -->
			{#if hasFlag && showTeamFlag}
				<div class="flag" class:with-picture={hasPicture}>
					<img src={currentAttempt.flagUrl} alt="" />
				</div>
			{/if}
			
			<!-- Athlete Picture (hidden during breaks and decisions) -->
			{#if hasPicture && showAthletePicture}
				<div class="picture">
					<img src={currentAttempt.pictureUrl} alt="" />
				</div>
			{/if}
			
			<!-- Team Name (hidden during breaks) -->
			{#if showTeamName}
				<div class="team-name">{currentAttempt?.teamName || ''}</div>
			{/if}
			
			<!-- Start Number (hidden during breaks) -->
			{#if showStartNumber}
				<div class="start-number">
					<span>{currentAttempt?.startNumber || ''}</span>
				</div>
			{/if}
			
			<!-- Category (hidden during breaks) -->
			{#if showAttempt}
				<div class="category">{currentAttempt?.categoryName || ''}</div>
			{/if}
			
			<!-- Weight (visible during lift countdowns, current athlete, and technical breaks) -->
			{#if showWeight}
				<div class="weight">
					<span class="weight-value">{currentAttempt?.weight || ''}</span>
					<span class="weight-unit">kg</span>
				</div>
			{/if}
			
			<!-- Barbell / Decision Area -->
			{#if showDecisionArea}
				<div class="decision-area">
					<div class="decisionWrapper" class:withJury={showJuryRow}>
						{#if showDownSignal}
							<div class="down">
								<svg class="down-icon" viewBox="0 0 16 16" aria-hidden="true">
									<path fill="currentColor" fill-rule="evenodd" d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zM6.6 4h2.8v4.2H12L8 12.4 4 8.2h2.6z" />
								</svg>
							</div>
						{:else}
							<div class="decisions">
								{#if singleRef}
									<span class="invisible">&nbsp;</span>
									<span class="soloDecision {getRefClass(refCells[1])}">{refCells[1] === 'white' ? '✓' : refCells[1] === 'red' ? '✕' : ''}</span>
									<span class="invisible">&nbsp;</span>
								{:else}
									<span class="decision {getRefClass(refCells[0])}">&nbsp;</span>
									<span class="decision {getRefClass(refCells[1])}">&nbsp;</span>
									<span class="decision {getRefClass(refCells[2])}">&nbsp;</span>
								{/if}
							</div>
							{#if showJuryRow}
								<div class="juryDecisions">
									{#each juryCells as cell}
										<span class="juryLightSlot">
											<svg class="juryLight {cell === 'white' || cell === 'red' || cell === 'voted' ? cell : 'empty'}" viewBox="0 0 16 16" aria-hidden="true">
												{#if cell === 'white'}
													<path fill="currentColor" fill-rule="evenodd" d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zM4.2 8.3l1.2-1.2 1.9 1.9 3.9-3.9 1.2 1.2-5.1 5.1z" />
												{:else if cell === 'red'}
													<path fill="currentColor" fill-rule="evenodd" d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zM5 6.2 6.2 5 8 6.8 9.8 5 11 6.2 9.2 8 11 9.8 9.8 11 8 9.2 6.2 11 5 9.8 6.8 8z" />
												{:else if cell === 'voted'}
													<circle cx="8" cy="8" r="8" fill="currentColor" />
												{:else}
													<circle cx="8" cy="8" r="7.5" fill="none" stroke="currentColor" stroke-width="1" />
												{/if}
											</svg>
										</span>
									{/each}
								</div>
							{/if}
						{/if}
					</div>
				</div>
			{:else if showBarbell && options.showPlates && data.platform}
				<div class="barbell">
					<PlatesElement 
						weight={currentAttempt?.weight || 0}
						barWeight={currentAttempt?.barWeight || 20}
						platform={data.platformPlates}
					/>
				</div>
			{:else if !isBreak}
				<div class="barbell-placeholder"></div>
			{/if}
			
			<!-- Attempt Label (hidden during breaks and decisions) -->
			{#if showAttempt}
				<div class="attempt">{@html currentAttempt?.attempt || ''}</div>
			{/if}
			
			<!-- Timer -->
			{#if options.showTimer}
				<div class="timer-area">
					{#if showBreakTimer}
						<div class="timer break-time">
							<CountdownTimer 
								timerData={data.breakTimer}
								color={BREAK_TIMER_COLOR}
								warningColor={BREAK_TIMER_COLOR}
							/>
						</div>
					{:else if showAthleteTimer}
						<div class="timer athlete-timer">
							<CountdownTimer 
								timerData={data.timer}
								color={ATHLETE_TIMER_COLOR}
								warningColor={ATHLETE_TIMER_WARNING}
							/>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
	
	{#if card}
		<div class="jury-card-backdrop">
			<div class="jury-card" class:success={card.success} class:fail={!card.success}>
				<div class="jury-card-meta">
					{#if card.status}<div class="jury-card-status">{card.status}</div>{/if}
				</div>
				<div class="jury-card-decision">{card.success ? '✓' : '✕'} {card.decision}</div>
				<div class="jury-card-athlete">{card.athlete}</div>
				<div class="jury-card-attempt">{card.attempt}</div>
				{#if card.rule}<div class="jury-card-rule">{card.rule}</div>{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		background: #000;
		color: #fff;
		font-family: Arial, sans-serif;
		overflow: hidden;
	}
	
	.wrapper {
		box-sizing: border-box;
		font: Arial;
		color: #fff;
		background-color: #000;
		height: 100svh;
		width: 100vw;
		overflow: hidden;
	}
	
	.attempt-board {
		box-sizing: border-box;
		font-family: Arial, Helvetica, sans-serif;
		display: grid;
		width: 100vw;
		height: 100vh;
		padding: 3vmin;
		
		grid-template-columns: 
			[name-start number-start weight-start] 1fr 
			[number-end] 2fr 
			[weight-end barbell-start] 4fr 
			[barbell-end timer-start attempt-start] 2fr 
			[timer-end name-end attempt-end];
		
		grid-template-rows:
			[lastname-start] 15vh
			[lastname-end firstname-start] 15vh
			[firstname-end teamname-start] 10vh
			[teamname-end] 8vh
			[number-start attempt-start barbell-start] 20vh
			[number-end attempt-end weight-start timer-start] 25vh
			[weight-end barbell-end timer-end];
		
		align-items: stretch;
		justify-items: stretch;
		overflow: hidden;
	}
	
	/* === Name Display === */
	.last-name {
		grid-area: lastname-start / name-start / lastname-end / name-end;
		font-size: 12vh;
		line-height: 12vh;
		color: #ffffff;
		align-self: end;
		justify-self: start;
	}
	
	.first-name {
		grid-area: firstname-start / name-start / firstname-end / timer-start;
		font-size: 10vh;
		line-height: 12vh;
		color: #ffffff;
		justify-self: start;
		white-space: normal;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 76vw;
		max-height: 12vh;
		display: block;
	}
	
	/* When flag is present, reduce first-name width */
	.first-name.with-flag {
		max-width: 55vw;
	}
	
	/* When picture is present, reduce name sizes */
	.last-name.with-picture {
		font-size: 9vh;
		line-height: 10vh;
	}
	
	.first-name.with-picture {
		font-size: 9vh;
		line-height: 10vh;
		max-height: 10vh;
		max-width: 70vw;
	}
	
	/* Team Flag */
	.flag {
		grid-area: firstname-start / timer-start / teamname-end / timer-end;
		display: grid;
		place-items: center;
		border: none;
		width: fit-content;
		height: fit-content;
		justify-self: center;
		align-self: center;
	}
	
	/* Flag with picture present - smaller and positioned differently */
	.flag.with-picture {
		grid-area: teamname-start / barbell-start / barbell-start / barbell-end;
		justify-self: center;
		align-self: start;
	}
	
	.flag img {
		object-fit: contain;
		max-height: 25vh;
		width: 100%;
	}
	
	.flag.with-picture img {
		max-height: 18vh;
		align-self: start;
	}
	
	/* Athlete Picture */
	.picture {
		display: flex;
		justify-self: center;
		justify-content: center;
		align-self: center;
		grid-area: lastname-start / timer-start / number-start / timer-end;
		z-index: 0;
		flex-direction: column;
	}
	
	.picture img {
		max-height: 45vh;
		max-width: 100%;
		align-self: center;
		object-fit: contain;
	}
	
	.team-name {
		grid-area: teamname-start / name-start / teamname-end / name-end;
		font-size: 8vh;
		line-height: 8vh;
		color: #d0d0d0;
		align-self: center;
		justify-self: start;
	}
	
	/* === Start Number === */
	.start-number {
		font-size: 10vh;
		grid-area: number-start / number-start / number-end / number-end;
		align-self: center;
		justify-self: start;
	}
	
	.start-number span {
		border-width: 0.2ex;  /* matches owlcms */
		border-style: solid;
		border-color: red;  /* --startNumberBoxColor */
		width: 1.5em;
		padding: 0.05em 0;
		line-height: 1.1;
		display: flex;
		justify-content: center;
		color: #fff;
	}
	
	/* === Category === */
	.category {
		margin-left: 1.5rem;
		justify-self: start;
		align-self: center;
		font-size: 8.5vh;
		grid-area: number-start / number-end / number-end / barbell-start;
		color: #fff;
		white-space: nowrap;  /* prevent wrapping */
	}
	
	/* === Weight === */
	.weight {
		color: aqua;  /* --athleteAttemptWeightColor */
		font-size: 20vh;
		line-height: 20vh;
		font-weight: bold;
		grid-area: weight-start / weight-start / weight-end / weight-end;
		align-self: center;
		justify-self: stretch;
		white-space: nowrap;  /* keep weight and kg on same line */
	}
	
	.weight-unit {
		font-size: 75%;  /* matches owlcms: style="font-size: 75%" */
	}
	
	/* === Barbell / Plates === */
	.barbell {
		grid-area: barbell-start / barbell-start / barbell-end / barbell-end;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 2px;
	}
	
	.barbell-placeholder {
		grid-area: barbell-start / barbell-start / barbell-end / barbell-end;
	}
	
	/* === Decision Area ===
	   Geometry copied from OWLCMS decision-lights.css (DecisionElement.js); the area keeps its size on the board. */
	.decision-area {
		grid-area: barbell-start / barbell-start / timer-end / timer-end;
		display: flex;
		min-height: 0;
		min-width: 0;
		--decision-border-color: white;
	}
	
	.decisionWrapper {
		display: grid;
		width: 100%;
		height: 100%;
		text-align: center;
	}
	
	.decisions {
		height: 100%;
		width: 100%;
		display: flex;
		align-items: stretch;
		justify-content: space-between;
	}
	
	.decision {
		border-radius: 5%;
		border: 2px solid var(--decision-border-color);
		margin: 3%;
		width: 30%;
	}
	
	.soloDecision {
		border-radius: 50%;
		border: 2px solid var(--decision-border-color);
		margin: 0;
		padding: 0;
		width: 36vh;
		height: 36vh;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: calc(36vh * 0.6);
		font-weight: bold;
		line-height: 1;
		color: black;
		align-self: center;
	}
	
	.decision.red,
	.soloDecision.red {
		background-color: red;
	}
	
	.decision.white,
	.soloDecision.white {
		background-color: white;
	}
	
	.decision.none,
	.soloDecision.none {
		background-color: rgba(255, 255, 255, 0.2);
		border: 2px dashed var(--decision-border-color);
	}
	
	/* review vote or jury vote cast, hidden until all are in */
	.decision.voted {
		background-color: gray;
	}
	
	.invisible {
		visibility: hidden;
	}
	
	.down {
		display: flex;
		align-items: center;
		justify-content: space-evenly;
		color: lime;
	}
	
	.down-icon {
		width: 30vh;
		height: 30vh;
	}
	
	/* referee decisions shown together with the jury: two rows of equal height, the three referee rectangles fill
	   the width, the jury circles are as tall as the rectangles and spread evenly across the same width. */
	.decisionWrapper.withJury {
		grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
		row-gap: 4%;
		min-width: 0;
		min-height: 0;
	}
	
	.withJury > .decisions {
		grid-row: 1;
		grid-column: 1;
		min-height: 0;
		justify-content: space-between;
		align-items: center;
		box-sizing: border-box;
		padding-bottom: 1.5%;
	}
	
	.withJury .decision {
		flex: 0 0 28%;
		box-sizing: border-box;
		width: 28%;
		height: 90%;
		margin: 0;
	}
	
	.withJury .soloDecision {
		max-width: 100%;
		max-height: 100%;
		aspect-ratio: 1;
		width: auto;
		height: 100%;
		align-self: center;
	}
	
	.juryDecisions {
		grid-row: 2;
		display: flex;
		align-items: stretch;
		justify-content: space-between;
		box-sizing: border-box;
		padding-top: 1.5%;
		width: 100%;
		height: 100%;
		min-height: 0;
	}
	
	.juryLightSlot {
		flex: 0 0 auto;
		height: 100%;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	
	.juryLight {
		width: auto;
		height: 100%;
		aspect-ratio: 1;
		box-sizing: border-box;
		border: 1px solid var(--decision-border-color);
		border-radius: 50%;
		color: gray;
		background: none;
	}
	
	.juryLight.empty {
		border-color: transparent;
	}
	
	.juryLight.white {
		color: white;
	}
	
	.juryLight.red {
		color: red;
	}
	
	/* === Jury Good Lift / No Lift card (matches OWLCMS jury-notification-card) === */
	.jury-card-backdrop {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10;
	}
	
	.jury-card {
		display: grid;
		gap: 2vh;
		min-width: 60vw;
		max-width: 84vw;
		box-sizing: border-box;
		padding: 4vh 4vw;
		border-radius: 3vh;
		border: 0.8vh solid;
		text-align: center;
		box-shadow: 0 3vh 6vh rgba(0, 0, 0, 0.6);
	}
	
	.jury-card.success {
		border-color: #0b5f19;
		background: #ffffff;
		color: #0b5f19;
	}
	
	.jury-card.fail {
		border-color: #ffffff;
		background: #9a0000;
		color: #ffffff;
	}
	
	.jury-card-meta {
		display: flex;
		justify-content: center;
		align-items: center;
		flex-wrap: wrap;
		gap: 1.5vh;
	}
	
	.jury-card-status {
		font-size: 5vh;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	
	.jury-card-decision {
		font-size: 11vh;
		line-height: 1;
		font-weight: 800;
		text-transform: uppercase;
	}
	
	.jury-card-athlete {
		font-size: 7vh;
		line-height: 1.1;
		font-weight: 700;
	}
	
	.jury-card-attempt {
		font-size: 5vh;
		opacity: 0.92;
	}
	
	.jury-card-rule {
		font-size: 5vh;
		font-weight: 700;
	}
	
	/* === Attempt Label === */
	.attempt {
		font-size: 8.5vh;
		font-weight: bold;
		color: #fff;
		align-self: center;
		justify-self: center;
		grid-area: attempt-start / attempt-start / attempt-end / attempt-end;
	}
	
	/* === Timer === */
	.timer-area {
		grid-area: timer-start / timer-start / timer-end / timer-end;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	
	.timer {
		font-size: 26vh;  /* matches owlcms attemptboard.css */
		--timer-font-size: 26vh;  /* CSS variable for CountdownTimer component */
		font-weight: bold;
		line-height: 1;
		color: yellow;  /* --athleteTimerColor */
	}

	/* Override CountdownTimer component styles */
	.timer :global(.timer-display) {
		font-family: Arial, Helvetica, sans-serif !important;
		letter-spacing: normal !important;
		font-weight: bold;
	}

	.athlete-timer {
		color: yellow;  /* --athleteTimerColor */
	}

	.break-time {
		color: skyblue;  /* --breakTimerColor */
	}
	
	.waiting-message {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		text-align: center;
	}
	
	.big-title {
		text-align: center;
	}
	
	.competition-name {
		font-size: 8vh;
		color: #fff;
	}
	
	.next-group {
		font-size: 4vh;
		color: #888;
		margin-top: 2vh;
	}
	
	/* === Responsive === */
	@media screen and (max-width: 1300px) {
		.last-name {
			font-size: 7vw;
			line-height: 7vw;
		}
		.first-name {
			font-size: 7vw;
			line-height: 7vw;
		}
		.weight {
			font-size: 12vw;
			line-height: 7vw;
		}
		.start-number {
			font-size: 8vh;
		}
		.category {
			font-size: 7.5vh;
		}
		.attempt {
			font-size: 8vh;
			line-height: 8vh;
		}
		.timer {
			font-size: 15vw;
		}
	}
	
	@media screen and (max-width: 1025px) {
		.timer {
			font-size: 12vw;
		}
	}
</style>
