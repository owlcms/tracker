import { describe, expect, it } from 'vitest';

import {
	buildAdjudicationCard,
	buildDecisionView,
	buildJuryLabels,
	isCardVisible,
	isDecisionAreaShown,
	latchAdjudicationCard,
	resolveCardSeconds,
	resolveShowJuryVotes,
	reviewLabelKey
} from '../decision-display.js';

const labels = {
	'JuryNotification.Reversal': 'Jury REVERSAL',
	'JuryNotification.Confirmed': 'Jury Confirmation',
	'JuryDialog.GoodLiftLabel': 'Good Lift',
	'JuryDialog.BadLiftLabel': 'No Lift',
	'Scoreboard.NewRecord': 'New Record!',
	'AttemptBoard_lift_attempt_number': '{1} #{0}',
	'AttemptBoard_lift.SNATCH': 'Snatch',
	'AttemptBoard_lift.CLEANJERK': 'C. & J.',
	'Jury.incorrect.5': 'Incomplete attempt'
};

const state = (extra = {}) => ({
	sequence: 1,
	athleteKey: 7,
	visible: true,
	down: false,
	singleRef: false,
	refs: ['white', 'white', 'red'],
	jury: ['voted', 'empty', 'voted', 'empty'],
	review: 'none',
	panelReview: false,
	reviewVoteOpen: false,
	...extra
});

const lifting = { isCurrentAthlete: true, isBreak: false, breakType: null, showDecisions: true, showJuryVotes: true };
const juryBreak = { isCurrentAthlete: false, isBreak: true, breakType: 'JURY', showDecisions: true, showJuryVotes: true };

const adjudication = (extra = {}) => ({
	decision: false,
	reversal: true,
	ruleCode: 5,
	athleteKey: 7,
	liftTypeKey: 'Snatch',
	attemptNumber: 2,
	newRecord: false,
	waitForAnnouncer: false,
	...extra
});

describe('decision cells from decisionState', () => {
	it('shows the referee cells and the jury circles as sent', () => {
		const view = buildDecisionView({ decisionState: state() }, lifting);

		expect(view).toEqual({
			shown: true,
			down: false,
			singleRef: false,
			refs: ['white', 'white', 'red'],
			jury: ['voted', 'empty', 'voted', 'empty'],
			showJuryRow: true
		});
	});

	it('hides the jury circles when show jury votes is off', () => {
		const view = buildDecisionView({ decisionState: state() }, { ...lifting, showJuryVotes: false });

		expect(view.jury).toEqual([]);
		expect(view.showJuryRow).toBe(false);
		expect(view.refs).toEqual(['white', 'white', 'red']);
	});

	it('shows only the down arrow while down', () => {
		const view = buildDecisionView({ decisionState: state({ down: true, refs: ['empty', 'empty', 'empty'] }) }, lifting);

		expect(view.shown).toBe(true);
		expect(view.down).toBe(true);
		expect(view.showJuryRow).toBe(false);
	});

	it('passes the single referee setup and voted cells through', () => {
		const view = buildDecisionView({ decisionState: state({ singleRef: true, refs: ['empty', 'voted', 'empty'], jury: [] }) }, lifting);

		expect(view.singleRef).toBe(true);
		expect(view.refs).toEqual(['empty', 'voted', 'empty']);
		expect(view.showJuryRow).toBe(false);
	});

	it('is hidden when OWLCMS says the decision is not visible', () => {
		const view = buildDecisionView({ decisionState: state({ visible: false, refs: ['empty', 'empty', 'empty'] }) }, lifting);

		expect(view.shown).toBe(false);
	});

	it('is hidden when decisions are turned off', () => {
		expect(buildDecisionView({ decisionState: state() }, { ...lifting, showDecisions: false }).shown).toBe(false);
	});
});

describe('decision area during a jury or challenge break', () => {
	it('is shown when a review vote is open', () => {
		expect(isDecisionAreaShown(state({ visible: false, reviewVoteOpen: true }), juryBreak)).toBe(true);
	});

	it('is shown when the cells are shown', () => {
		expect(isDecisionAreaShown(state({ review: 'deliberation' }), juryBreak)).toBe(true);
		expect(isDecisionAreaShown(state({ review: 'challenge' }), { ...juryBreak, breakType: 'CHALLENGE' })).toBe(true);
	});

	it('is hidden when no vote is open and no cells are shown', () => {
		expect(isDecisionAreaShown(state({ visible: false, review: 'deliberation' }), juryBreak)).toBe(false);
	});

	it('is not shown in other breaks', () => {
		expect(isDecisionAreaShown(state(), { ...juryBreak, breakType: 'TECHNICAL' })).toBe(false);
	});
});

describe('review label', () => {
	it('picks the OWLCMS translation key', () => {
		expect(reviewLabelKey(state({ review: 'deliberation' }))).toBe('PublicMsg.JuryDeliberation');
		expect(reviewLabelKey(state({ review: 'deliberation', panelReview: true }))).toBe('PublicMsg.AdjudicationPanelReview');
		expect(reviewLabelKey(state({ review: 'challenge' }))).toBe('PublicMsg.CHALLENGE');
		expect(reviewLabelKey(state({ review: 'none' }))).toBeNull();
		expect(reviewLabelKey(null)).toBeNull();
	});
});

