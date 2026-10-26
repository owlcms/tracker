import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	competitionHub: {
		getFopUpdate: vi.fn(),
		getDatabaseState: vi.fn(),
		getTranslations: vi.fn(),
		getSessionStatus: vi.fn(),
		getSessionAthletes: vi.fn()
	},
	logger: {
		warn: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		error: vi.fn(),
		trace: vi.fn()
	}
}));

vi.mock('$lib/server/competition-hub.js', () => ({
	competitionHub: mocks.competitionHub
}));

vi.mock('$lib/server/flag-resolver.js', () => ({
	getFlagUrl: vi.fn(() => null),
	getPictureUrl: vi.fn(() => null)
}));

// real tracker-core helpers: the fop update below is what the hub stores
vi.mock('$lib/server/timer-decision-helpers.js', async () => {
	const actual = await vi.importActual('@owlcms/tracker-core/utils');
	return {
		extractTimerAndDecisionState: actual.extractTimerAndDecisionState,
		extractDecisionDisplayDefaults: actual.extractDecisionDisplayDefaults
	};
});

vi.mock('@owlcms/tracker-core', () => ({
	logger: mocks.logger
}));

import { getScoreboardData } from '../helpers.data.js';

const translations = {
	'BreakMgmt.IntroductionOfAthletes': 'Introduction of Athletes',
	'BreakMgmt.IntroductionOfOfficials': 'Introduction of Officials',
	'BreakType.FIRST_SNATCH': 'Time before Snatch',
	'PublicMsg.JuryDeliberation': 'Jury Deliberation',
	'PublicMsg.AdjudicationPanelReview': 'Adjudication Panel Review',
	'PublicMsg.CHALLENGE': 'Challenge',
	'JuryDialog.BadLiftLabel': 'No Lift',
	'Jury.incorrect.5': 'Incomplete attempt',
	Unrelated: 'ignored'
};

