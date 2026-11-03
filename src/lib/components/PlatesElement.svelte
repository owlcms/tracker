<script>
	/**
	 * PlatesElement - Barbell visualization component
	 * Port of owlcms PlatesElement.java
	 * 
	 * Displays a visual representation of weight plates loaded on a barbell
	 */
	
	export let weight = 0;           // Total weight to display
	export let barWeight = 20;       // Bar weight (20kg men, 15kg women)
	export let platform = null;      // Platform configuration with plate counts
	export let lightBar = false;     // Whether using a light bar
	export let threeD = false;       // Whether to render 3D plates and barbell

	// Reactive plate calculation
	$: plates = computePlates(weight, barWeight, platform, lightBar);
	$: sleeveMm = weight <= 150 ? 320 : weight <= 210 ? 350 : 420;
	$: console.log(`[PlatesElement] weight=${weight}, barWeight=${barWeight}, platform=${!!platform}, plates=${plates.length}`);

	function isWeightPlate(plate) {
		return !plate.class.startsWith('bar') && !plate.class.startsWith('C');
	}

	/**
	 * Compute which plates to display
	 * Matches owlcms PlatesElement.java logic exactly
	 */
	function computePlates(totalWeight, barWt, plat, isLightBar) {
		const result = [];
		
		if (!totalWeight || totalWeight <= 0 || !plat) {
			console.log(`[PlatesElement] Early return: totalWeight=${totalWeight}, plat=${!!plat}`);
			return result;
		}
		
		let remainingWeight = totalWeight;
		const nonBarWeight = totalWeight - barWt;
		
		if (nonBarWeight < 0) {
			return result;
		}
		
		const barStyle = getBarColor(barWt, isLightBar);

		// Add bar
		result.push({ class: 'bar', ...barStyle });
		result.push({ class: 'barInner', ...barStyle });
		
		remainingWeight -= barWt;
		
		// Check collar availability
		const collarAvailable = plat.nbC_2_5 || 0;
		const allowCollar = plat.useCollars !== undefined ? Boolean(plat.useCollars) : true;
		let useCollar = allowCollar && collarAvailable > 0 && remainingWeight >= 5;
		
		if (useCollar) {
			// Reserve weight for collar
			remainingWeight -= 5;
		}
		
		// Track if we've used any large plate
		let subtractedWeight = 0;
		
		// Large plates (in order of weight)
		subtractedWeight += addPlatesCalc(result, plat.nbL_25 || 0, 'L_25', 50, remainingWeight);
		remainingWeight -= subtractedWeight;
		
		let delta = addPlatesCalc(result, plat.nbL_20 || 0, 'L_20', 40, remainingWeight);
		subtractedWeight += delta;
		remainingWeight -= delta;
		
		delta = addPlatesCalc(result, plat.nbL_15 || 0, 'L_15', 30, remainingWeight);
		subtractedWeight += delta;
		remainingWeight -= delta;
		
		delta = addPlatesCalc(result, plat.nbL_10 || 0, 'L_10', 20, remainingWeight);
		subtractedWeight += delta;
		remainingWeight -= delta;
		
		// Only use L_5 if no larger plate used AND nonBarWeight >= 10
		if (subtractedWeight === 0 && (nonBarWeight - (useCollar ? 5 : 0)) >= 10) {
			delta = addPlatesCalc(result, plat.nbL_5 || 0, 'L_5', 10, remainingWeight);
			subtractedWeight += delta;
			remainingWeight -= delta;
		}
		
		// Only use L_2_5 if no larger plate used AND nonBarWeight >= 5
		if (subtractedWeight === 0 && (nonBarWeight - (useCollar ? 5 : 0)) >= 5) {
			delta = addPlatesCalc(result, plat.nbL_2_5 || 0, 'L_2_5', 5, remainingWeight);
			subtractedWeight += delta;
			remainingWeight -= delta;
		}
		
		// Small plates before collar
		delta = addPlatesCalc(result, plat.nbS_5 || 0, 'S_5', 10, remainingWeight);
		remainingWeight -= delta;
		
		delta = addPlatesCalc(result, plat.nbS_2_5 || 0, 'S_2_5', 5, remainingWeight);
		remainingWeight -= delta;
		
		// Add collar
		if (useCollar) {
			result.push({ class: 'C_2_5' });
		}
		
		// Remaining small plates after collar (only if there's remaining weight)
		if (remainingWeight >= 4) {
			delta = addPlatesCalc(result, plat.nbS_2 || 0, 'S_2', 4, remainingWeight);
			remainingWeight -= delta;
		}
		
		if (remainingWeight >= 3) {
			delta = addPlatesCalc(result, plat.nbS_1_5 || 0, 'S_1_5', 3, remainingWeight);
			remainingWeight -= delta;
		}
		
		if (remainingWeight >= 2) {
			delta = addPlatesCalc(result, plat.nbS_1 || 0, 'S_1', 2, remainingWeight);
			remainingWeight -= delta;
		}
		
		if (remainingWeight >= 1) {
			delta = addPlatesCalc(result, plat.nbS_0_5 || 0, 'S_0_5', 1, remainingWeight);
			remainingWeight -= delta;
		}
		
		// Add bar outer end
		result.push({ class: 'barOuter', ...barStyle });
		
		return result;
	}
	
	/**
	 * Add plates to the result array
	 * Returns weight subtracted
	 */
	function addPlatesCalc(result, available, plateClass, pairWeight, remaining) {
		let subtracted = 0;
		let count = available;
		
		while (count > 0 && remaining >= pairWeight) {
			result.push({ class: plateClass });
			remaining -= pairWeight;
			subtracted += pairWeight;
			count--;
		}
		
		return subtracted;
	}
	
	/**
	 * Get bar color based on weight (for light / non-standard bars)
	 */
	function getBarColor(barWt, isLightBar) {
		if (!isLightBar) return {};
		
		if (barWt === 5) return { barColor: 'purple', barTint: '#8a4baf' };
		if (barWt === 10) return { barColor: 'limegreen', barTint: '#3da65a' };
		if (barWt === 15) return { barColor: 'yellow', barTint: '#d8b238' };
		if (barWt === 20) return {};
		return { barColor: '#7a4b26', barTint: '#7a4b26' };
	}