describe('options', () => {
	it('show jury votes follows OWLCMS unless forced', () => {
		expect(resolveShowJuryVotes('auto', { juryDecisionsOnAttemptBoard: true })).toBe(true);
		expect(resolveShowJuryVotes(undefined, { juryDecisionsOnAttemptBoard: false })).toBe(false);
		expect(resolveShowJuryVotes('auto', {})).toBe(false);
		expect(resolveShowJuryVotes(true, { juryDecisionsOnAttemptBoard: false })).toBe(true);
		expect(resolveShowJuryVotes('false', { juryDecisionsOnAttemptBoard: true })).toBe(false);
	});

	it('card duration defaults to 5 seconds', () => {
		expect(resolveCardSeconds(undefined)).toBe(5);
		expect(resolveCardSeconds('abc')).toBe(5);
		expect(resolveCardSeconds(-1)).toBe(5);
		expect(resolveCardSeconds('8')).toBe(8);
		expect(resolveCardSeconds(0)).toBe(0);
	});
});

describe('adjudication card', () => {
	it('builds a No Lift reversal card with the rule', () => {
		expect(buildAdjudicationCard(adjudication(), labels, 'DOE, Jane')).toEqual({
			success: false,
			status: 'Jury REVERSAL',
			decision: 'No Lift',
			athlete: 'DOE, Jane',
			attempt: 'Snatch #2',
			rule: '5 - Incomplete attempt'
		});
	});

	it('says New Record instead of Good Lift when the decision makes a record, without a rule', () => {
		const card = buildAdjudicationCard(
			adjudication({ decision: true, reversal: false, ruleCode: 5, newRecord: true, liftTypeKey: 'Clean_and_Jerk', attemptNumber: 1 }),
			labels,
			'DOE, Jane'
		);

		expect(card).toEqual({ success: true, status: 'Jury Confirmation', decision: 'New Record!', athlete: 'DOE, Jane', attempt: 'C. & J. #1', rule: '' });
	});

	it('has no status when OWLCMS does not say whether the jury reversed', () => {
		expect(buildAdjudicationCard(adjudication({ reversal: null }), labels, 'X').status).toBe('');
	});

	it('is not built for a Speaker-only notification', () => {
		expect(buildAdjudicationCard(adjudication({ waitForAnnouncer: true }), labels, 'X')).toBeNull();
		expect(buildAdjudicationCard(null, labels, 'X')).toBeNull();
	});

	it('picks the card texts from a translation map', () => {
		expect(buildJuryLabels({ 'Jury.incorrect.5': 'x', Other: 'y' })).toEqual({ 'Jury.incorrect.5': 'x' });
	});
});

describe('adjudication card timing', () => {
	const latch = (extra = {}, previous = null) => latchAdjudicationCard(previous, {
		adjudication: adjudication(),
		receivedAt: 1000,
		labels,
		athleteName: 'DOE, Jane',
		durationMs: 5000,
		now: 100000,
		...extra
	});

	it('is shown for the duration, then hidden', () => {
		const shown = latch();

		expect(isCardVisible(shown, 100000)).toBe(true);
		expect(isCardVisible(shown, 104999)).toBe(true);
		expect(isCardVisible(shown, 105000)).toBe(false);
	});

	it('only shows the remaining time for a decision received earlier', () => {
		const shown = latch({ ageMs: 3000 });

		expect(isCardVisible(shown, 101999)).toBe(true);
		expect(isCardVisible(shown, 102000)).toBe(false);
	});

	it('is not shown for a decision older than the duration', () => {
		expect(isCardVisible(latch({ ageMs: 6000 }), 100000)).toBe(false);
	});

	it('is never shown for a Speaker-only notification', () => {
		const hidden = latch({ adjudication: adjudication({ waitForAnnouncer: true }) });

		expect(hidden.key).toBe('1000');
		expect(isCardVisible(hidden, 100000)).toBe(false);
	});

	it('is off when the duration is 0', () => {
		expect(isCardVisible(latch({ durationMs: 0 }), 100000)).toBe(false);
	});

	it('keeps the same latch for the same decision and starts over for a new one', () => {
		const first = latch();

		expect(latch({ now: 103000 }, first)).toBe(first);
		expect(latch({ adjudication: null }, first)).toBe(first);
		const second = latch({ receivedAt: 2000, now: 103000 }, first);
		expect(second).not.toBe(first);
		expect(isCardVisible(second, 107999)).toBe(true);
	});
});

describe('legacy OWLCMS without decisionState', () => {
	it('shows the referee lights while lifting, as before', () => {
		const view = buildDecisionView({ visible: true, ref1: 'good', ref2: 'bad', ref3: null, down: false, isSingleReferee: false }, lifting);

		expect(view).toEqual({
			shown: true,
			down: false,
			singleRef: false,
			refs: ['white', 'red', 'empty'],
			jury: [],
			showJuryRow: false
		});
	});

	it('shows the down arrow until the lights are known', () => {
		expect(buildDecisionView({ visible: true, down: true }, lifting).down).toBe(true);
	});

	it('never shows the decision area in a break', () => {
		expect(buildDecisionView({ visible: true, ref1: 'good', ref2: 'good', ref3: 'good' }, juryBreak).shown).toBe(false);
	});

	it('is hidden when not visible or when decisions are turned off', () => {
		expect(buildDecisionView({ visible: false }, lifting).shown).toBe(false);
		expect(buildDecisionView({ visible: true }, { ...lifting, showDecisions: false }).shown).toBe(false);
	});
});
