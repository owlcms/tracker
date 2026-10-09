import { describe, expect, it } from 'vitest';

import {
  buildMedalLiftsResolver,
  medalLiftsForChampionship,
  teamPointLiftsForChampionship
} from '../src/lib/medal-policy.js';

const ALL = { snatch: true, cleanJerk: true, total: true };
const TOTAL = { snatch: false, cleanJerk: false, total: true };
const LIFTS = { snatch: true, cleanJerk: true, total: false };

describe('championship medal policy', () => {
  it('uses the explicit medal policy of the championship', () => {
    expect(medalLiftsForChampionship({ medalPolicy: 'ALL_THREE', snatchCJTotalMedals: false })).toEqual(ALL);
    expect(medalLiftsForChampionship({ medalPolicy: 'TOTAL_ONLY', snatchCJTotalMedals: true })).toEqual(TOTAL);
    expect(medalLiftsForChampionship({ medalPolicy: 'LIFTS_ONLY', snatchCJTotalMedals: true })).toEqual(LIFTS);
  });

  it('falls back to the legacy snatchCJTotalMedals flag', () => {
    expect(medalLiftsForChampionship({ snatchCJTotalMedals: true })).toEqual(ALL);
    expect(medalLiftsForChampionship({ snatchCJTotalMedals: false })).toEqual(TOTAL);
  });

  it('uses the fallback championship when the championship has no medal settings', () => {
    expect(medalLiftsForChampionship({ name: 'Open', snatchCJTotalMedals: null }, { medalPolicy: 'LIFTS_ONLY' })).toEqual(LIFTS);
    expect(medalLiftsForChampionship(null, null)).toEqual(TOTAL);
  });

  it('derives team point lifts like OWLCMS TeamPointsPolicy.effective', () => {
    expect(teamPointLiftsForChampionship({ medalPolicy: 'TOTAL_ONLY', teamPointsPolicy: 'ALL_THREE' })).toEqual(TOTAL);
    expect(teamPointLiftsForChampionship({ medalPolicy: 'ALL_THREE', teamPointsPolicy: 'TOTAL_ONLY' })).toEqual(TOTAL);
    expect(teamPointLiftsForChampionship({ medalPolicy: 'ALL_THREE' })).toEqual(ALL);
    expect(teamPointLiftsForChampionship({ medalPolicy: 'LIFTS_ONLY' })).toEqual(LIFTS);
  });

  it('resolves per championship name, with the competition template for unknown names', () => {
    const resolve = buildMedalLiftsResolver({
      competition: { snatchCJTotalMedals: false },
      championships: [
        { name: 'Senior', medalPolicy: 'ALL_THREE' },
        { name: 'Masters', medalPolicy: 'TOTAL_ONLY' },
        { name: 'Template', competitionTemplate: true, medalPolicy: 'LIFTS_ONLY' }
      ]
    });
    expect(resolve('Senior')).toEqual(ALL);
    expect(resolve('Masters')).toEqual(TOTAL);
    expect(resolve('Open')).toEqual(LIFTS);
  });

  it('uses the competition flag for unknown names when there is no template', () => {
    const resolve = buildMedalLiftsResolver({ competition: { snatchCJTotalMedals: true }, championships: [] });
    expect(resolve('Open')).toEqual(ALL);
  });
});
