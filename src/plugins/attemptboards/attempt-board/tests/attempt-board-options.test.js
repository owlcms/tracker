import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	competitionHub: {
		getFopUpdate: vi.fn(),
		getDatabaseState: vi.fn(),
		getTranslations: vi.fn(),
		getSessionStatus: vi.fn()
	},
	extractTimerAndDecisionState: vi.fn(),
	extractDecisionDisplayDefaults: vi.fn(),
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

vi.mock('$lib/server/timer-decision-helpers.js', () => ({
	extractTimerAndDecisionState: mocks.extractTimerAndDecisionState,
	extractDecisionDisplayDefaults: mocks.extractDecisionDisplayDefaults
}));

vi.mock('@owlcms/tracker-core', () => ({
	logger: mocks.logger
}));

import { getScoreboardData } from '../helpers.data.js';

describe('Attempt board option parsing', () => {
	beforeEach(() => {
		mocks.competitionHub.getFopUpdate.mockReset();
		mocks.competitionHub.getDatabaseState.mockReset();
		mocks.competitionHub.getTranslations.mockReset();
		mocks.competitionHub.getSessionStatus.mockReset();
		mocks.extractTimerAndDecisionState.mockReset();
		mocks.extractDecisionDisplayDefaults.mockReset();
		mocks.extractDecisionDisplayDefaults.mockReturnValue({});

		mocks.competitionHub.getFopUpdate.mockReturnValue(null);
		mocks.competitionHub.getDatabaseState.mockReturnValue(null);
		mocks.competitionHub.getTranslations.mockReturnValue({});
		mocks.competitionHub.getSessionStatus.mockReturnValue({ isDone: false });
		mocks.extractTimerAndDecisionState.mockReturnValue({
			timer: { visible: false, state: 'stopped', timeRemaining: 0 },
			breakTimer: { visible: false, state: 'stopped', timeRemaining: 0 },
			decision: { visible: false },
			displayMode: 'none'
		});
	});

	it('keeps declared boolean options disabled when buildOptions passes booleans', () => {
		const data = getScoreboardData('Platform_A', {
			showPlates: false,
			showTimer: false,
			showDecisions: false
		});

		expect(data.options).toMatchObject({
			showPlates: false,
			showTimer: false,
			showDecisions: false
		});
	});

	it('still honors explicit false strings from direct callers', () => {
		const data = getScoreboardData('Platform_A', {
			showPlates: 'false',
			showTimer: 'false',
			showDecisions: 'false'
		});

		expect(data.options).toMatchObject({
			showPlates: false,
			showTimer: false,
			showDecisions: false
		});
	});

	it('defaults the jury options: votes follow OWLCMS, card lasts 5 seconds', () => {
		const data = getScoreboardData('Platform_A', {});

		expect(data.options).toMatchObject({ showJuryVotes: false, juryCardSeconds: 5 });
	});
});
