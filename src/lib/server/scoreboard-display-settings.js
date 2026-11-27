/**
 * Column settings for the standard scoreboards, from the OWLCMS update and the scoreboard options.
 *
 * OWLCMS 69.1 adds `age`, `medalKgTop` and `medalKgUp` to each athlete's displayInfo; OWLCMS 69.0 sends none
 * of them. Columns that depend on these fields are shown only when the athletes carry them, so the same
 * tracker works with both versions.
 */

function hasValue(value) {
	return value !== undefined && value !== null;
}

function isEnabled(option, owlcmsSwitch) {
	return option !== undefined ? option === true : owlcmsSwitch === 'true';
}

export function extractDisplaySettings(fopUpdate, athletes = [], leaders = [], options = {}) {
	const entries = [
		...(Array.isArray(athletes) ? athletes : []),
		...(Array.isArray(leaders) ? leaders : [])
	].filter((entry) => entry && !entry.isSpacer);
	const hasMedalRank = entries.some((entry) => hasValue(entry.medalRank) && entry.medalRank !== '');
	const hasAge = entries.some((entry) => hasValue(entry.age));
	const hasKgDifferentials = entries.some((entry) => hasValue(entry.medalKgTop) || hasValue(entry.medalKgUp));
	const showMedalScore = fopUpdate?.showMedalScore === 'true';
	const showKgDifferentials = showMedalScore && hasKgDifferentials;

	return {
		showTotalRank: fopUpdate?.showTotalRank === 'true',
		showSinclair: fopUpdate?.showSinclair === 'true',
		showLiftRanks: fopUpdate?.showLiftRanks === 'true',
		showSinclairRank: fopUpdate?.showSinclairRank === 'true',
		showMedalScore,
		medalScoringName: fopUpdate?.medalScoringName || '',
		showAge: showMedalScore && hasAge,
		showMedalKgTop: showKgDifferentials && isEnabled(options?.showKgLeader, fopUpdate?.showKgLeader),
		showMedalKgUp: showKgDifferentials && isEnabled(options?.showKgDelta, fopUpdate?.showKgDelta),
		hasMedalRank
	};
}
