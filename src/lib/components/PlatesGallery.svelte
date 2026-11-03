<script>
	import PlatesElement from './PlatesElement.svelte';

	export let initialThreeD = true;

	const presets = [20, 25, 35, 55, 85, 105, 135, 155, 205, 225, 255];
	const barShowcases = [
		{ barWeight: 5, name: '5 kg bar (purple)' },
		{ barWeight: 7, name: '7 kg non-standard bar (bronze)' },
		{ barWeight: 10, name: '10 kg bar (green)' },
		{ barWeight: 15, name: '15 kg bar (gold)' },
		{ barWeight: 20, name: '20 kg bar (steel)' }
	];

	let weight = 135;
	let barWeight = 20;
	let lightBar = true;
	let useCollar = true;
	let smallPlateAfterCollar = false;
	let gallery = true;
	let showAllBars = false;
	let threeD = initialThreeD;

	function displayWeight(baseWeight, addSmallPlate) {
		return addSmallPlate && baseWeight % 5 === 0 ? baseWeight + 2 : baseWeight;
	}

	$: effectiveWeight = displayWeight(weight, smallPlateAfterCollar);
	$: galleryWeights = [
		barWeight,
		...presets.filter((preset) => preset > barWeight).map((preset) => displayWeight(preset, smallPlateAfterCollar))
	];

	$: platform = {
		nbC_2_5: useCollar ? 1 : 0,
		nbL_25: 10,
		nbL_20: 10,
		nbL_15: 10,
		nbL_10: 10,
		nbL_5: 10,
		nbL_2_5: 10,
		nbS_5: 10,
		nbS_2_5: 10,
		nbS_2: 10,
		nbS_1_5: 10,
		nbS_1: 10,
		nbS_0_5: 10
	};
</script>

<div class="plates-gallery-root">
	<section class="controls">
		<label>
			Weight
			<input type="number" min="0" step="1" bind:value={weight} />
		</label>

		<label>
			Bar
			<select bind:value={barWeight}>
				<option value={20}>20 kg</option>
				<option value={15}>15 kg</option>
				<option value={10}>10 kg</option>
				<option value={7}>7 kg</option>
				<option value={5}>5 kg</option>
			</select>
		</label>

		<label class="check">
			<input type="checkbox" bind:checked={useCollar} />
			Collars
		</label>

		<label class="check">
			<input type="checkbox" bind:checked={lightBar} />
			Colored light bar
		</label>

		<label class="check">
			<input type="checkbox" bind:checked={smallPlateAfterCollar} />
			Small plate after collar
		</label>

		<label class="check">
			<input type="checkbox" bind:checked={gallery} />
			Gallery
		</label>

		<label class="check">
			<input type="checkbox" bind:checked={showAllBars} />
			All bars (5/7/10/15/20)
		</label>

		<label class="check">
			<input type="checkbox" bind:checked={threeD} />
			3DattemptBoard
		</label>

		<div class="presets">
			{#each presets as preset}
				<button
					type="button"
					class:active={!gallery && !showAllBars && weight === preset}
					on:click={() => {
						weight = preset;
						gallery = false;
						showAllBars = false;
					}}
				>
					{preset}
				</button>
			{/each}
		</div>
	</section>

	{#if showAllBars}
		<section class="gallery bars-gallery">
			{#each barShowcases as b}
				{@const emptyW = b.barWeight}
				{@const loadedW = displayWeight(b.barWeight + 35, smallPlateAfterCollar)}
				{@const isColored = b.lightBar !== undefined ? b.lightBar : true}
				<div class="gallery-card">
					<div class="gallery-label">{b.name} — empty ({emptyW} kg)</div>
					<div class="gallery-chart">
						<PlatesElement weight={emptyW} barWeight={b.barWeight} {platform} lightBar={isColored} {threeD} />
					</div>
				</div>
				<div class="gallery-card">
					<div class="gallery-label">{b.name} — loaded ({loadedW} kg)</div>
					<div class="gallery-chart">
						<PlatesElement weight={loadedW} barWeight={b.barWeight} {platform} lightBar={isColored} {threeD} />
					</div>
				</div>
			{/each}
		</section>
	{:else if gallery}
		<section class="gallery">
			{#each galleryWeights as w, idx}
				<div class="gallery-card">
					<div class="gallery-label">{w} kg{idx === 0 ? ' (empty bar)' : ''}</div>
					<div class="gallery-chart">
						<PlatesElement weight={w} {barWeight} {platform} {lightBar} {threeD} />
					</div>
				</div>
			{/each}
		</section>
	{:else}
		<section class="preview">
			<div class="chart">
				<PlatesElement weight={effectiveWeight} {barWeight} {platform} {lightBar} {threeD} />
			</div>
		</section>
	{/if}
</div>

<style>
	.plates-gallery-root {
		display: grid;
		grid-template-rows: auto 1fr;
		width: 100%;
		height: 100%;
		background: #050505;
		color: #eee;
		font-family: system-ui, sans-serif;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		background: #181818;
		border-bottom: 1px solid #3a3a3a;
	}

	label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
	}

	input,
	select,
	button {
		padding: 0.35rem 0.55rem;
		color: #eee;
		background: #292929;
		border: 1px solid #555;
		border-radius: 0.25rem;
	}

	input[type='number'] {
		width: 6rem;
	}

	.check {
		white-space: nowrap;
	}

	.presets {
		display: flex;
		gap: 0.35rem;
		margin-left: auto;
	}

	button {
		cursor: pointer;
	}

	button.active {
		background: #235a84;
		border-color: #73b4e5;
	}

	.preview {
		display: grid;
		place-items: center;
		min-height: 0;
	}

	.chart {
		width: 28.2vw;
		height: 45vh;
		min-width: 480px;
		min-height: 360px;
		outline: 1px dashed #262626;
	}

	.gallery {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		grid-auto-rows: minmax(0, 1fr);
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		min-height: 0;
		overflow: auto;
	}

	.bars-gallery {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.bars-gallery .gallery-chart {
		min-height: 110px;
	}

	.gallery-card {
		position: relative;
		display: grid;
		grid-template-rows: auto 1fr;
		min-height: 0;
		background: #0a0a0a;
		border: 1px solid #242424;
		border-radius: 0.35rem;
		padding: 0.35rem 0.5rem;
	}

	.gallery-label {
		font-size: 1rem;
		font-weight: 700;
		color: #7ee7ff;
	}

	.gallery-chart {
		width: 100%;
		height: 100%;
		min-height: 220px;
	}
</style>
