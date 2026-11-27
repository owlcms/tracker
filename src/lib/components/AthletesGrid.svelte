<script>
	// Athletes Grid Component - shared across all 3 grid scoreboards (session-results, lifting-order, rankings)
	// Displays: headers, athlete rows with attempts, category spacers, and optional leaders section
	
	export let allAthletes = [];
	export let headers = {}; // Pre-translated headers from server
	export let showLeaders = false;
	export let hasLeaders = false;
	export let data = {};

	$: displaySettings = data.displaySettings || {};
	$: showLiftRanks = displaySettings.showLiftRanks === true;
	$: showTotalRank = displaySettings.showTotalRank !== false;
	$: showMedalScore = displaySettings.showMedalScore === true;
	$: showMedalKgTop = displaySettings.showMedalKgTop === true;
	$: showMedalKgUp = displaySettings.showMedalKgUp === true;
	$: hasMedalRank = displaySettings.hasMedalRank === true;
	$: showRank = hasMedalRank || showTotalRank;
	$: showAge = displaySettings.showAge === true;
	$: bornHeader = showAge ? (headers.age || '!!Age') : (headers.birth || '!!Born');
	$: snatchGroupSpan = showLiftRanks ? 5 : 4;
	$: snatchSpacerCol = 6;
	$: snatchAttempt1Col = 7;
	$: snatchAttempt2Col = 8;
	$: snatchAttempt3Col = 9;
	$: snatchBestCol = 10;
	$: snatchRankCol = showLiftRanks ? 11 : null;
	$: middleSpacerCol = showLiftRanks ? 12 : 11;
	$: cjAttempt1Col = showLiftRanks ? 13 : 12;
	$: cjAttempt2Col = showLiftRanks ? 14 : 13;
	$: cjAttempt3Col = showLiftRanks ? 15 : 14;
	$: cjBestCol = showLiftRanks ? 16 : 15;
	$: cjRankCol = showLiftRanks ? 17 : null;
	$: totalSpacerCol = showLiftRanks ? 18 : 16;
	$: totalCol = showLiftRanks ? 19 : 17;
	$: scoreCol = showMedalScore ? totalCol + 1 : null;
	$: kgTopCol = showMedalKgTop ? (scoreCol ? scoreCol + 1 : totalCol + 1) : null;
	$: kgUpCol = showMedalKgUp
		? (kgTopCol ? kgTopCol + 1 : (scoreCol ? scoreCol + 1 : totalCol + 1))
		: null;
	$: rankCol = showRank
		? (kgUpCol ? kgUpCol + 1 : (kgTopCol ? kgTopCol + 1 : (scoreCol ? scoreCol + 1 : totalCol + 1)))
		: null;
	$: gridTemplateColumns = [
		'var(--col-start)',
		'var(--col-name)',
		'var(--col-cat)',
		'var(--col-born)',
		'var(--col-team)',
		'var(--col-gap)',
		'repeat(3, var(--col-attempt))',
		'var(--col-best)',
		...(showLiftRanks ? ['var(--col-rank)'] : []),
		'var(--col-gap)',
		'repeat(3, var(--col-attempt))',
		'var(--col-best)',
		...(showLiftRanks ? ['var(--col-rank)'] : []),
		'var(--col-gap)',
		'var(--col-total)',
		...(showMedalScore ? ['var(--col-score)'] : []),
		...(showMedalKgTop ? ['var(--col-delta)'] : []),
		...(showMedalKgUp ? ['var(--col-delta)'] : []),
		...(showRank ? ['var(--col-total-rank)'] : [])
	].join(' ');
	
	// Helper functions (same as in parent component)
	export function shouldRenderFlag(url) {
		if (!url) return false;
		if (typeof url === 'string' && url.startsWith('data:image/')) return false;
		return true;
	}
	
	export function getAttemptClass(attempt) {
		if (!attempt) return 'empty';
		
		// Handle plain number (legacy format from old OWLCMS)
		if (typeof attempt === 'number') {
			if (attempt === 0) return 'empty';
			if (attempt > 0) return 'success';
			return 'failed';  // negative = failed
		}
		
		// Handle object formats
		const status = attempt.liftStatus || attempt.status;
		if (!status || status === 'empty') return 'empty';
		if (status === 'bad') return 'failed';
		if (status === 'good') return 'success';
		if (status === 'current') return 'current-attempt';
		if (status === 'next') return 'next-attempt';
		if (status === 'request') return 'request';
		return 'empty';
	}
	
	export function displayAttempt(attempt) {
		if (!attempt) return '-';
		
		// Handle plain number (legacy format from old OWLCMS)
		if (typeof attempt === 'number') {
			if (attempt === 0) return '-';
			const absValue = String(Math.abs(attempt));
			return attempt < 0 ? `(${absValue})` : absValue;
		}
		
		// Handle string (shouldn't happen but be safe)
		if (typeof attempt === 'string') {
			return attempt || '-';
		}
		
		// Handle object formats:
		// V2 from OWLCMS: { value: 85, status: "good" }
		// Normalized hub format: { stringValue: "85", liftStatus: "good" }
		const val = attempt.stringValue ?? attempt.value;
		const status = attempt.liftStatus || attempt.status;
		
		// Safety check: if val is an object, it will render as [object Object]
		if (typeof val === 'object' && val !== null) {
			console.warn('[AthletesGrid] Attempt value is an object:', val);
			return '?';
		}
		
		// 0 lifts (not taken in session) should display as "-"
		if (val === 0 || val === '0') return '-';
		
		if (val === null || val === undefined || val === '' || val === '-') return '-';
		
		// Handle negative values (failed lifts) - show absolute value
		const numVal = parseInt(val, 10);
		if (!isNaN(numVal) && numVal < 0) {
			return `(${Math.abs(numVal)})`;
		}
		
		const displayValue = String(val);
		return status === 'bad' ? `(${displayValue})` : displayValue;
	}
