<script>
	export let records = [];
	export let personalRecords = null;
	export const translations = {};
	export let headers = {};
	export let recordStatus = null;

	function getAllRecordCategories(recordsData) {
		if (!recordsData || recordsData.length === 0) return [];
		const categorySet = new Set();
		for (const federation of recordsData) {
			if (!federation.records) continue;
			for (const categoryKey of Object.keys(federation.records)) {
				categorySet.add(categoryKey);
			}
		}
		return Array.from(categorySet).sort();
	}

	function getCategoryDisplayName(recordsData, categoryKey) {
		if (!recordsData) return categoryKey;
		for (const federation of recordsData) {
			const category = federation.records?.[categoryKey];
			if (category?.displayName) return category.displayName;
		}
		return categoryKey;
	}

	function getRecordCell(federationData, category, liftType) {
		const entry = federationData.records?.[category]?.[liftType];
		if (!entry) return { value: '-', highlight: false };
		return entry;
	}

	$: categories = getAllRecordCategories(records);
	$: hasRecords = records && records.length > 0;
	$: hasPersonalRecords = !!personalRecords;
	$: hasRecordStatus = !!(recordStatus?.kind && recordStatus?.message);
</script>

{#if hasRecords || hasPersonalRecords}
	<div class="records-section">
		<div class="records-layout">
			{#if hasRecords}
				<div class="records-table-grid" style="--num-categories: {categories.length}">
				<!-- Row 1: Category headers with title in top-left, spanning 2 rows for spacers and main headers -->
				<div class="records-title-cell span-two">{headers?.records || '!!Records'}</div>
				{#each categories as category}
					<div class="records-v-spacer records-v-spacer-header span-two" aria-hidden="true"></div>
					<div class="records-category-header">{getCategoryDisplayName(records, category)}</div>
				{/each}

				<!-- Row 2: Sub-headers (S, CJ, T) -->
				{#each categories as _}
					<div class="records-subheader">S</div>
					<div class="records-subheader">CJ</div>
					<div class="records-subheader">T</div>
				{/each}

				<!-- Data rows: one per federation -->
				{#each records as federationData, rowIdx}
					<div class="records-federation-cell" class:last-row={rowIdx === records.length - 1}>
						{federationData.federation}
					</div>
					{#each categories as category}
						<div class="records-v-spacer" aria-hidden="true"></div>
						<div class="records-cell" class:highlighted={getRecordCell(federationData, category, 'S').highlight} class:last-row={rowIdx === records.length - 1}>
							{getRecordCell(federationData, category, 'S').value ?? '-'}
						</div>
						<div class="records-cell" class:highlighted={getRecordCell(federationData, category, 'CJ').highlight} class:last-row={rowIdx === records.length - 1}>
							{getRecordCell(federationData, category, 'CJ').value ?? '-'}
						</div>
						<div class="records-cell" class:highlighted={getRecordCell(federationData, category, 'T').highlight} class:last-row={rowIdx === records.length - 1}>
							{getRecordCell(federationData, category, 'T').value ?? '-'}
						</div>
					{/each}
				{/each}
				</div>
			{/if}

			{#if hasPersonalRecords}
				<div class="personal-records-grid">
					<div class="records-category-header personal-records-title">{personalRecords.title}</div>
					<div class="records-subheader">S</div>
					<div class="records-subheader">CJ</div>
					<div class="records-subheader">T</div>
					<div class="records-cell" class:highlighted={personalRecords.S.highlight}>{personalRecords.S.value}</div>
					<div class="records-cell" class:highlighted={personalRecords.CJ.highlight}>{personalRecords.CJ.value}</div>
					<div class="records-cell" class:highlighted={personalRecords.T.highlight}>{personalRecords.T.value}</div>
				</div>
			{/if}

			{#if hasRecordStatus}
				<div class="record-status-panel" class:attempt={recordStatus.kind === 'attempt'} class:new={recordStatus.kind === 'new'}>
					{recordStatus.message}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.records-section {
		padding: 2em 0 0 0;
		background: #000;
		overflow-x: auto;
	}

	.records-layout {
		display: flex;
		align-items: stretch;
		gap: 0.6rem;
		width: 100%;
		min-width: max-content;
	}

	.records-table-grid,
	.personal-records-grid {
		--col-spacer: 0.65rem;
		--col-lift: 3.5rem;
		--data-row-height: 2.0rem;
		--header-primary-vpad: 0.25rem;
		--header-secondary-vpad: 0.2rem;
		--header-primary-height: calc(1.2rem + (var(--header-primary-vpad) * 2));
		--header-secondary-height: calc(1.1rem + (var(--header-secondary-vpad) * 2));
		display: grid;
		grid-template-rows: var(--header-primary-height) var(--header-secondary-height);
		grid-auto-rows: var(--data-row-height);
		width: max-content;
		overflow: hidden;
		flex: 0 0 auto;
	}

	.records-table-grid {
		grid-template-columns: max-content repeat(var(--num-categories), var(--col-spacer) var(--col-lift) var(--col-lift) var(--col-lift));
	}

	.personal-records-grid {
		grid-template-columns: repeat(3, var(--col-lift));
	}

	.personal-records-title {
		grid-column: 1 / span 3;
	}

	.record-status-panel {
		display: flex;
		flex: 1 1 auto;
		align-items: center;
		justify-content: center;
		align-self: stretch;
		min-width: 16rem;
		padding: 0.75rem 1.5rem;
		font-size: 1.8rem;
		font-weight: 700;
		text-align: center;
		border: 1px solid transparent;
		white-space: nowrap;
	}

	.record-status-panel.attempt {
		background: #8f4f8f;
		border-color: #8f4f8f;
		color: #fff;
	}

	.record-status-panel.new {
		background: #2f6b3d;
		border-color: #2f6b3d;
		color: #fff;
	}

	/* Title cell in top-left, spanning both header rows */
	.records-title-cell {
		grid-column: 1;
		grid-row: 1 / span 2;
		display: flex;
		align-items: flex-start;
		justify-content: flex-end;
		padding: 0 0.15rem;
		background: transparent;
		font-weight: bold;
		font-size: 1.2rem;
		color: #ccc;
		border: none;
	}

	.span-two {
		grid-row: 1 / span 2;
	}

	/* Vertical spacers in data rows */
	.records-v-spacer {
		background: #000 !important;
		border: none;
		padding: 0;
		height: 100%;
		min-height: 100%;
		width: 100%;
		align-self: stretch;
		justify-self: stretch;
	}

	.records-v-spacer-header {
		background: #000 !important;
		border: none;
		padding: 0;
		height: 100%;
		min-height: 100%;
		width: 100%;
		align-self: stretch;
		justify-self: stretch;
		opacity: 1;
	}

	.records-v-spacer.span-two {
		grid-row: 1 / span 2;
	}

	/* Category headers spanning 3 columns */
	.records-category-header {
		grid-column: span 3;
		grid-row: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--header-primary-vpad) 0.15rem;
		background: #3a3a3a;
		font-size: 0.9rem;
		color: #e0e0e0;
		border: 1px solid #555;
		text-transform: uppercase;
	}

	/* Individual subheaders (S, CJ, T) */
	.records-subheader {
		grid-row: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--header-secondary-vpad) 0.15rem;
		background: #2a2a2a;
		font-size: 0.8rem;
		color: #e0e0e0;
		border: 1px solid #444;
		min-height: 0;
	}

	/* Data rows - federation name in first column */
	.records-federation-cell {
		grid-column: 1;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		padding: 0.25rem 0.75rem;
		background: transparent;
		font-weight: normal;
		font-size: 0.9rem;
		color: #fff;
		border-right: none;
		border-bottom: none;
		height: var(--data-row-height);
	}

	/* Data cells (record values) */
	.records-cell {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.25rem;
		background: #1a1a1a;
		font-size: 0.9rem;
		color: #e0e0e0;
		border-right: 1px solid #333;
		border-bottom: 1px solid #333;
		height: var(--data-row-height);
		font-weight: normal;
	}

	.records-cell.highlighted {
		background: #8f4f8f;
		color: #fff;
		font-weight: bold;
	}

	/* Responsive adjustments for landscape mode */
	@media (max-width: 1366px) and (orientation: landscape) {
		.record-status-panel {
			min-width: 14rem;
			font-size: 1.5rem;
		}

		.records-table-grid,
		.personal-records-grid {
			--col-lift: 3.3rem;
			--col-spacer: 0.5rem;
			--data-row-height: 1.9rem;
		}

		.records-category-header {
			font-size: 1.15rem;
		}

		.records-subheader,
		.records-federation-cell,
		.records-cell {
			font-size: 1.05rem;
		}
	}

	@media (max-width: 1280px) and (orientation: landscape) {
		.record-status-panel {
			min-width: 12rem;
			font-size: 1.3rem;
			padding: 0.6rem 1rem;
		}

		.records-table-grid,
		.personal-records-grid {
			--col-lift: 3.1rem;
			--col-spacer: 0.4rem;
			--data-row-height: 1.8rem;
		}

		.records-title-cell {
			font-size: 1.1rem;
		}

		.records-category-header {
			font-size: 1.1rem;
			padding: var(--header-primary-vpad) 0.1rem;
		}

		.records-subheader {
			font-size: 1rem;
			padding: var(--header-secondary-vpad) 0.1rem;
		}

		.records-federation-cell {
			font-size: 1rem;
			padding: 0.2rem 0.6rem;
		}

		.records-cell {
			font-size: 1rem;
			padding: 0.2rem;
		}
	}

	@media (max-width: 960px) and (orientation: landscape) {
		.records-section {
			padding: 0.8em 0 0 0;
		}

		.records-table-grid,
		.personal-records-grid {
			--col-lift: 2.0rem;
			--col-spacer: 0.2rem;
			--data-row-height: 1.3rem;
			--header-primary-height: 0.8rem;
			--header-secondary-height: 0.7rem;
			grid-template-columns: max-content repeat(var(--num-categories), var(--col-spacer) var(--col-lift) var(--col-lift) var(--col-lift));
		}

		.records-title-cell {
			font-size: 0.6rem;
			line-height: 0.85;
		}

		.records-category-header {
			font-size: 0.6rem;
			padding: 0.08rem 0.02rem;
			line-height: 0.85;
			min-height: 0;
			height: auto;
		}

		.records-subheader {
			font-size: 0.5rem;
			padding: 0.08rem 0.02rem;
			line-height: 0.85;
			min-height: 0;
			height: auto;
		}

		.records-federation-cell {
			font-size: 0.65rem;
			padding: 0.1rem 0.3rem;
		}

		.records-cell {
			font-size: 0.65rem;
			padding: 0.1rem;
		}
	}

	/* Portrait mode: keep records available as part of the vertical scroll flow. */
	@media (orientation: portrait) {
		.records-section {
			display: block;
			padding: 0.8em 0 0 0;
			max-width: 100%;
		}

		.records-table-grid,
		.personal-records-grid {
			--col-lift: 2.2rem;
			--col-spacer: 0.2rem;
			--data-row-height: 1.35rem;
			--header-primary-height: 0.9rem;
			--header-secondary-height: 0.75rem;
		}

		.records-title-cell {
			font-size: 0.65rem;
			line-height: 1;
		}

		.records-category-header {
			font-size: 0.65rem;
			padding: 0.08rem 0.02rem;
			line-height: 0.85;
			min-height: 0;
		}

		.records-subheader {
			font-size: 0.55rem;
			padding: 0.08rem 0.02rem;
			line-height: 0.85;
			min-height: 0;
		}

		.records-federation-cell {
			font-size: 0.65rem;
			padding: 0.1rem 0.3rem;
		}

		.records-cell {
			font-size: 0.65rem;
			padding: 0.1rem;
		}
	}
</style>
