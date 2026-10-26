/**
 * Attempt Board - jury and adjudication display rules (browser and server safe, no imports)
 *
 * decisionState is computed by OWLCMS (DecisionElementState); nothing here re-derives the state machine.
 * These helpers only choose what to show: option resolution, review label, and the Good Lift / No Lift card.
 */

export const DEFAULT_CARD_SECONDS = 5;

export const JURY_LABEL_KEYS = [
	'JuryNotification.Reversal',
	'JuryNotification.Confirmed',
	'JuryDialog.GoodLiftLabel',
	'JuryDialog.BadLiftLabel',
	'Scoreboard.NewRecord',
	'AttemptBoard_lift_attempt_number',
	'AttemptBoard_lift.SNATCH',
	'AttemptBoard_lift.CLEANJERK',
	'Snatch_number',
	'C_and_J_number',
	...Array.from({ length: 17 }, (_, i) => `Jury.incorrect.${i + 1}`)
];

/**
 * "show jury votes" option: true/false force the choice, anything else follows the OWLCMS switch
 * (JURY_DECISIONS_ON_ATTEMPT_BOARD, sent as juryDecisionsOnAttemptBoard).
 */
export function resolveShowJuryVotes(value, displayDefaults) {
	if (value === true || value === 'true') return true;
	if (value === false || value === 'false') return false;
	return displayDefaults?.juryDecisionsOnAttemptBoard === true;
}

/** card duration option, in seconds; 0 turns the card off */
export function resolveCardSeconds(value) {
	if (value === undefined || value === null || value === '') return DEFAULT_CARD_SECONDS;
	const seconds = Number(value);
	return Number.isFinite(seconds) && seconds >= 0 ? seconds : DEFAULT_CARD_SECONDS;
}

/** translation key of the review label for a decisionState, null when there is no review */
export function reviewLabelKey(decisionState) {
	const review = decisionState?.review;
	if (!review || review === 'none') return null;
	if (review === 'challenge') return 'PublicMsg.CHALLENGE';
	return decisionState.panelReview ? 'PublicMsg.AdjudicationPanelReview' : 'PublicMsg.JuryDeliberation';
}

export function isJuryBreak(breakType) {
	return breakType === 'JURY' || breakType === 'CHALLENGE';
}

/**
 * The decision area is drawn from decisionState: while lifting when OWLCMS shows it, and during a jury or
 * challenge break when a review vote is open or the cells are shown.
 */
export function isDecisionAreaShown(decisionState, { isCurrentAthlete, isBreak, breakType }) {
	if (!decisionState) return false;
	if (isCurrentAthlete) return decisionState.visible === true;
	return Boolean(isBreak && isJuryBreak(breakType) && (decisionState.reviewVoteOpen === true || decisionState.visible === true));
}

const LEGACY_CELLS = { good: 'white', bad: 'red' };

/**
 * What the decision area shows. With decisionState (OWLCMS 69) the cells are taken as sent; without it (older
 * OWLCMS) the legacy referee fields are shown while lifting, exactly as before.
 *
 * @returns {{shown: boolean, down: boolean, singleRef: boolean, refs: string[], jury: string[], showJuryRow: boolean}}
 */
export function buildDecisionView(decision, { isCurrentAthlete, isBreak, breakType, showDecisions, showJuryVotes }) {
	const decisionState = decision?.decisionState || null;
	let view;
	if (decisionState) {
		const down = decisionState.down === true;
		const jury = showJuryVotes && Array.isArray(decisionState.jury) ? decisionState.jury : [];
		view = {
			shown: isDecisionAreaShown(decisionState, { isCurrentAthlete, isBreak, breakType }),
			down,
			singleRef: decisionState.singleRef === true,
			refs: Array.isArray(decisionState.refs) ? decisionState.refs : ['empty', 'empty', 'empty'],
			jury,
			showJuryRow: !down && jury.length > 0
		};
	} else {
		view = {
			shown: Boolean(isCurrentAthlete && decision?.visible),
			down: Boolean(decision?.down && !decision?.ref1 && !decision?.ref2 && !decision?.ref3),
			singleRef: Boolean(decision?.isSingleReferee),
			refs: [decision?.ref1, decision?.ref2, decision?.ref3].map((value) => LEGACY_CELLS[value] || 'empty'),
			jury: [],
			showJuryRow: false
		};
	}
	view.shown = view.shown && Boolean(showDecisions);
	return view;
}

