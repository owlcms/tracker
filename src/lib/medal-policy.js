/**
 * Per-championship medal and team-point policies, as exported by OWLCMS 68+.
 *
 * Mirrors OWLCMS MedalPolicy.effective() and TeamPointsPolicy.effective():
 * - medalPolicy: ALL_THREE | TOTAL_ONLY | LIFTS_ONLY
 * - teamPointsPolicy: ALL_THREE | TOTAL_ONLY | LIFTS_ONLY (forced to TOTAL_ONLY when only total medals)
 * Older exports only carry the legacy snatchCJTotalMedals boolean.
 *
 * PURE FUNCTIONS
 */

export const ALL_THREE = 'ALL_THREE';
export const TOTAL_ONLY = 'TOTAL_ONLY';
export const LIFTS_ONLY = 'LIFTS_ONLY';

const POLICIES = new Set([ALL_THREE, TOTAL_ONLY, LIFTS_ONLY]);

function normalizePolicy(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return POLICIES.has(normalized) ? normalized : null;
}

function hasMedalSettings(championship) {
  return normalizePolicy(championship?.medalPolicy) !== null
    || typeof championship?.snatchCJTotalMedals === 'boolean';
}

/**
 * Championship used when an athlete's category does not belong to a known championship:
 * the OWLCMS competition template championship, or the competition-level legacy flag.
 */
export function getDefaultMedalChampionship(databaseState) {
  const template = (databaseState?.championships || []).find((championship) => championship?.competitionTemplate === true);
  if (hasMedalSettings(template)) {
    return template;
  }
  return { snatchCJTotalMedals: databaseState?.competition?.snatchCJTotalMedals === true };
}

function settingsSource(championship, fallbackChampionship) {
  if (hasMedalSettings(championship)) {
    return championship;
  }
  return hasMedalSettings(fallbackChampionship) ? fallbackChampionship : null;
}

export function resolveMedalPolicy(championship, fallbackChampionship = null) {
  const source = settingsSource(championship, fallbackChampionship);
  const configured = normalizePolicy(source?.medalPolicy);
  if (configured) {
    return configured;
  }
  return source?.snatchCJTotalMedals === true ? ALL_THREE : TOTAL_ONLY;
}

export function resolveTeamPointsPolicy(championship, fallbackChampionship = null) {
  const medalPolicy = resolveMedalPolicy(championship, fallbackChampionship);
  if (medalPolicy === TOTAL_ONLY) {
    return TOTAL_ONLY;
  }
  const source = settingsSource(championship, fallbackChampionship);
  return normalizePolicy(source?.teamPointsPolicy) ?? medalPolicy;
}

/**
 * @returns {{snatch: boolean, cleanJerk: boolean, total: boolean}} lifts covered by a policy
 */
export function policyLifts(policy) {
  return {
    snatch: policy !== TOTAL_ONLY,
    cleanJerk: policy !== TOTAL_ONLY,
    total: policy !== LIFTS_ONLY
  };
}

export function medalLiftsForChampionship(championship, fallbackChampionship = null) {
  return policyLifts(resolveMedalPolicy(championship, fallbackChampionship));
}

export function teamPointLiftsForChampionship(championship, fallbackChampionship = null) {
  return policyLifts(resolveTeamPointsPolicy(championship, fallbackChampionship));
}

/**
 * Build a resolver from championship name to the lifts that are awarded medals.
 * Unknown names (e.g. the "Open" bucket) use the competition default.
 */
export function buildMedalLiftsResolver(databaseState) {
  const fallbackChampionship = getDefaultMedalChampionship(databaseState);
  const byName = new Map();
  for (const championship of databaseState?.championships || []) {
    const name = String(championship?.name ?? '').trim();
    if (name && !byName.has(name)) {
      byName.set(name, medalLiftsForChampionship(championship, fallbackChampionship));
    }
  }
  const defaultLifts = medalLiftsForChampionship(null, fallbackChampionship);
  return (championshipName) => byName.get(String(championshipName ?? '').trim()) || defaultLifts;
}
