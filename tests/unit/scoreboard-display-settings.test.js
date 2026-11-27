import { describe, it, expect } from 'vitest';
import { extractDisplaySettings } from '../../src/lib/server/scoreboard-display-settings.js';

const scoreUpdate = {
	showMedalScore: 'true',
	medalScoringName: 'Q-masters',
	showTotalRank: 'false',
	showLiftRanks: 'false',
	showKgLeader: 'true',
	showKgDelta: 'false'
};

// OWLCMS 69.0 sends medalRank and medalScore, but not age, medalKgTop or medalKgUp.
const owlcms690Athletes = [
	{ isSpacer: true },
	{ medalRank: '1', medalScore: '250.501' },
	{ medalRank: '2', medalScore: '208.487' }
];

const owlcms691Athletes = [
	{ isSpacer: true },
	{ medalRank: '1', medalScore: '250.501', age: '39', medalKgTop: '', medalKgUp: '' },
	{ medalRank: '2', medalScore: '208.487', age: '36', medalKgTop: '+28', medalKgUp: '+28' }
];

const trackerDefaults = { showKgLeader: true, showKgDelta: true };

describe('extractDisplaySettings', () => {
	it('hides kg differentials and age for OWLCMS 69.0, even with the tracker options on', () => {
		const settings = extractDisplaySettings(scoreUpdate, owlcms690Athletes, [], trackerDefaults);
		expect(settings.showMedalScore).toBe(true);
		expect(settings.showMedalKgTop).toBe(false);
		expect(settings.showMedalKgUp).toBe(false);
		expect(settings.showAge).toBe(false);
		expect(settings.hasMedalRank).toBe(true);
	});

	it('shows kg differentials and age for OWLCMS 69.1 score medals', () => {
		const settings = extractDisplaySettings(scoreUpdate, owlcms691Athletes, [], trackerDefaults);
		expect(settings.showMedalKgTop).toBe(true);
		expect(settings.showMedalKgUp).toBe(true);
		expect(settings.showAge).toBe(true);
	});

	it('detects the fields on leaders when the session has no athletes', () => {
		const settings = extractDisplaySettings(scoreUpdate, [], owlcms691Athletes, trackerDefaults);
		expect(settings.showMedalKgTop).toBe(true);
		expect(settings.showAge).toBe(true);
	});

	it('applies the two tracker options independently', () => {
		const settings = extractDisplaySettings(scoreUpdate, owlcms691Athletes, [],
			{ showKgLeader: false, showKgDelta: true });
		expect(settings.showMedalKgTop).toBe(false);
		expect(settings.showMedalKgUp).toBe(true);
	});

	it('follows the OWLCMS switches when the options are not set', () => {
		const settings = extractDisplaySettings(scoreUpdate, owlcms691Athletes, [], {});
		expect(settings.showMedalKgTop).toBe(true);
		expect(settings.showMedalKgUp).toBe(false);
	});

	it('shows no score columns and keeps the birth year for Total medals', () => {
		const totalUpdate = { ...scoreUpdate, showMedalScore: 'false', showTotalRank: 'true' };
		const totalAthletes = [{ medalRank: '1', medalScore: '', age: '39', medalKgTop: '', medalKgUp: '' }];
		const settings = extractDisplaySettings(totalUpdate, totalAthletes, [], trackerDefaults);
		expect(settings.showMedalScore).toBe(false);
		expect(settings.showMedalKgTop).toBe(false);
		expect(settings.showMedalKgUp).toBe(false);
		expect(settings.showAge).toBe(false);
	});
});