/** pick the translated texts needed by the card from a translation map */
export function buildJuryLabels(translations) {
	const labels = {};
	for (const key of JURY_LABEL_KEYS) {
		if (translations?.[key]) labels[key] = translations[key];
	}
	return labels;
}

function format(template, ...args) {
	return String(template).replace(/\{(\d+)\}/g, (match, index) => (args[index] ?? match));
}

function formatAttempt(adjudication, labels) {
	const number = adjudication.attemptNumber;
	if (!number) return '';
	const snatch = String(adjudication.liftTypeKey || '').toUpperCase() === 'SNATCH';
	const lift = labels?.[snatch ? 'AttemptBoard_lift.SNATCH' : 'AttemptBoard_lift.CLEANJERK'];
	const template = labels?.AttemptBoard_lift_attempt_number;
	if (template && lift) return format(template, number, lift);
	const legacy = labels?.[snatch ? 'Snatch_number' : 'C_and_J_number'];
	if (legacy) return format(legacy, number);
	return `${snatch ? 'Snatch' : 'C&J'} #${number}`;
}

/**
 * Card content for an adjudicationDecision, null when the board must not show it
 * (Speaker-only notification, or no Good Lift / No Lift outcome).
 */
export function buildAdjudicationCard(adjudication, labels, athleteName) {
	if (!adjudication || adjudication.waitForAnnouncer === true || typeof adjudication.decision !== 'boolean') {
		return null;
	}
	const success = adjudication.decision;
	let status = '';
	if (adjudication.reversal === true) status = labels?.['JuryNotification.Reversal'] || 'JuryNotification.Reversal';
	else if (adjudication.reversal === false) status = labels?.['JuryNotification.Confirmed'] || 'JuryNotification.Confirmed';

	let rule = '';
	if (!success && adjudication.ruleCode !== null && adjudication.ruleCode !== undefined) {
		const text = labels?.[`Jury.incorrect.${adjudication.ruleCode}`];
		rule = text ? `${adjudication.ruleCode} - ${text}` : String(adjudication.ruleCode);
	}

	// a Good Lift that makes a record says so instead of Good Lift, as on the OWLCMS attempt board
	let decision;
	if (!success) decision = labels?.['JuryDialog.BadLiftLabel'] || 'JuryDialog.BadLiftLabel';
	else if (adjudication.newRecord === true) decision = labels?.['Scoreboard.NewRecord'] || 'Scoreboard.NewRecord';
	else decision = labels?.['JuryDialog.GoodLiftLabel'] || 'JuryDialog.GoodLiftLabel';

	return {
		success,
		status,
		decision,
		athlete: athleteName || '',
		attempt: formatAttempt(adjudication, labels),
		rule
	};
}

/** identity of a jury decision: the time tracker-core received it, or its content when that is missing */
export function adjudicationKey(adjudication, receivedAt) {
	if (!adjudication) return null;
	return receivedAt ? String(receivedAt) : JSON.stringify(adjudication);
}

/**
 * Latch the jury card. A later message (RESET, update) no longer carries the adjudicationDecision, so the card
 * is remembered by key and shown for durationMs. ageMs is how long ago OWLCMS' decision reached the tracker
 * (0 for a live message), so that a page opened during the card only shows the remaining time.
 *
 * @returns {{key: string, card: Object|null, expiresAt: number}|null} the new latch; the same object when unchanged
 */
export function latchAdjudicationCard(latch, { adjudication, receivedAt, ageMs = 0, labels, athleteName, durationMs, now }) {
	const key = adjudicationKey(adjudication, receivedAt);
	if (!key || latch?.key === key) return latch ?? null;
	const card = durationMs > 0 ? buildAdjudicationCard(adjudication, labels, athleteName) : null;
	return { key, card, expiresAt: now - Math.max(0, ageMs) + durationMs };
}

export function isCardVisible(latch, now) {
	return Boolean(latch?.card) && now < latch.expiresAt;
}
