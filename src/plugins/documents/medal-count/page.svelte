<script>
	import { appendPdfTimestamp } from '$lib/pdf-filenames.js';

	export let data = {};

	$: pageTitle = appendPdfTimestamp(data.header?.fileTitle || data.labels?.title);
	$: labels = data.labels || {};
	$: sessions = data.sessions || [];
	$: grandTotal = data.grandTotal || { categories: 0, gold: 0, silver: 0, bronze: 0, medals: 0 };
</script>

<svelte:head>
	<title>{pageTitle}</title>
</svelte:head>

<div class="sheet">
	{#if data.status === 'ready'}
		<div class="sheet-header">
			<h1>{labels.title}</h1>
			{#if data.header.competitionName}
				<h1 class="competition-name">{data.header.competitionName}</h1>
			{/if}
			{#if data.header.locationLine}
				<p class="header-info">{data.header.locationLine}</p>
			{/if}
			{#if data.medalLifts?.length}
				<p class="header-info">{labels.medals}: {data.medalLifts.join('; ')}</p>
			{/if}
		</div>

		<!-- Summary: one row per session -->
		<table class="count-table summary">
			<thead>
				<tr>
					<th class="text">{labels.session}</th>
					{#if data.hasMultiplePlatforms}
						<th class="text">{labels.platform}</th>
					{/if}
					<th>{labels.categories}</th>
					<th>{labels.gold}</th>
					<th>{labels.silver}</th>
					<th>{labels.bronze}</th>
					<th>{labels.medals}</th>
				</tr>
			</thead>
			<tbody>
				{#each sessions as session (session.id)}
					<tr>
						<td class="text">
							<span class="session-name">{session.name}</span>
							{#if session.description}
								<span class="session-desc">{session.description}</span>
							{/if}
						</td>
						{#if data.hasMultiplePlatforms}
							<td class="text">{session.platform}</td>
						{/if}
						<td>{session.totals.categories}</td>
						<td>{session.totals.gold}</td>
						<td>{session.totals.silver}</td>
						<td>{session.totals.bronze}</td>
						<td>{session.totals.gold + session.totals.silver + session.totals.bronze}</td>
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr>
					<td class="text" colspan={data.hasMultiplePlatforms ? 2 : 1}>{labels.total}</td>
					<td>{grandTotal.categories}</td>
					<td>{grandTotal.gold}</td>
					<td>{grandTotal.silver}</td>
					<td>{grandTotal.bronze}</td>
					<td>{grandTotal.medals}</td>
				</tr>
			</tfoot>
		</table>

		<!-- Detail: categories awarded in each session -->
		{#each sessions.filter((session) => session.categories.length > 0) as session (session.id)}
			<div class="session-block">
				<h2>
					{session.name}{#if session.description} — {session.description}{/if}
					{#if data.hasMultiplePlatforms && session.platform}
						<span class="sub">({labels.platform} {session.platform})</span>
					{/if}
					{#if session.date || session.time}
						<span class="sub">{[session.date, session.time].filter(Boolean).join(' ')}</span>
					{/if}
				</h2>
				<table class="count-table">
					<thead>
						<tr>
							<th class="text">{labels.ageGroup}</th>
							<th class="text">{labels.category}</th>
							<th>{labels.athletes}</th>
							<th>{labels.gold}</th>
							<th>{labels.silver}</th>
							<th>{labels.bronze}</th>
						</tr>
					</thead>
					<tbody>
						{#each session.categories as category (category.code)}
							<tr>
								<td class="text">{category.ageGroup}</td>
								<td class="text">
									{category.name}
									{#if category.spansSessions}
										<span class="note">({category.sessionNames.join(', ')})</span>
									{/if}
								</td>
								<td>{category.athleteCount}</td>
								<td>{category.gold}</td>
								<td>{category.silver}</td>
								<td>{category.bronze}</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr>
							<td class="text" colspan="2">{labels.total}</td>
							<td></td>
							<td>{session.totals.gold}</td>
							<td>{session.totals.silver}</td>
							<td>{session.totals.bronze}</td>
						</tr>
					</tfoot>
				</table>
			</div>
		{/each}
	{:else if data.status === 'no_sessions'}
		<p class="message">{labels.waitingForData}</p>
	{:else}
		<p class="message">{labels.waitingForData}</p>
	{/if}

	<div class="sheet-footer">{data.productionTimestamp}</div>
</div>

<style>
	.sheet {
		/* A4 portrait content width */
		max-width: 190mm;
		margin: 0 auto;
		padding: 0.75rem;
		background: #fff;
		color: #000;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
	}

	.sheet-header {
		text-align: center;
		margin-bottom: 0.75rem;
	}

	.sheet-header h1 {
		margin: 0 0 0.25rem 0;
		font-size: 1.1rem;
		font-weight: 400;
		letter-spacing: 0.05em;
	}

	.sheet-header h1.competition-name {
		font-weight: 700;
		margin-bottom: 0.15rem;
	}

	.header-info {
		font-size: 0.8rem;
		margin: 0.1rem 0;
	}

	.count-table {
		width: 100%;
		table-layout: fixed;
		border-collapse: collapse;
		border-radius: 0;
		font-size: 0.75rem;
		margin-bottom: 1rem;
	}

	th,
	td {
		border: 1px solid #000;
		padding: 0.2rem 0.3rem;
		text-align: center;
		overflow-wrap: break-word;
	}

	/* Numeric columns are wide enough for their labels; the text columns take the rest. */
	th:not(.text) {
		width: 5.5rem;
		white-space: nowrap;
	}

	th {
		background: #e8e8e8;
		font-weight: 700;
		font-size: 0.68rem;
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}

	th.text,
	td.text {
		text-align: left;
	}

	tfoot td {
		font-weight: 700;
		background: #f2f2f2;
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}

	.session-name {
		font-weight: 700;
	}

	.session-desc {
		margin-left: 0.4rem;
		font-size: 0.7rem;
	}

	.session-block {
		margin-bottom: 1.25rem;
		break-inside: avoid;
	}

	.session-block h2 {
		font-size: 0.95rem;
		margin: 0 0 0.3rem 0;
	}

	.sub {
		font-weight: 400;
		font-size: 0.8rem;
		margin-left: 0.4rem;
	}

	.note {
		font-size: 0.7rem;
		color: #555;
		margin-left: 0.3rem;
	}

	.message {
		font-size: 1rem;
		color: #333;
		padding: 1rem;
		text-align: center;
	}

	.sheet-footer {
		margin-top: 1rem;
		padding-top: 0.3rem;
		border-top: 1px solid #ccc;
		font-size: 0.7rem;
		color: #555;
		text-align: right;
	}

	@media print {
		@page {
			size: A4 portrait;
			margin: 10mm;
		}

		.sheet {
			max-width: none;
			padding: 0;
			font-size: 0.7rem;
		}

		.summary {
			break-after: page;
		}
	}
</style>
