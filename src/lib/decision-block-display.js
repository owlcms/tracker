/**
 * Browser- and server-safe view model for the scoreboard decision block bar.
 *
 * Mirrors OWLCMS Results.js (.decisionSection visibility rules), Results.java
 * (renderJuryVerdict), and JuryRejectionReasons.java, with no individual jury/panel
 * vote circles and no down signal.
 */

const BREAK_MODES = new Set([
	'INTERRUPTION',
	'INTRO_COUNTDOWN',
	'LIFT_COUNTDOWN',
	'LIFT_COUNTDOWN_CEREMONY',
	'SESSION_DONE',
	'CEREMONY'
]);

export function isDecisionBlockBreakMode(mode) {
	return BREAK_MODES.has(String(mode || '').toUpperCase());
}

/**
 * Format verdict text matching OWLCMS Results.renderJuryVerdict() + JuryRejectionReasons.label().
 */
export function formatVerdictText(verdict, labels = {}) {
	if (!verdict || typeof verdict.good !== 'boolean') return '';
	const verdictKey = verdict.good ? 'JuryDialog.GoodLiftLabel' : 'JuryDialog.BadLiftLabel';
	const verdictLabel = labels?.[verdictKey] || verdictKey;
	const ruleCode = verdict.ruleCode;
	let rule = null;
	if (ruleCode === 0) {
		rule = labels?.['Jury.StandsAsCalled'] || 'Jury.StandsAsCalled';
	} else if (ruleCode !== null && ruleCode !== undefined && ruleCode >= 1 && ruleCode <= 17) {
		const ruleKey = `Jury.incorrect.${ruleCode}`;
		const ruleText = labels?.[ruleKey];
		rule = ruleText ? `${ruleCode} - ${ruleText}` : String(ruleCode);
	}
	return rule ? `${verdictLabel} \u2013 ${rule}` : verdictLabel;
}

/**
 * Format count-up review stopwatch duration as M:SS.
 */
export function formatStopwatch(elapsedMs) {
	const totalSeconds = Math.max(0, Math.floor((elapsedMs || 0) / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Compute all visual slots of DecisionBlockBar matching OWLCMS Results.js.
 */
export function computeDecisionBlockView({
	decisionBlock = null,
	mode = 'WAIT',
	currentAttempt = null,
	currentAthleteAgeGroups = '',
	breakText = '',
	timerData = null,
	breakTimerData = null,
	labels = {},
	showStopwatch = false,
	showAgeGroups = false,
	now = Date.now(),
	serverClockOffsetMs = 0
} = {}) {
	const upperMode = String(mode || 'WAIT').toUpperCase();
	const sectionVisible = upperMode !== 'WAIT';
	const isBreak = isDecisionBlockBreakMode(upperMode);
	const effectiveNow = now + (Number.isFinite(serverClockOffsetMs) ? serverClockOffsetMs : 0);

	const rawState = decisionBlock?.state || 'ready';
	const rawVerdict = decisionBlock?.verdict || null;
	const rawExpiresAt = decisionBlock?.expiresAt ?? null;
	const hasHold = (rawState === 'decision' || (rawState === 'deliberation' && rawVerdict !== null))
		&& rawExpiresAt !== null;
	const expired = hasHold && effectiveNow >= rawExpiresAt;

	const effectiveState = expired ? 'ready' : rawState;
	const decisionActive = effectiveState === 'decision' || effectiveState === 'deliberation';
	const verdict = effectiveState === 'deliberation' ? rawVerdict : null;

	let juryMessage = '';
	if (effectiveState === 'deliberation') {
		if (verdict) {
			juryMessage = formatVerdictText(verdict, labels);
		} else if (decisionBlock?.reviewLabelKey) {
			juryMessage = labels?.[decisionBlock.reviewLabelKey] || decisionBlock.reviewLabelKey;
		}
	}

	const reviewStartMillis = (effectiveState === 'deliberation' && !verdict)
		? (decisionBlock?.reviewStartMillis ?? null)
		: null;
	const stopwatchVisible = Boolean(
		showStopwatch && effectiveState === 'deliberation' && !verdict && juryMessage
		&& upperMode === 'INTERRUPTION' && reviewStartMillis !== null
	);
	const stopwatchText = stopwatchVisible ? formatStopwatch(effectiveNow - reviewStartMillis) : '';

	const breakCountdownVisible = Boolean(
		!decisionActive && isBreak && breakTimerData?.state === 'running'
		&& breakTimerData?.visible === true && !breakTimerData?.displayText
	);
	const athleteTimerVisible = Boolean(
		!decisionActive && !isBreak && upperMode === 'CURRENT_ATHLETE' && timerData?.visible === true
	);
	const timerSlotVisible = decisionActive
		? stopwatchVisible
		: (isBreak ? breakCountdownVisible : athleteTimerVisible);

	const breakDescriptionVisible = !decisionActive && isBreak && Boolean(breakText);
	const rawStartNumber = decisionActive
		? (decisionBlock?.athlete?.startNumber || '')
		: (currentAttempt?.startNumber !== undefined && currentAttempt?.startNumber !== null
			? String(currentAttempt.startNumber) : '');
	const displayName = breakDescriptionVisible
		? breakText
		: (decisionActive ? (decisionBlock?.athlete?.fullName || '') : (currentAttempt?.fullName || ''));
	const rawAgeGroups = decisionActive
		? (decisionBlock?.athlete?.ageGroups || '')
		: (currentAthleteAgeGroups || '');
	const ageGroups = (!breakDescriptionVisible && showAgeGroups && rawAgeGroups) ? rawAgeGroups : '';

	const showStartNumber = !breakDescriptionVisible && Boolean(rawStartNumber);
	const athleteSlotVisible = decisionActive
		|| (upperMode === 'CURRENT_ATHLETE' && Boolean(displayName))
		|| breakDescriptionVisible;

	const showRefLights = decisionActive && Boolean(decisionBlock?.refLights);
	const refLights = showRefLights ? decisionBlock.refLights : null;
	const remainingHoldMs = (decisionActive && hasHold && !expired)
		? Math.max(0, rawExpiresAt - effectiveNow)
		: null;

	return {
		sectionVisible,
		effectiveState,
		decisionActive,
		timerSlotVisible,
		athleteTimerVisible,
		breakCountdownVisible,
		stopwatchVisible,
		stopwatchText,
		athleteSlotVisible,
		breakDescriptionVisible,
		showStartNumber,
		startNumber: rawStartNumber,
		displayName,
		ageGroups,
		juryMessage,
		showRefLights,
		refLights,
		remainingHoldMs
	};
}