</script>

<div class="plates-wrapper" class:threeD={threeD} aria-hidden="true">
	<plates-element
		class="plates-element loadChart dark"
		class:threeD={threeD}
		style="--sleeve-mm: {sleeveMm};"
	>
		{#each plates as plate, index}
			{#if plate.class === 'barOuter' && plates[index - 1]?.class !== 'barInner'}
				<label
					class="bore-hole"
					style={`--stack-order: ${index + 1};`}
				></label>
			{/if}
			<label
				class="plate-item {plate.class}"
				class:plate={isWeightPlate(plate)}
				style={`--stack-order: ${index + 1}; ${plate.barColor ? `background-color: ${plate.barColor};` : ''} ${plate.barTint ? `--bar-tint: ${plate.barTint};` : ''}`}
			></label>
		{/each}
	</plates-element>
</div>

<style>
	.plates-wrapper {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
	}

	.plates-wrapper.threeD {
		display: grid;
		place-items: center;
		container-type: size;
		overflow: hidden;
	}

	.plates-element {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		font-size: 2em; /* Scale up all em/ex based sizes proportionally */
	}
	
	.plate-item {
		margin: 2px;
	}
	
	/* Plate border styling */
	.plate {
		border-color: white;
		border-width: 1px;
		border-style: solid;
		border-radius: 0.5em;
		overflow: hidden;
	}
	
	/* Bar sections */
	.bar {
		height: 1.5ex;
		width: 2.5em;
		background-color: var(--bar-tint, grey);
	}
	
	.barInner {
		height: 4.5ex;
		width: 1em;
		background-color: var(--bar-tint, grey);
		border-radius: 0.2em;
	}
	
	.barOuter {
		height: 2.5ex;
		width: 1.5em;
		background-color: var(--bar-tint, grey);
	}

	.bore-hole {
		display: none;
	}
	
	/* Large plates (bumper plates) */
	.L_25 {
		height: 12em;
		width: 1.70em;
		background-color: red;
	}
	
	.L_20 {
		height: 12em;
		width: 1.60em;
		background-color: blue;
	}
	
	.L_15 {
		height: 12em;
		width: 1.50em;
		background-color: yellow;
	}
	
	.L_10 {
		height: 12em;
		width: 1.40em;
		background-color: green;
	}
	
	.L_5 {
		height: 12em;
		width: 1.30em;
		background-color: white;
	}
	
	.L_2_5 {
		height: 12em;
		width: 1.20em;
		background-color: red;
	}
	
	/* Collar */
	.C_2_5 {
		height: 5ex;
		width: 1.5em;
		background-color: black;
		border-color: white;
		border-width: 2px;
		border-style: solid;
		border-radius: 0.1em;
	}
	
	/* Small plates (change plates) */
	.S_5 {
		height: 7em;
		width: 0.65em;
		background-color: white;
	}
	
	.S_2_5 {
		height: 6em;
		width: 0.65em;
		background-color: red;
	}
	
	.S_2 {
		height: 5.5em;
		width: 0.65em;
		background-color: blue;
	}
	
	.S_1_5 {
		height: 5em;
		width: 0.65em;
		background-color: yellow;
	}
	
	.S_1 {
		height: 4.5em;
		width: 0.65em;
		background-color: green;
	}
	
	.S_0_5 {
		height: 4em;
		width: 0.65em;
		background-color: white;
	}

	/* === 3D Attempt Board Look === */

	.loadChart.threeD {
		--width-ratio: calc(0.28 + var(--sleeve-mm, 320) / 450);
		--diameter: min(100cqh, calc(100cqw / var(--width-ratio)));
		--face-aspect: 0.27;
		--label-scale-x: 0.55;
		--bar-diameter: calc(var(--diameter) * 32 / 450);
		--flange-diameter: calc(var(--diameter) * 84 / 450);
		--flange-width: calc(var(--diameter) * 30 / 450);
		--sleeve-diameter: calc(var(--diameter) * 54 / 450);
		--sleeve-length: calc(var(--diameter) * var(--sleeve-mm, 320) / 450);
		display: flex;
		align-items: center;
		justify-content: flex-start;
		width: calc(var(--diameter) * 0.18 + var(--flange-width) + var(--sleeve-length));
		height: 100%;
		box-sizing: border-box;
		font-size: 1rem;
	}

	.loadChart.threeD > * {
		position: relative;
		flex: 0 1 auto;
		min-width: 0;
		box-sizing: border-box;
		margin: 0;
	}

	.loadChart.threeD .plate {
		--size: 1;
		--mark-top: 0.102;
		--thickness: calc(39 / 450);
		--rx: calc(var(--diameter) * var(--size) * var(--face-aspect) * 0.5);
		--side-shading:
			linear-gradient(to left, rgba(255, 255, 255, 0.1) 0%, transparent 35%, rgba(0, 0, 0, 0.32) 100%),
			linear-gradient(to bottom,
				color-mix(in srgb, var(--plate-color) 72%, var(--plate-dark)) 0%,
				var(--plate-light) 18%,
				var(--plate-color) 42%,
				var(--plate-color) 62%,
				color-mix(in srgb, var(--plate-color) 45%, var(--plate-dark)) 82%,
				var(--plate-dark) 100%);
		z-index: var(--stack-order);
		width: calc(var(--diameter) * var(--thickness) + 2 * var(--rx));
		height: calc(var(--diameter) * var(--size));
		margin-block: 0;
		margin-inline: calc(-1 * var(--rx));
		border: none;
		border-radius: var(--rx) / 50%;
		background: var(--side-shading);
		box-shadow: inset 2px 0 4px rgba(0, 0, 0, 0.55);
		overflow: visible;
	}

	.loadChart.threeD .plate::before {
		content: var(--plate-label);
		position: absolute;
		left: calc(100% - var(--rx));
		top: 0;
		box-sizing: border-box;
		height: 100%;
		aspect-ratio: calc(var(--face-aspect) / var(--label-scale-x));
		padding-top: calc(var(--diameter) * var(--size) * var(--mark-top));
		transform: translateX(-50%) scaleX(var(--label-scale-x));
		border-radius: 50%;
		background:
			radial-gradient(closest-side, transparent 84%, rgba(255, 255, 255, 0.12) 85%, rgba(0, 0, 0, 0.22) 87%, transparent 88%),
			radial-gradient(ellipse at 38% 28%, var(--plate-light) 0%, var(--plate-color) 52%, var(--plate-dark) 100%);
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.5), inset 2px 0 4px rgba(255, 255, 255, 0.14);
		text-align: center;
		color: var(--mark-color, rgba(255, 255, 255, 0.78));
		font-family: Arial, sans-serif;
		font-size: calc(var(--diameter) * var(--size) * 0.095);
		font-weight: 700;
		line-height: 0.9;
		text-shadow: var(--mark-shadow, 0 1px 2px rgba(0, 0, 0, 0.75));
	}

	.loadChart.threeD .plate::after {
		content: 'KG';
		position: absolute;
		left: calc(100% - var(--rx));
		top: calc(var(--diameter) * var(--size) * (var(--mark-top) + 0.084));
		transform: translateX(-50%) scaleX(var(--label-scale-x));
		text-align: center;
		color: var(--mark-color, rgba(255, 255, 255, 0.78));
		font-family: Arial, sans-serif;
		font-size: calc(var(--diameter) * var(--size) * 0.04);
		font-weight: 700;
		line-height: 0.9;
		letter-spacing: 0.04em;
		text-shadow: var(--mark-shadow, 0 1px 2px rgba(0, 0, 0, 0.75));
		pointer-events: none;
	}

	.loadChart.threeD .bar,
	.loadChart.threeD .barInner,
	.loadChart.threeD .barOuter {
		--bar-color: var(--bar-tint, #aab4b6);
		--bar-light: color-mix(in srgb, var(--bar-color) 42%, #ffffff);
		--bar-mid-dark: color-mix(in srgb, var(--bar-color) 64%, #1e2527);
		--bar-edge: color-mix(in srgb, var(--bar-color) 56%, #252d30);
		--bar-shading: linear-gradient(to bottom,
			var(--bar-edge) 0%,
			var(--bar-light) 22%,
			color-mix(in srgb, var(--bar-color) 20%, #ffffff) 36%,
			var(--bar-color) 52%,
			var(--bar-mid-dark) 68%,
			color-mix(in srgb, var(--bar-color) 75%, #e6ecea) 84%,
			var(--bar-edge) 100%);
	}

	.loadChart.threeD .bar {
		--rx: calc(var(--bar-diameter) * 0.22);
		flex: 0 0 calc(var(--diameter) * 0.18 + 2 * var(--rx));
		width: calc(var(--diameter) * 0.18 + 2 * var(--rx));
		height: var(--bar-diameter);
		margin-inline: calc(-1 * var(--rx));
		border-radius: calc(var(--bar-diameter) * 0.36) / 50%;
		background:
			linear-gradient(to right, rgba(0, 0, 0, 0.35) 0%, rgba(255, 255, 255, 0.18) 6%, transparent 16%),
			var(--bar-shading);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.65), inset 1px 0 2px rgba(0, 0, 0, 0.45);
	}

	.loadChart.threeD .barInner {
		--rx: calc(var(--flange-diameter) * var(--face-aspect) * 0.5);
		z-index: var(--stack-order);
		flex: 0 0 calc(var(--flange-width) + 2 * var(--rx));
		width: calc(var(--flange-width) + 2 * var(--rx));
		height: var(--flange-diameter);
		margin-inline: calc(-1 * var(--rx));
		border-radius: var(--rx) / 50%;
		background:
			linear-gradient(to left, rgba(255, 255, 255, 0.14) 0%, transparent 35%, rgba(0, 0, 0, 0.32) 100%),
			var(--bar-shading);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.65), inset 2px 0 3px rgba(0, 0, 0, 0.45);
	}

	.loadChart.threeD .barInner::after {
		content: '';
		position: absolute;
		left: calc(100% - var(--rx));
		top: 0;
		height: 100%;
		aspect-ratio: var(--face-aspect);
		transform: translateX(-50%);
		border-radius: 50%;
		background: radial-gradient(ellipse at 36% 32%, var(--bar-light) 0%, var(--bar-color) 55%, var(--bar-mid-dark) 100%);
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.5), inset 2px 0 4px rgba(255, 255, 255, 0.14);
	}

	.loadChart.threeD .barOuter {
		--rx: calc(var(--sleeve-diameter) * var(--face-aspect) * 0.5);
		z-index: 1000;
		flex: 1 0 calc(var(--diameter) * 0.04 + 2 * var(--rx));
		width: auto;
		height: var(--sleeve-diameter);
		margin-inline: calc(-1 * var(--rx));
		border-radius: var(--rx) / 50%;
		background:
			linear-gradient(to right, rgba(0, 0, 0, 0.32) 0%, transparent 10%),
			linear-gradient(to left, rgba(0, 0, 0, 0.3) 0%, rgba(255, 255, 255, 0.16) 10%, transparent 28%),
			var(--bar-shading);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.65), inset 2px 0 3px rgba(0, 0, 0, 0.38);
	}

	.loadChart.threeD .barOuter::before {
		content: '';
		position: absolute;
		left: calc(100% - var(--rx));
		top: 0;
		height: 100%;
		aspect-ratio: var(--face-aspect);
		transform: translateX(-50%);
		border-radius: 50%;
		background: radial-gradient(ellipse at 35% 32%, #ffffff 0%, var(--bar-light) 28%, var(--bar-color) 62%, var(--bar-mid-dark) 100%);
		box-shadow: -2px 0 3px rgba(0, 0, 0, 0.45), inset 0 0 0 1.5px rgba(25, 32, 34, 0.75), inset 2px 0 4px rgba(255, 255, 255, 0.45);
	}

	.loadChart.threeD .barOuter::after {
		content: '';
		position: absolute;
		left: calc(100% - var(--rx));
		top: 16%;
		height: 68%;
		aspect-ratio: var(--face-aspect);
		transform: translateX(-50%);
		border-radius: 50%;
		border: 1px solid rgba(40, 48, 50, 0.45);
		background: radial-gradient(ellipse at 40% 38%, var(--bar-light) 0%, var(--bar-color) 65%, var(--bar-mid-dark) 100%);
	}

	.loadChart.threeD .bore-hole {
		--bore-diameter: calc(var(--diameter) * 63 / 450);
		display: block;
		position: relative;
		flex: 0 0 0;
		width: 0;
		height: var(--bore-diameter);
		z-index: var(--stack-order);
	}

	.loadChart.threeD .bore-hole::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		box-sizing: border-box;
		height: 100%;
		aspect-ratio: var(--face-aspect);
		transform: translateX(-50%);
		border-radius: 50%;
		background: radial-gradient(ellipse at 62% 55%, #1d2223 0%, #090b0c 68%, #020303 100%);
		border: 1px solid rgba(255, 255, 255, 0.18);
		box-shadow:
			inset 2px 0 3px rgba(0, 0, 0, 0.9),
			0 0 2px rgba(0, 0, 0, 0.65);
	}

	.loadChart.threeD .C_2_5 {
		--size: calc(120 / 450);
		--thickness: calc(60 / 450);
		--rx: calc(var(--diameter) * var(--size) * var(--face-aspect) * 0.5);
		--plate-color: #5b6463;
		--plate-light: #9ea8a6;
		--plate-dark: #232929;
		--side-shading:
			linear-gradient(to left, rgba(255, 255, 255, 0.12) 0%, transparent 35%, rgba(0, 0, 0, 0.34) 100%),
			linear-gradient(to bottom,
				color-mix(in srgb, var(--plate-color) 72%, var(--plate-dark)) 0%,
				var(--plate-light) 18%,
				var(--plate-color) 42%,
				var(--plate-color) 62%,
				color-mix(in srgb, var(--plate-color) 45%, var(--plate-dark)) 82%,
				var(--plate-dark) 100%);
		z-index: var(--stack-order);
		width: calc(var(--diameter) * var(--thickness) + 2 * var(--rx));
		height: calc(var(--diameter) * var(--size));
		margin-block: 0;
		margin-inline: calc(-1 * var(--rx));
		border: none;
		border-radius: var(--rx) / 50%;
		background: var(--side-shading);
		box-shadow: inset 2px 0 4px rgba(0, 0, 0, 0.55);
	}

	.loadChart.threeD .C_2_5::before {
		content: '';
		position: absolute;
		left: calc(100% - var(--rx));
		top: 0;
		height: 100%;
		aspect-ratio: var(--face-aspect);
		transform: translateX(-50%);
		border-radius: 50%;
		background: radial-gradient(ellipse at 38% 28%, var(--plate-light) 0%, var(--plate-color) 52%, var(--plate-dark) 100%);
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.5), inset 2px 0 4px rgba(255, 255, 255, 0.14);
	}

	.loadChart.threeD .C_2_5::after {
		content: '';
		position: absolute;
		left: calc(100% - var(--rx));
		top: 23%;
		height: 54%;
		aspect-ratio: var(--face-aspect);
		transform: translateX(-50%);
		border-radius: 50%;
		border: 1px solid rgba(255, 255, 255, 0.14);
		box-shadow: inset 1px 0 2px rgba(0, 0, 0, 0.3);
	}

	.loadChart.threeD :is(.L_25, .L_2_5, .S_2_5) {
		--plate-color: #9d2832;
		--plate-light: #d65b60;
		--plate-dark: #4a101a;
	}

	.loadChart.threeD :is(.L_20, .S_2) {
		--plate-color: #205680;
		--plate-light: #5e95bc;
		--plate-dark: #102b46;
	}

	.loadChart.threeD :is(.L_15, .S_1_5) {
		--plate-color: #b39320;
		--plate-light: #f0d563;
		--plate-dark: #5c4a0b;
		--mark-color: #29230d;
		--mark-shadow: 0 1px 1px rgba(255, 255, 255, 0.4);
	}

	.loadChart.threeD :is(.L_10, .S_1) {
		--plate-color: #286541;
		--plate-light: #63a879;
		--plate-dark: #123620;
	}

	.loadChart.threeD :is(.L_5, .S_5, .S_0_5) {
		--plate-color: #d6dcda;
		--plate-light: #ffffff;
		--plate-dark: #727d7b;
		--mark-color: #303837;
		--mark-shadow: 0 1px 1px rgba(255, 255, 255, 0.6);
	}

	.loadChart.threeD :is(.S_5, .S_2_5, .S_2, .S_1_5, .S_1, .S_0_5) {
		--mark-top: 0.09;
	}

	.loadChart.threeD .L_25 { --thickness: calc(58 / 450); --plate-label: '25'; }
	.loadChart.threeD .L_20 { --thickness: calc(50 / 450); --plate-label: '20'; }
	.loadChart.threeD .L_15 { --thickness: calc(39 / 450); --plate-label: '15'; }
	.loadChart.threeD .L_10 { --thickness: calc(35 / 450); --plate-label: '10'; }
	.loadChart.threeD .L_5 { --thickness: calc(26 / 450); --plate-label: '5'; }
	.loadChart.threeD .L_2_5 { --thickness: calc(19 / 450); --plate-label: '2.5'; }
	.loadChart.threeD .S_5 { --size: 0.58; --thickness: calc(26 / 450); --plate-label: '5'; }
	.loadChart.threeD .S_2_5 { --size: 0.50; --thickness: calc(19 / 450); --plate-label: '2.5'; }
	.loadChart.threeD .S_2 { --size: 0.46; --thickness: calc(19 / 450); --plate-label: '2'; }
	.loadChart.threeD .S_1_5 { --size: 0.42; --thickness: calc(19 / 450); --plate-label: '1.5'; }
	.loadChart.threeD .S_1 { --size: 0.38; --thickness: calc(19 / 450); --plate-label: '1'; }
	.loadChart.threeD .S_0_5 { --size: 0.34; --thickness: calc(12.5 / 450); --plate-label: '0.5'; }
</style>