const cells = (extra = {}) => ({
	sequence: 5,
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

const adjudication = {
	decision: false,
	reversal: true,
	ruleCode: 5,
	athleteKey: 7,
	liftTypeKey: 'Snatch',
	attemptNumber: 2,
	waitForAnnouncer: false
};

function fopUpdate(extra = {}) {
	return {
		fop: 'A',
		fopState: 'CURRENT_ATHLETE_DISPLAYED',
		mode: 'CURRENT_ATHLETE',
		break: 'false',
		...extra
	};
}

describe('Attempt board jury data', () => {
	beforeEach(() => {
		Object.values(mocks.competitionHub).forEach((fn) => fn.mockReset());
		mocks.competitionHub.getFopUpdate.mockReturnValue(null);
		mocks.competitionHub.getDatabaseState.mockReturnValue(null);
		mocks.competitionHub.getTranslations.mockReturnValue(translations);
		mocks.competitionHub.getSessionStatus.mockReturnValue({ isDone: false });
		mocks.competitionHub.getSessionAthletes.mockReturnValue([]);
	});

	it('passes decisionState through and follows the OWLCMS default for jury votes', () => {
		mocks.competitionHub.getFopUpdate.mockReturnValue(fopUpdate({
			decisionEventType: 'FULL_DECISION',
			decisionsVisible: 'true',
			juryDecisionsOnAttemptBoard: 'true',
			decisionState: cells()
		}));

		const data = getScoreboardData('A', {});

		expect(data.decision.decisionState.refs).toEqual(['white', 'white', 'red']);
		expect(data.decision.decisionState.jury).toEqual(['voted', 'empty', 'voted', 'empty']);
		expect(data.options.showJuryVotes).toBe(true);
	});

	it('lets the option override the OWLCMS default', () => {
		mocks.competitionHub.getFopUpdate.mockReturnValue(fopUpdate({ juryDecisionsOnAttemptBoard: 'true' }));

		expect(getScoreboardData('A', { showJuryVotes: false }).options.showJuryVotes).toBe(false);
		expect(getScoreboardData('A', { showJuryVotes: 'false' }).options.showJuryVotes).toBe(false);
		expect(getScoreboardData('A', { showJuryVotes: 'auto' }).options.showJuryVotes).toBe(true);

		mocks.competitionHub.getFopUpdate.mockReturnValue(fopUpdate({ juryDecisionsOnAttemptBoard: 'false' }));
		expect(getScoreboardData('A', { showJuryVotes: 'true' }).options.showJuryVotes).toBe(true);
	});

	it('keeps decisionState available in a jury break and labels the review', () => {
		mocks.competitionHub.getFopUpdate.mockReturnValue(fopUpdate({
			fopState: 'BREAK',
			break: 'true',
			breakType: 'JURY',
			mode: 'INTERRUPTION',
			decisionState: cells({ review: 'deliberation', panelReview: true, reviewVoteOpen: true })
		}));

		const data = getScoreboardData('A', {});

		expect(data.decision.visible).toBe(false);
		expect(data.decision.decisionState.reviewVoteOpen).toBe(true);
		expect(data.reviewLabel).toBe('Adjudication Panel Review');
		expect(data.breakMessage).toBe('Adjudication Panel Review');
	});

	it('labels a jury deliberation and a challenge', () => {
		mocks.competitionHub.getFopUpdate.mockReturnValue(fopUpdate({
			fopState: 'BREAK', break: 'true', breakType: 'JURY', mode: 'INTERRUPTION',
			decisionState: cells({ review: 'deliberation' })
		}));
		expect(getScoreboardData('A', {}).breakMessage).toBe('Jury Deliberation');

		mocks.competitionHub.getFopUpdate.mockReturnValue(fopUpdate({
			fopState: 'BREAK', break: 'true', breakType: 'CHALLENGE', mode: 'INTERRUPTION',
			decisionState: cells({ review: 'challenge' })
		}));
		expect(getScoreboardData('A', {}).breakMessage).toBe('Challenge');
	});

	it('shows the athletes ceremony inside FIRST_SNATCH without a timer', () => {
		mocks.competitionHub.getFopUpdate.mockReturnValue(fopUpdate({
			fopState: 'BREAK', break: 'true', breakType: 'FIRST_SNATCH',
			mode: 'CEREMONY', ceremonyType: 'INTRODUCTION',
			breakTimerEventType: 'BreakPaused', indefiniteBreak: true, breakMillisRemaining: null
		}));

		const data = getScoreboardData('A');
		expect(data.breakMessage).toBe('Introduction of Athletes');
		expect(data.mode).toBe('CEREMONY');
		expect(data.isCountdown).toBe(false);
		expect(data.breakTimer.visible).toBe(false);
	});

	it('shows the officials ceremony over the running snatch countdown', () => {
		mocks.competitionHub.getFopUpdate.mockReturnValue(fopUpdate({
			fopState: 'BREAK', break: 'true', breakType: 'FIRST_SNATCH',
			mode: 'LIFT_COUNTDOWN_CEREMONY', ceremonyType: 'OFFICIALS_INTRODUCTION',
			breakTimerEventType: 'BreakStarted', indefiniteBreak: false,
			breakStartTimeMillis: Date.now(), breakMillisRemaining: 15000
		}));

		const data = getScoreboardData('A');
		expect(data.breakMessage).toBe('Introduction of Officials');
		expect(data.isCountdown).toBe(true);
		expect(data.breakTimer.visible).toBe(true);
	});

	it('restores the break title after a ceremony even if its old type is still present', () => {
		mocks.competitionHub.getFopUpdate.mockReturnValue(fopUpdate({
			fopState: 'BREAK', break: 'true', breakType: 'FIRST_SNATCH',
			mode: 'LIFT_COUNTDOWN', ceremonyType: 'INTRODUCTION', ceremonyEventType: 'ceremonyDone',
			breakTimerEventType: 'BreakPaused', indefiniteBreak: true
		}));

		const data = getScoreboardData('A');
		expect(data.breakMessage).toBe('Time before Snatch');
		expect(data.breakTimer.visible).toBe(false);
	});

	it('provides the card texts, identity and age of the adjudication decision', () => {
		const receivedAt = Date.now() - 2000;
		mocks.competitionHub.getFopUpdate.mockReturnValue(fopUpdate({
			decisionState: cells(),
			adjudicationDecision: adjudication,
			adjudicationDecisionReceivedAt: receivedAt,
			athleteFull: 'DOE, Jane'
		}));

		const data = getScoreboardData('A', { juryCardSeconds: '8' });

		expect(data.decision.adjudicationDecision).toEqual(adjudication);
		expect(data.decision.athleteFull).toBe('DOE, Jane');
		expect(data.adjudicationKey).toBe(String(receivedAt));
		expect(data.adjudicationAgeMs).toBeGreaterThanOrEqual(2000);
		expect(data.adjudicationAgeMs).toBeLessThan(4000);
		expect(data.options.juryCardSeconds).toBe(8);
		expect(data.juryLabels).toEqual({
			'JuryDialog.BadLiftLabel': 'No Lift',
			'Jury.incorrect.5': 'Incomplete attempt'
		});
	});

	describe('legacy OWLCMS without decisionState', () => {
		it('is unchanged', () => {
			mocks.competitionHub.getFopUpdate.mockReturnValue(fopUpdate({
				decisionEventType: 'FULL_DECISION',
				decisionsVisible: 'true',
				d1: 'true', d2: 'true', d3: 'false'
			}));

			const data = getScoreboardData('A', {});

			expect(data.decision).toMatchObject({ visible: true, ref1: 'good', ref2: 'good', ref3: 'bad', down: false, decisionState: null, adjudicationDecision: null });
			expect(data.decision).not.toHaveProperty('athleteFull');
			expect(data.reviewLabel).toBeNull();
			expect(data.adjudicationKey).toBeNull();
			expect(data.options).toMatchObject({ showDecisions: true, showJuryVotes: false, juryCardSeconds: 5 });
		});

		it('keeps the plain jury break message', () => {
			mocks.competitionHub.getFopUpdate.mockReturnValue(fopUpdate({
				fopState: 'BREAK', break: 'true', breakType: 'JURY', mode: 'INTERRUPTION'
			}));

			expect(getScoreboardData('A', {}).breakMessage).toBe('Jury Deliberation');
		});
	});
});