</script>

<div class="scoreboard-grid" role="grid" style:grid-template-columns={gridTemplateColumns}>
	<div class="grid-row header header-primary" role="row">
		<div class="cell header col-start span-two" role="columnheader" style:grid-column="1">{headers.start || '!!Start'}</div>
		<div class="cell header col-name span-two" role="columnheader" style:grid-column="2">{headers.name || '!!Name'}</div>
		<div class="cell header col-cat span-two" role="columnheader" style:grid-column="3">{headers.category || '!!Cat.'}</div>
		<div class="cell header col-born span-two" role="columnheader" style:grid-column="4">{bornHeader}</div>
		<div class="cell header col-team span-two" role="columnheader" style:grid-column="5">{headers.team || '!!Team'}</div>
		<div class="cell header v-spacer v-spacer-snatch span-two" aria-hidden="true" style:grid-column={String(snatchSpacerCol)}></div>
		<div class="cell header col-group col-group-snatch" role="columnheader" style={`grid-column: ${snatchAttempt1Col} / span ${snatchGroupSpan};`}>{headers.snatch || '!!Snatch'}</div>
		<div class="cell header v-spacer v-spacer-middle span-two" aria-hidden="true" style:grid-column={String(middleSpacerCol)}></div>
		<div class="cell header col-group col-group-cj" role="columnheader" style={`grid-column: ${cjAttempt1Col} / span ${snatchGroupSpan};`}>{@html headers.cleanJerk || '!!Clean &amp; Jerk'}</div>
		<div class="cell header v-spacer v-spacer-total span-two" aria-hidden="true" style:grid-column={String(totalSpacerCol)}></div>
		<div class="cell header col-total span-two" role="columnheader" style:grid-column={String(totalCol)}>{headers.total || '!!Total'}</div>
		{#if showMedalScore}
			<div class="cell header col-score span-two" role="columnheader" style:grid-column={String(scoreCol)}>{displaySettings.medalScoringName || headers.score || '!!Score'}</div>
		{/if}
		{#if showMedalKgTop}
			<div class="cell header col-delta kg-top span-two" role="columnheader" style:grid-column={String(kgTopCol)}>{headers.deltaTop || '!!∆kg Top'}</div>
		{/if}
		{#if showMedalKgUp}
			<div class="cell header col-delta kg-up span-two" role="columnheader" style:grid-column={String(kgUpCol)}>{headers.deltaUp || '!!∆kg Up'}</div>
		{/if}
		{#if showRank}
			<div class="cell header col-rank total-rank span-two" role="columnheader" style:grid-column={String(rankCol)}>{headers.rank || '!!Rank'}</div>
		{/if}
	</div>
	<div class="grid-row header header-secondary" role="row">
		<div class="cell header col-name-portrait" role="columnheader" style:grid-column="2">{headers.name || '!!Name'}</div>
		<div class="cell header v-spacer v-spacer-snatch" aria-hidden="true" style:grid-column={String(snatchSpacerCol)}></div>
		<div class="cell header col-attempt snatch-1" role="columnheader" style:grid-column={String(snatchAttempt1Col)}>1</div>
		<div class="cell header col-attempt snatch-2" role="columnheader" style:grid-column={String(snatchAttempt2Col)}>2</div>
		<div class="cell header col-attempt snatch-3" role="columnheader" style:grid-column={String(snatchAttempt3Col)}>3</div>
		<div class="cell header col-best snatch-best" role="columnheader" style:grid-column={String(snatchBestCol)}>{headers.best || '!!✔'}</div>
		{#if showLiftRanks}
			<div class="cell header col-rank snatch-rank" role="columnheader" style:grid-column={String(snatchRankCol)}>{headers.rank || '!!Rank'}</div>
		{/if}
		<div class="cell header v-spacer v-spacer-middle" aria-hidden="true" style:grid-column={String(middleSpacerCol)}></div>
		<div class="cell header col-attempt cj-1" role="columnheader" style:grid-column={String(cjAttempt1Col)}>1</div>
		<div class="cell header col-attempt cj-2" role="columnheader" style:grid-column={String(cjAttempt2Col)}>2</div>
		<div class="cell header col-attempt cj-3" role="columnheader" style:grid-column={String(cjAttempt3Col)}>3</div>
		<div class="cell header col-best cj-best" role="columnheader" style:grid-column={String(cjBestCol)}>{headers.best || '!!✓'}</div>
		{#if showLiftRanks}
			<div class="cell header col-rank cj-rank" role="columnheader" style:grid-column={String(cjRankCol)}>{headers.rank || '!!Rank'}</div>
		{/if}
		<div class="cell header v-spacer v-spacer-total" aria-hidden="true" style:grid-column={String(totalSpacerCol)}></div>
		<div class="cell header col-total-portrait" role="columnheader" style:grid-column={String(totalCol)}>{headers.total || '!!Total'}</div>
		{#if showRank}
			<div class="cell header col-rank-portrait total-rank" role="columnheader" style:grid-column={String(rankCol)}>{headers.rank || '!!Rank'}</div>
		{/if}
	</div>

	{#each allAthletes as athlete}
		{#if athlete.isSpacer}
			<div class="grid-row spacer category-spacer" aria-hidden="true">
				<div class="cell span-all"></div>
			</div>
		{:else}
			<div
				class="grid-row data-row"
				class:current={athlete.classname && athlete.classname.includes('current')}
				class:next={athlete.classname && athlete.classname.includes('next')}
				role="row"
			>
			<div class="cell start-num" role="gridcell">{athlete.startNumber}</div>
				<div class="cell name" role="gridcell"><span class="name-text">{athlete.fullName}</span></div>
				<div class="cell cat" role="gridcell">{athlete.category || ''}</div>
				<div class="cell born" role="gridcell">{showAge ? (athlete.age || '') : (athlete.yearOfBirth || '')}</div>
				<div class="cell team-name" role="gridcell">
					{#if shouldRenderFlag(athlete.flagUrl)}
						<img src={athlete.flagUrl} alt={athlete.teamName} class="team-flag" />
					{/if}
				<span class="team-name-text">{athlete.teamName || ''}</span>
				</div>
				<div class="cell v-spacer" aria-hidden="true"></div>
				<div class="cell attempt {getAttemptClass(athlete.sattempts?.[0])}" role="gridcell">
					<span class="attempt-value">{displayAttempt(athlete.sattempts?.[0])}</span>
				</div>
				<div class="cell attempt {getAttemptClass(athlete.sattempts?.[1])}" role="gridcell">
					<span class="attempt-value">{displayAttempt(athlete.sattempts?.[1])}</span>
				</div>
				<div class="cell attempt {getAttemptClass(athlete.sattempts?.[2])}" role="gridcell">
					<span class="attempt-value">{displayAttempt(athlete.sattempts?.[2])}</span>
				</div>
				<div class="cell best" role="gridcell">{athlete.bestSnatch || '-'}</div>
				{#if showLiftRanks}
					<div class="cell rank" role="gridcell">{athlete.snatchRank || '-'}</div>
				{/if}
				<div class="cell v-spacer" aria-hidden="true"></div>
				<div class="cell attempt {getAttemptClass(athlete.cattempts?.[0])}" role="gridcell">
					<span class="attempt-value">{displayAttempt(athlete.cattempts?.[0])}</span>
				</div>
				<div class="cell attempt {getAttemptClass(athlete.cattempts?.[1])}" role="gridcell">
					<span class="attempt-value">{displayAttempt(athlete.cattempts?.[1])}</span>
				</div>
				<div class="cell attempt {getAttemptClass(athlete.cattempts?.[2])}" role="gridcell">
					<span class="attempt-value">{displayAttempt(athlete.cattempts?.[2])}</span>
				</div>
				<div class="cell best" role="gridcell">{athlete.bestCleanJerk || '-'}</div>
				{#if showLiftRanks}
					<div class="cell rank" role="gridcell">{athlete.cleanJerkRank || '-'}</div>
				{/if}
				<div class="cell v-spacer" aria-hidden="true"></div>
				<div class="cell total" role="gridcell">{athlete.total || '-'}</div>
				{#if showMedalScore}
					<div class="cell score" role="gridcell">{athlete.medalScore || ''}</div>
				{/if}
				{#if showMedalKgTop}
					<div class="cell delta kg-top" role="gridcell">{athlete.medalKgTop || ''}</div>
				{/if}
				{#if showMedalKgUp}
					<div class="cell delta kg-up" role="gridcell">{athlete.medalKgUp || ''}</div>
				{/if}
				{#if showRank}
					<div class="cell rank total-rank" role="gridcell">{hasMedalRank ? (athlete.medalRank || '-') : (athlete.totalRank || '-')}</div>
				{/if}
			</div>
		{/if}
	{/each}

	{#if hasLeaders && showLeaders}
		<!-- Elastic spacer row separating results from leaders -->
		<div class="grid-row leaders-spacer" aria-hidden="true">
			<div class="cell span-all"></div>
		</div>

		<!-- Leaders title row spanning all columns -->
		<div class="grid-row leaders-header">
			<div class="cell leaders-title-cell span-all">
				{headers.leaders || '!!Leaders'}
			</div>
		</div>

		<!-- Leader rows -->
		{#each data.leaders as leader}
			{#if leader.isSpacer}
				<div class="grid-row spacer category-spacer" aria-hidden="true">
					<div class="cell span-all"></div>
				</div>
			{:else}
				<div class="grid-row leader-row" role="row">
					<div class="cell start-num" role="gridcell">{leader.subCategory || ''}</div>
					<div class="cell name" role="gridcell"><span class="name-text">{leader.fullName || ''}</span></div>
					<div class="cell cat" role="gridcell">{leader.category || ''}</div>
					<div class="cell born" role="gridcell">{showAge ? (leader.age || '') : (leader.yearOfBirth || '')}</div>
					<div class="cell team-name" role="gridcell">
						{#if shouldRenderFlag(leader.flagUrl)}
							<img class="team-flag" src={leader.flagUrl} alt={leader.teamName || ''} />
						{/if}
						{leader.teamName || ''}
					</div>
					<div class="cell v-spacer" aria-hidden="true"></div>
					<div class="cell attempt {getAttemptClass(leader.sattempts?.[0])}" role="gridcell">
						<span class="attempt-value">{displayAttempt(leader.sattempts?.[0])}</span>
					</div>
					<div class="cell attempt {getAttemptClass(leader.sattempts?.[1])}" role="gridcell">
						<span class="attempt-value">{displayAttempt(leader.sattempts?.[1])}</span>
					</div>
					<div class="cell attempt {getAttemptClass(leader.sattempts?.[2])}" role="gridcell">
						<span class="attempt-value">{displayAttempt(leader.sattempts?.[2])}</span>
					</div>
					<div class="cell best" role="gridcell">{leader.bestSnatch || '-'}</div>
					{#if showLiftRanks}
						<div class="cell rank" role="gridcell">{leader.snatchRank || '-'}</div>
					{/if}
					<div class="cell v-spacer" aria-hidden="true"></div>
					<div class="cell attempt {getAttemptClass(leader.cattempts?.[0])}" role="gridcell">
						<span class="attempt-value">{displayAttempt(leader.cattempts?.[0])}</span>
					</div>
					<div class="cell attempt {getAttemptClass(leader.cattempts?.[1])}" role="gridcell">
						<span class="attempt-value">{displayAttempt(leader.cattempts?.[1])}</span>
					</div>
					<div class="cell attempt {getAttemptClass(leader.cattempts?.[2])}" role="gridcell">
						<span class="attempt-value">{displayAttempt(leader.cattempts?.[2])}</span>
					</div>
					<div class="cell best" role="gridcell">{leader.bestCleanJerk || '-'}</div>
					{#if showLiftRanks}
						<div class="cell rank" role="gridcell">{leader.cleanJerkRank || '-'}</div>
					{/if}
					<div class="cell v-spacer" aria-hidden="true"></div>
					<div class="cell total" role="gridcell">{leader.total || '-'}</div>
					{#if showMedalScore}
						<div class="cell score" role="gridcell">{leader.medalScore || ''}</div>
					{/if}
					{#if showMedalKgTop}
						<div class="cell delta kg-top" role="gridcell">{leader.medalKgTop || ''}</div>
					{/if}
					{#if showMedalKgUp}
						<div class="cell delta kg-up" role="gridcell">{leader.medalKgUp || ''}</div>
					{/if}
					{#if showRank}
						<div class="cell rank total-rank" role="gridcell">{hasMedalRank ? (leader.medalRank || '-') : (leader.totalRank || '-')}</div>
					{/if}
				</div>
			{/if}
		{/each}
	{/if}
</div>

<style>
	.scoreboard-grid {
		--col-start: 4.9rem;
		--col-name: minmax(14rem, 2.5fr);
		--col-cat: max-content;
		--col-born: max-content;
		--col-team: minmax(8rem, 1.8fr);
		--col-gap: 0.65rem;
		--col-attempt: 4.4rem;
		--col-best: 4.4rem;
		--col-total: 4.9rem;
		--col-score: 7.2rem;
		--col-delta: 6.2rem;
		--col-rank: 4.9rem;
		--col-total-rank: var(--col-total);
		/* Header row heights: keep these in sync with grid-template-rows and sticky offsets */
		--header-primary-vpad: 0.25rem; /* vertical padding for primary header cells */
		--header-primary-height: calc(1rem + (var(--header-primary-vpad) * 2));
		--header-secondary-vpad: 0.3rem; /* vertical padding used in secondary header cells */
		--header-secondary-height: calc(1rem + (var(--header-secondary-vpad) * 2));
		display: grid;
		width: 100%;
		flex: 1;
		/* Use the same variables for row heights and sticky positioning to avoid gaps */
		grid-template-rows: var(--header-primary-height) var(--header-secondary-height) var(--template-rows);
		row-gap: 0;
		font-size: 1.1rem;
		line-height: 1.05;
	}

	.grid-row {
		display: contents;
	}

	.cell {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.375rem 0.25rem;
		border: 1px solid #444;
		background: #1a1a1a;
		color: #fff;
		line-height: 1.05;
	}

	.cell.header {
		background: #3a3a3a;
		border-color: #555;
		font-weight: bold;
	}

	.header-secondary > .cell.header {
		background: #2a2a2a;
	}

	.header-primary > .cell {
		grid-row: 1;
		align-self: stretch;
		padding: var(--header-primary-vpad) 0.15rem;
		min-height: 0;
	}

	.header-primary > .cell.span-two {
		grid-row: 1 / span 2;
	}

	.header-secondary > .cell {
		grid-row: 2;
		font-size: 1rem;
		padding: var(--header-secondary-vpad) 0.15rem;
		min-height: 0;
	}

	.header-secondary .cell.v-spacer {
		height: 0;
		min-height: 0;
	}

	.col-group {
		justify-content: center;
		font-size: 1.1rem;
	}

	.span-two {
		align-self: stretch;
	}

	.cell.v-spacer {
		background: #000;
		border: none;
		padding: 0;
		height: var(--col-gap);
		min-height: var(--col-gap);
	}

	.header .cell.v-spacer {
		background: #000;
		border: none;
		height: 0;
		min-height: 0;
		padding: 0;
	}

	.header-secondary .cell.v-spacer {
		height: 0;
		min-height: 0;
	}

	.cell.span-all {
		grid-column: 1 / -1;
	}

	.cell.name,
	.cell.team-name {
		justify-content: flex-start;
		padding-left: 0.625rem;
		text-align: left;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.cell.name .name-text,
	.cell.team-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
		flex: 1;
	}

	.cell.team-name .team-name-text {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
		flex: 1;
	}

	.team-flag {
		height: 1.2rem;
		max-width: 1.5rem;
		object-fit: contain;
		transform: scale(1.5);
		transform-origin: left center;
		margin-right: 0.5rem;
		filter: drop-shadow(0 0 0.5px white) drop-shadow(0 0 0.5px white);
	}

	/* Hide any data: URI flags (covers legacy 1x1 transparent PNG placeholders) */
	.team-flag[src^="data:image/"] {
		display: none;
	}

	.cell.cat {
		justify-content: center;
		padding-left: 1ch;
		padding-right: 1ch;
		text-align: center;
		white-space: nowrap;
	}

	.cell.born {
		padding-left: 1ch;
		padding-right: 1ch;
	}

	.header-primary .col-cat,
	.header-primary .col-born {
		padding-left: 1ch;
		padding-right: 1ch;
	}

	.cell.start-num {
		font-weight: bold;
		color: #fbbf24;
	}

	.cell.best,
	.cell.total,
	.cell.score,
	.cell.delta,
	.cell.rank {
		background: #2a2a2a;
		font-weight: bold;
	}

	.cell.total,
	.cell.score,
	.cell.delta,
	.cell.rank {
		color: #fff;
	}

	.grid-row.current > .start-num,
	.grid-row.current > .name {
		color: #4ade80 !important;
		font-weight: bold;
	}

	.grid-row.next > .start-num,
	.grid-row.next > .name {
		color: #f97316 !important;
		font-weight: bold;
	}

	.attempt {
		font-weight: bold;
		white-space: nowrap;
		padding: 0 0.35rem;
	}

	.header-secondary .col-attempt {
		white-space: nowrap;
		padding: var(--header-secondary-vpad) 0.35rem;
	}

	.attempt.empty {
		background: transparent;
		color: #aaa !important;
	}

	.attempt.success {
		background: #fff !important;
		color: #000;
	}

	.attempt.failed {
		background: darkred !important;
		color: #fff;
	}

	/* Current athlete's pending attempt - should blink */
	.attempt.current-attempt {
		background: transparent;
		color: #4ade80 !important;
	}

	.attempt.current-attempt .attempt-value {
		animation: blink-text 2s ease-in-out infinite;
	}

	/* Next athlete's pending attempt */
	.attempt.next-attempt {
		background: transparent;
		color: #f97316 !important;
	}

	/* Other athletes' pending requests */
	.attempt.request {
		background: transparent;
		color: #aaa !important;
	}

	@keyframes blink-text {
		0%, 49% { opacity: 1; }
		50%, 100% { opacity: 0; }
	}

	.grid-row.spacer > .cell {
		grid-column: 1 / -1;
		background: #000;
		border: none;
		padding: 0;
		min-height: 10px;
		height: 10px;
		overflow: hidden;
		display: block;
	}

	/* Elastic spacer row between results and leaders sections */
	/* Must be display: grid so that 1fr sizing in parent's grid-template-rows applies to this row */
	.grid-row.leaders-spacer {
		display: grid;
		grid-column: 1 / -1;
		grid-template-columns: 1fr;
	}

	.grid-row.leaders-spacer > .cell {
		grid-column: 1 / -1;
		background: transparent;
		border: none;
		padding: 0;
		display: block;
	}

	/* Leaders header row with title spanning all columns */
	.grid-row.leaders-header {
		display: grid;
		grid-column: 1 / -1;
		grid-template-columns: 1fr;
	}

	.grid-row.leaders-header > .cell {
		grid-column: 1 / -1;
	}

	.cell.leaders-title-cell {
		background: transparent;
		border: none;
		padding: 1.5rem 0 0.25rem 0;
		font-weight: bold;
		font-size: 1.2rem;
		color: #ccc;
		justify-content: flex-start;
		text-align: left;
	}

	.header-secondary .col-name-portrait,
	.header-secondary .col-total-portrait,
	.header-secondary .col-rank-portrait {
		visibility: hidden;
		pointer-events: none;
		padding: 0;
		height: 0;
		border: none;
	}

	.header-secondary .v-spacer {
		background: #000;
		border: none;
		height: 0;
		padding: 0;
	}

	/* Responsive adjustments for landscape mode */
	/* iPad landscape and 1366x768: Moderate reduction */
	@media (max-width: 1366px) and (orientation: landscape) {
		.scoreboard-grid {
			--col-start: 4.5rem;
			--col-name: minmax(12rem, 2.3fr);
			--col-team: minmax(7.5rem, 1.7fr);
			--col-cat: max-content;
			--col-born: max-content;
			--col-attempt: 4rem;
			--col-best: 4rem;
			--col-total: 4.5rem;
			--col-rank: 4.5rem;
			--col-gap: 0.5rem;
		}

		.cell {
			font-size: 1.05rem;
		}
	}

	/* 720p (1280x720) and iPad Mini landscape: Tighter layout */
	@media (max-width: 1280px) and (orientation: landscape) {
		.scoreboard-grid {
			--col-start: 4rem;
			--col-name: minmax(11rem, 2.1fr);
			--col-team: minmax(7rem, 1.5fr);
			--col-cat: max-content;
			--col-born: max-content;
			--col-attempt: 3.6rem;
			--col-best: 3.6rem;
			--col-total: 4.2rem;
			--col-rank: 4rem;
			--col-gap: 0.4rem;
		}

		.cell {
			font-size: 1rem;
			padding: 0.3rem 0.2rem;
		}

		.header-secondary > .cell {
			font-size: 0.95rem;
		}
	}

	/* iPhone XR+ landscape (896x414) and iPhone Pro models (960x440): Compact layout */
	@media (max-width: 960px) and (orientation: landscape) {
		.scoreboard-grid {
			--col-start: 2.5rem;
			--col-name: minmax(6rem, 1.5fr);
			--col-team: minmax(3rem, 0.8fr);
			--col-cat: 7ch;
			--col-born: 0; /* Hide birth year on small screens */
			--col-attempt: 2.4rem;
			--col-best: 2.4rem;
			--col-total: 2.8rem;
			--col-rank: 2.5rem;
			--col-gap: 0.2rem;
			--header-primary-height: 1.4rem;
		}

		.cell {
			font-size: 0.7rem;
			padding: 0.15rem 0.1rem;
		}

		.header-primary > .cell,
		.header-secondary > .cell,
		.col-group {
			font-size: 0.6rem;
			padding: 0.05rem;
			line-height: 0.9;
		}

		/* Hide birth year column on small screens */
		.header-primary .col-born,
		.grid-row.data-row > .born,
		.grid-row.leader-row > .born {
			visibility: hidden;
			width: 0;
			padding: 0;
			border: none;
			overflow: hidden;
			display: block;
		}
	}

	/* ===== PORTRAIT MODE ===== */
	
	/* All portrait modes: Hide team, born, best, start, and category columns - show only name, lifts, total */
	@media (orientation: portrait) {
		.scoreboard-grid {
			--col-start: 0;
			--col-team: 0;
			--col-born: 0;
			--col-best: 0;
			--col-cat: 0;
			--col-rank: 0;
		}

		/* Hide team, born, best, start, cat, rank columns with visibility */
		.header-primary .col-team,
		.header-primary .col-born,
		.header-primary .col-start,
		.header-primary .col-cat,
		.header-primary .col-rank:not(.total-rank),
		.header-secondary .col-best,
		.header-secondary .snatch-rank,
		.header-secondary .cj-rank,

		.header-secondary .col-rank-portrait,
		.grid-row.data-row > .team-name,
		.grid-row.data-row > .born,
		.grid-row.data-row > .best,
		.grid-row.data-row > .start-num,
		.grid-row.data-row > .cat,
		.grid-row.data-row > .rank:not(.total-rank),
		.grid-row.leader-row > .team-name,
		.grid-row.leader-row > .born,
		.grid-row.leader-row > .best,
		.grid-row.leader-row > .start-num,
		.grid-row.leader-row > .cat,
		.grid-row.leader-row > .rank:not(.total-rank) {
			visibility: hidden;
			width: 0;
			padding: 0;
			border: none;
			overflow: hidden;
		}
	}

	/* Phones portrait (< 768px): hide total rank — not enough room */
	@media (max-width: 767px) and (orientation: portrait) {
		.scoreboard-grid {
			--col-total-rank: 0;
		}

		.header-primary .col-rank.total-rank,
		.header-secondary .col-rank-portrait.total-rank,
		.grid-row.data-row > .rank.total-rank,
		.grid-row.leader-row > .rank.total-rank {
			visibility: hidden;
			width: 0;
			padding: 0;
			border: none;
			overflow: hidden;
		}
	}

	/* iPad portrait (768x1024): Comfortable sizing */
	@media (max-width: 1024px) and (orientation: portrait) {
		.scoreboard-grid {
			--col-name: minmax(10rem, 2fr);
			--col-attempt: 3.5rem;
			--col-total: 4rem;
			--col-gap: 0.4rem;
		}

		.cell {
			font-size: 1rem;
			padding: 0.3rem 0.2rem;
		}

		.header-secondary > .cell {
			font-size: 0.95rem;
		}

		.cell.leaders-title-cell {
			font-size: 0.95rem;
			padding: 1rem 0 0.2rem 0;
		}
	}

	/* iPad Pro 12.9" portrait (≥ 1024px): restore snatch/CJ ranks */
	@media (min-width: 1024px) and (orientation: portrait) {
		.scoreboard-grid {
			--col-rank: 4rem;
		}

		.header-secondary .snatch-rank,
		.header-secondary .cj-rank,
		.grid-row.data-row > .rank:not(.total-rank),
		.grid-row.leader-row > .rank:not(.total-rank) {
			visibility: visible;
			width: auto;
			padding: 0.3rem 0.2rem;
			border: 1px solid #555;
			overflow: visible;
		}

		.header-secondary .snatch-rank,
		.header-secondary .cj-rank {
			padding: var(--header-secondary-vpad) 0.15rem;
		}
	}

	/* Large phones portrait (430px - iPhone Plus/Pro Max): Very compact */
	@media (max-width: 430px) and (orientation: portrait) {
		.scoreboard-grid {
			--col-name: minmax(6rem, 1.5fr);
			--col-attempt: 2rem;
			--col-total: 2.5rem;
			--col-gap: 0.15rem;
			--header-primary-height: 1rem;
			--header-secondary-height: 0.7rem;
		}

		.cell {
			font-size: 0.6rem;
			padding: 0.15rem 0.05rem;
		}

		.header-primary > .cell,
		.col-group {
			font-size: 0.55rem;
			padding: 0.02rem;
			line-height: 0.8;
		}

		.header-secondary > .cell {
			font-size: 0.55rem;
			padding: 0;
			line-height: 0.7;
		}

		.cell.leaders-title-cell {
			font-size: 0.75rem;
			padding: 0.5rem 0 0.1rem 0;
		}
	}

	/* Standard phones portrait (390px - iPhone 15/16): Minimal layout */
	@media (max-width: 390px) and (orientation: portrait) {
		.scoreboard-grid {
			--col-name: minmax(5rem, 1.3fr);
			--col-attempt: 1.8rem;
			--col-total: 2.2rem;
			--col-gap: 0.1rem;
			--header-primary-height: 0.9rem;
			--header-secondary-height: 0.65rem;
		}

		.cell {
			font-size: 0.55rem;
			padding: 0.12rem 0.03rem;
		}

		.header-primary > .cell,
		.col-group {
			font-size: 0.5rem;
			padding: 0.01rem;
			line-height: 0.75;
		}

		.header-secondary > .cell {
			font-size: 0.5rem;
			padding: 0;
			line-height: 0.65;
		}

		.cell.leaders-title-cell {
			font-size: 0.7rem;
			padding: 0.4rem 0 0.08rem 0;
		}
	}
</style>
