import { describe, expect, it } from 'vitest';

import {
	computeDecisionBlockView,
	formatStopwatch,
	formatVerdictText
} from '../../../lib/decision-block-display.js';
import startOrderConfig from '../start-order/config.js';
import liftingOrderConfig from '../lifting-order/config.js';
import rankingsConfig from '../rankings/config.js';
import teamScoreboardConfig from '../../teams/team-scoreboard/config.js';

const labels = {
	'PublicMsg.JuryDeliberation': 'Jury Deliberation',
	'PublicMsg.AdjudicationPanelReview': 'Adjudication Panel Review',
	'PublicMsg.AdjudicationPanelVote': 'Adjudication Panel Vote',
	'PublicMsg.CHALLENGE': 'Challenge',
	'JuryDialog.GoodLiftLabel': 'Good Lift',
	'JuryDialog.BadLiftLabel': 'No Lift',
	'Jury.StandsAsCalled': 'Referee Decision Stands as Called',
	'Jury.incorrect.5': 'Press-out'
};

describe('decision-block-display', () => {
	it('hides the entire section in WAIT mode', () => {
		const view = computeDecisionBlockView({ mode: 'WAIT', labels });
		expect(view.sectionVisible).toBe(false);
	});

	it('shows current athlete, age groups and athlete timer in READY mode', () => {
		const view = computeDecisionBlockView({
			decisionBlock: { state: 'ready', sequence: 0 },
			mode: 'CURRENT_ATHLETE',
			currentAttempt: { startNumber: '12', fullName: 'SMITH, John' },
			currentAthleteAgeGroups: 'SR, U23',
			timerData: { visible: true, state: 'running' },
			labels,
			showAgeGroups: true
		});
		expect(view.sectionVisible).toBe(true);
		expect(view.decisionActive).toBe(false);
		expect(view.timerSlotVisible).toBe(true);
		expect(view.athleteTimerVisible).toBe(true);
		expect(view.showStartNumber).toBe(true);
		expect(view.startNumber).toBe('12');
		expect(view.displayName).toBe('SMITH, John');
		expect(view.ageGroups).toBe('SR, U23');
		expect(view.showRefLights).toBe(false);
		expect(view.juryMessage).toBe('');
	});

	it('shows break description without start number during a non-jury break, and only running countdowns', () => {
		const countdown = computeDecisionBlockView({
			decisionBlock: { state: 'ready', sequence: 0 },
			mode: 'LIFT_COUNTDOWN',
			breakText: 'Before Clean & Jerk',
			breakTimerData: { state: 'running', visible: true, displayText: null },
			labels
		});
		expect(countdown.timerSlotVisible).toBe(true);
		expect(countdown.breakCountdownVisible).toBe(true);
		expect(countdown.showStartNumber).toBe(false);
		expect(countdown.displayName).toBe('Before Clean & Jerk');

		const stopBreak = computeDecisionBlockView({
			decisionBlock: { state: 'ready', sequence: 0 },
			mode: 'INTERRUPTION',
			breakText: 'Competition Paused',
			breakTimerData: { state: 'running', visible: true, displayText: 'STOP' },
			labels
		});
		expect(stopBreak.timerSlotVisible).toBe(false);
		expect(stopBreak.breakCountdownVisible).toBe(false);
		expect(stopBreak.displayName).toBe('Competition Paused');
	});

	it('hides the clock, keeps the lifted athlete, shows referee lights, and expires after 20 s', () => {
		const t0 = 1_000_000;
		const decisionBlock = {
			state: 'decision',
			sequence: 3,
			athlete: { key: 7, startNumber: '12', fullName: 'SMITH, John', ageGroups: 'SR' },
			refLights: { singleRef: false, refs: ['white', 'white', 'red'] },
			expiresAt: t0 + 20000
		};
		const active = computeDecisionBlockView({
			decisionBlock,
			mode: 'CURRENT_ATHLETE',
			currentAttempt: { startNumber: '14', fullName: 'DOE, Jane' },
			timerData: { visible: true, state: 'set' },
			labels,
			now: t0 + 10000
		});
		expect(active.decisionActive).toBe(true);
		expect(active.timerSlotVisible).toBe(false);
		expect(active.startNumber).toBe('12');
		expect(active.displayName).toBe('SMITH, John');
		expect(active.showRefLights).toBe(true);
		expect(active.refLights.refs).toEqual(['white', 'white', 'red']);
		expect(active.remainingHoldMs).toBe(10000);

		// Expires locally accounting for serverClockOffsetMs
		const expired = computeDecisionBlockView({
			decisionBlock,
			mode: 'CURRENT_ATHLETE',
			currentAttempt: { startNumber: '14', fullName: 'DOE, Jane' },
			timerData: { visible: true, state: 'set' },
			labels,
			now: t0 + 18000,
			serverClockOffsetMs: 2500
		});
		expect(expired.decisionActive).toBe(false);
		expect(expired.displayName).toBe('DOE, Jane');
		expect(expired.showRefLights).toBe(false);
	});

	it('shows review label and stopwatch during INTERRUPTION deliberation, then verdict without stopwatch', () => {
		const t0 = 2_000_000;
		const delib = computeDecisionBlockView({
			decisionBlock: {
				state: 'deliberation',
				sequence: 5,
				athlete: { key: 7, startNumber: '12', fullName: 'SMITH, John', ageGroups: '' },
				refLights: { singleRef: false, refs: ['white', 'white', 'red'] },
				reviewLabelKey: 'PublicMsg.AdjudicationPanelReview',
				reviewStartMillis: t0,
				verdict: null,
				expiresAt: null
			},
			mode: 'INTERRUPTION',
			labels,
			showStopwatch: true,
			now: t0 + 65000
		});
		expect(delib.stopwatchVisible).toBe(true);
		expect(delib.timerSlotVisible).toBe(true);
		expect(delib.stopwatchText).toBe('1:05');
		expect(delib.juryMessage).toBe('Adjudication Panel Review');
		expect(delib.showRefLights).toBe(true);

		const verdict = computeDecisionBlockView({
			decisionBlock: {
				state: 'deliberation',
				sequence: 6,
				athlete: { key: 7, startNumber: '12', fullName: 'SMITH, John', ageGroups: '' },
				refLights: null,
				reviewLabelKey: 'PublicMsg.CHALLENGE',
				reviewStartMillis: null,
				verdict: { good: false, ruleCode: 5 },
				expiresAt: t0 + 90000
			},
			mode: 'CURRENT_ATHLETE',
			labels,
			showStopwatch: true,
			now: t0 + 75000
		});
		expect(verdict.stopwatchVisible).toBe(false);
		expect(verdict.timerSlotVisible).toBe(false);
		expect(verdict.juryMessage).toBe('No Lift \u2013 5 - Press-out');
		expect(verdict.showRefLights).toBe(false);
		expect(verdict.remainingHoldMs).toBe(15000);
	});

	it('formats verdict and stopwatch helpers consistently', () => {
		expect(formatVerdictText({ good: true, ruleCode: null }, labels)).toBe('Good Lift');
		expect(formatVerdictText({ good: true, ruleCode: 0 }, labels)).toBe('Good Lift \u2013 Referee Decision Stands as Called');
		expect(formatVerdictText({ good: false, ruleCode: 5 }, labels)).toBe('No Lift \u2013 5 - Press-out');
		expect(formatStopwatch(0)).toBe('0:00');
		expect(formatStopwatch(125900)).toBe('2:05');
	});

	it('exposes showDecisionSection (default true) on standard scoreboards only, not team scoreboard', () => {
		for (const cfg of [startOrderConfig, liftingOrderConfig, rankingsConfig]) {
			const opt = cfg.options.find((o) => o.key === 'showDecisionSection');
			expect(opt).toBeDefined();
			expect(opt.type).toBe('boolean');
			expect(opt.default).toBe(true);
		}
		const teamOpt = teamScoreboardConfig.options.find((o) => o.key === 'showDecisionSection');
		expect(teamOpt).toBeUndefined();
	});
});
