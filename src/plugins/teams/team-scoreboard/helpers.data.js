/**
 * Server-side scoreboard helpers for team-based scoreboards
 * 
 * ARCHITECTURE: Layered data processing
 * 
 * Layer 1: Raw DTOs (unmodified from source)
 *   - Session athletes: from competitionHub.getStartOrderEntries() - already flattened by hub
 *   - Database athletes: from competitionHub.getDatabaseState().athletes (future)
 * 
 * Layer 2: TeamAthlete creation (enriched for team scoring)
 *   - teamAthleteFromSession(): creates TeamAthlete from session data
 *   - teamAthleteFromDatabase(): creates TeamAthlete from database data
 * 
 * Layer 3: Team grouping and scoring
 *   - Groups wrapped athletes by team
 *   - Computes team totals, top contributors, etc.
 */

import { competitionHub, logger } from '@owlcms/tracker-core';
import { 
	parseFormattedNumber, 
	getFlagUrl,
	buildCacheKey, 
	registerCache,
	extractTimers, 
	computeDisplayMode, 
	extractDecisionState,
	computeAttemptBarVisibility, 
	hasCurrentAthlete,
	logAttemptBarDebug
} from '@owlcms/tracker-core/utils';

// Import hub-bound presentation helpers from shared module
import { 
	isBreakMode, 
	inferGroupName, 
	inferBreakMessage, 
	extractCurrentAttempt,
	buildSessionInfo
} from '$lib/server/attempt-bar-helpers.js';

import { calculateTeamPoints } from '@owlcms/tracker-core/scoring';
// Import scoring functions from tracker-core (works at runtime for derivative plugins)
import { 
	calculateSinclair as CalculateSinclair,
	calculateSinclair2024 as CalculateSinclair2024, 
	calculateSinclair2020 as CalculateSinclair2020, 
	calculateSinclairMasters as CalculateSinclairMasters,
	getMastersAgeFactor,
	normalizeMastersAgeFactorYear,
	normalizeSinclairYear,
	calculateQPoints as CalculateQPoints,
	calculateGamx as computeGamx,
	Variant
} from '@owlcms/tracker-core/scoring';

// Re-export utilities and scoring functions for derivative plugins (from tracker-core)
export { parseFormattedNumber };
export { CalculateSinclair, CalculateSinclair2024, CalculateSinclair2020, CalculateSinclairMasters, getMastersAgeFactor, normalizeMastersAgeFactorYear, normalizeSinclairYear };
export { CalculateQPoints };
export { computeGamx, Variant };

// =============================================================================
// CUSTOM SCORE CALCULATOR (set via createHelpers)
// =============================================================================

/**
 * Custom score calculator injected via createHelpers()
 * If null, defaultCalculateScore is used
 */
let _customCalculateScore = null;

// =============================================================================
// CACHE
// =============================================================================

/**
 * Plugin-specific cache to avoid recomputing team data on every browser request
 */
const teamScoreboardCache = new Map();
registerCache(teamScoreboardCache);

/**
 * Track last known session gender per FOP
 * When no session is active, we use the previous session's gender (default: 'M')
 */
const lastKnownGenderByFop = new Map();

// NOTE: cache key construction uses the shared `buildCacheKey` helper
// to centralize hub/fop version lookup and consistent key formatting.

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

// parseFormattedNumber imported from @owlcms/tracker-core/utils

/**
 * Normalize athlete key to string for consistent lookups
 * Keys can be negative numbers in OWLCMS
 */
function normalizeKey(value) {
	if (value === undefined || value === null) return '';
	return String(value).trim();
}

/**
 * Extract year of birth from fullBirthDate
 * Database format can be array [2001, 1, 18] or string "2001-01-18"
 * @param {Array|string} fullBirthDate - Birth date in database format
 * @returns {string} Year as string (e.g., "2001") or empty string
 */
function extractYearOfBirth(fullBirthDate) {
	if (!fullBirthDate) return '';
	// Array format: [2001, 1, 18]
	if (Array.isArray(fullBirthDate) && fullBirthDate.length > 0) {
		return String(fullBirthDate[0]);
	}
	// String format: "2001-01-18"
	if (typeof fullBirthDate === 'string') {
		return fullBirthDate.substring(0, 4);
	}
	return '';
}

/**
 * Normalize lot number to string for consistent lookups
 * @deprecated Use normalizeKey() with athlete.key instead
 */
function normalizeLotNumber(value) {
	if (value === undefined || value === null) return '';
	return String(value).trim();
}

const DEFAULT_SINCLAIR_YEAR = 2024;
const DEFAULT_SMHF_SINCLAIR_YEAR = 2020;
const DEFAULT_SMHF_AGE_FACTOR_YEAR = 2020;

function getCompetitionSinclairYear(databaseState) {
	return normalizeSinclairYear(databaseState?.competition?.sinclairYear, DEFAULT_SINCLAIR_YEAR);
}

function resolveSinclairYearOption(optionValue, competitionYear, fallbackYear = competitionYear) {
	const normalizedOption = String(optionValue ?? '').trim();
	if (!normalizedOption || normalizedOption.toLowerCase() === 'competition') {
		return competitionYear;
	}

	const parsedYear = Number.parseInt(normalizedOption, 10);
	return normalizeSinclairYear(parsedYear, fallbackYear);
}

/**
 * Calculate score based on selected scoring system (default implementation)
 * @param {number} total - Athlete total
 * @param {number} bw - Body weight
 * @param {string} gender - 'M' or 'F'
 * @param {number} age - Athlete age
 * @param {string} system - Scoring system name
 * @param {Object} scoringConfig - Resolved year configuration for Sinclair-based systems
 * @returns {number} Calculated score
 */
function defaultCalculateScore(total, bw, gender, age, system = 'Sinclair', scoringConfig = {}) {
	if (!total || total <= 0 || !bw || bw <= 0 || !gender) return 0;
	
	const normalizedGender = gender === 'M' || gender === 'F' ? gender : (gender.startsWith('M') ? 'M' : 'F');
	const {
		sinclairYear = DEFAULT_SINCLAIR_YEAR,
		smhfOverrideSinclairYear = DEFAULT_SMHF_SINCLAIR_YEAR,
		smhfAgeFactorYear = DEFAULT_SMHF_AGE_FACTOR_YEAR
	} = scoringConfig;

	switch (system) {
		case 'SMHF':
			return CalculateSinclairMasters(total, bw, normalizedGender, age, smhfOverrideSinclairYear, smhfAgeFactorYear);
		case 'Q-Points':
			return CalculateQPoints(total, bw, normalizedGender, 0); // No age factor
		case 'Q-Masters':
			return CalculateQPoints(total, bw, normalizedGender, age);
		case 'GAMX':
			return computeGamx(normalizedGender, bw, total, Variant.SENIOR, null);
		case 'GAMX-M':
			return computeGamx(normalizedGender, bw, total, Variant.MASTERS, age);
		case 'GAMX-A':
			return computeGamx(normalizedGender, bw, total, Variant.AGE_ADJUSTED, age);
		case 'GAMX-U':
			return computeGamx(normalizedGender, bw, total, Variant.U17, age);
		case 'Sinclair':
		default:
			return CalculateSinclair(total, bw, normalizedGender, sinclairYear);
	}
}

/**
 * Calculate score using custom calculator (if provided) or default
 * Custom calculators return null to defer to default scoring
 * 
 * @param {number} total - Athlete total (actual or predicted, already computed)
 * @param {number} bw - Body weight
 * @param {string} gender - 'M' or 'F'
 * @param {number} age - Athlete age
 * @param {string} system - Scoring system name
 * @param {Object} context - Extended context for custom scoring
 * @param {Object} context.athlete - Full athlete object
 * @param {Object} context.hub - Competition hub reference
 * @param {Object} context.scoringConfig - Resolved year configuration for Sinclair-based systems
 * @param {Function|null} customCalculateScore - Injected custom calculator (null = use default)
 * @returns {number} Calculated score
 */
function calculateScoreWithContext(total, bw, gender, age, system, context, customCalculateScore) {
	// If custom calculator provided, try it first
	if (customCalculateScore) {
		const customResult = customCalculateScore(total, bw, gender, age, system, context);
		// If custom returns a number (not null), use it
		if (customResult !== null) {
			return customResult;
		}
	}
	// Fall back to default scoring
	return defaultCalculateScore(total, bw, gender, age, system, context?.scoringConfig);
}

/**
 * Normalize gender values to 'M' or 'F'
 * @param {string} g - Gender string
 * @returns {'M'|'F'|null}
 */
function normalizeGender(g) {
	if (g === undefined || g === null) return null;
	const s = String(g).trim().toLowerCase();
	if (s === 'm' || s === 'male' || s === 'men') return 'M';
	if (s === 'f' || s === 'female' || s === 'women') return 'F';
	return null;
}

// =============================================================================
// LAYER 1: RAW DTO ACCESS
// =============================================================================

/**
 * Get the full database state - SERVER-SIDE ONLY
 * @returns {Object|null} Raw database state from OWLCMS
 */
export function getDatabaseState() {
	return competitionHub.getDatabaseState();
}

/**
 * Get the latest UPDATE message for a specific FOP - SERVER-SIDE ONLY
 * @param {string} fopName - FOP name (default: 'A')
 * @returns {Object|null} Latest UPDATE message with precomputed data
 */
export function getFopUpdate(fopName = 'A') {
	return competitionHub.getFopUpdate({ fopName });
}

/**
 * Get session athletes (already flattened by hub)
 * These are athletes in the current lifting session with OWLCMS-computed display values
 * @param {string} fopName - FOP name
 * @returns {Array} Array of flat athlete objects (no spacers)
 */
function getSessionAthletes(fopName) {
	return competitionHub.getSessionAthletes({ fopName }) || [];
}

/**
 * Get session entries including spacers (for order preservation)
 * @param {string} fopName - FOP name
 * @returns {Array} Array of athlete objects and spacer markers
 */
function getSessionEntries(fopName) {
	return competitionHub.getStartOrderEntries({ fopName, includeSpacers: true }) || [];
}

// =============================================================================
// LAYER 2: ATHLETE ENRICHMENT (WRAPPING)
// =============================================================================

/**
 * Extract next requested weight from attempts array
 * @param {Array} attempts - Array of attempt objects [{liftStatus, stringValue}, ...]
 * @returns {number} Next requested weight or 0
 */
function getNextRequestedWeight(attempts) {
	if (!Array.isArray(attempts)) return 0;
	// V2 format: attempts have { value, status } structure
	// Hub-normalized format: attempts have { stringValue, liftStatus } structure
	const nextAttempt = attempts.find(a => {
		if (!a) return false;
		const status = a.liftStatus || a.status;
		return status === 'request' || status === 'current' || status === 'next';
	});
	if (!nextAttempt) return 0;
	
	// Parse weight from value (V2) or stringValue (hub-normalized)
	const weight = parseInt(nextAttempt.value ?? nextAttempt.stringValue, 10);
	return isNaN(weight) ? 0 : weight;
}

/**
 * Count how many snatch attempts have been completed (good or bad) for this athlete
 * @param {Object} athlete - Athlete with sattempts array
 * @returns {number} Number of completed snatch attempts (0-3)
 */
function countCompletedSnatches(athlete) {
	if (!athlete?.sattempts || !Array.isArray(athlete.sattempts)) return 0;
	let count = 0;
	for (const a of athlete.sattempts) {
		if (!a) continue;
		const status = (a.liftStatus || a.status || '').toString().toLowerCase();
		if (status === 'good' || status === 'bad') count++;
	}
	return count;
}

/**
 * Count how many clean & jerk attempts have been completed (good or bad) for this athlete
 * @param {Object} athlete - Athlete with cattempts array
 * @returns {number} Number of completed C&J attempts (0-3)
 */
function countCompletedCleanJerks(athlete) {
	if (!athlete?.cattempts || !Array.isArray(athlete.cattempts)) return 0;
	let count = 0;
	for (const a of athlete.cattempts) {
		if (!a) continue;
		const status = (a.liftStatus || a.status || '').toString().toLowerCase();
		if (status === 'good' || status === 'bad') count++;
	}
	return count;
}

/**
 * Whether an athlete is completely done lifting and should no longer show
 * a live lifting-order position.
 *
 * Done means either:
 * - all 6 attempts are completed, or
 * - the athlete has bombed out in snatch or clean & jerk.
 *
 * @param {Object} athlete - Athlete with sattempts/cattempts arrays
 * @returns {boolean}
 */
function isAthleteDoneLifting(athlete) {
	if (!athlete) return false;
	const totalAttemptsDone = countCompletedSnatches(athlete) + countCompletedCleanJerks(athlete);
	return totalAttemptsDone >= 6 || hasBombedOut(athlete);
}

/**
 * Check if athlete has bombed out (failed all 3 attempts in snatch or C&J)
 * Bombout means the athlete completed all 3 attempts in a lift phase with zero successful lifts
 * 
 * NOTE: This function checks the raw condition. Whether to apply the bombout rule
 * for scoring/display is determined by the enforceBombout option at display time.
 * 
 * @param {Object} athlete - Athlete with sattempts and cattempts arrays
 * @returns {boolean} True if athlete bombed out (all 3 failed in snatch OR all 3 failed in C&J)
 */
function hasBombedOut(athlete) {
	if (!athlete) return false;
	
	// Check snatch bombout: all 3 snatch attempts completed, all failed
	if (Array.isArray(athlete.sattempts) && athlete.sattempts.length >= 3) {
		let completedCount = 0;
		let successCount = 0;
		for (let i = 0; i < 3; i++) {
			const a = athlete.sattempts[i];
			if (!a) continue;
			const status = (a.liftStatus || a.status || '').toString().toLowerCase();
			if (status === 'good' || status === 'bad') {
				completedCount++;
				if (status === 'good') successCount++;
			}
		}
		// Bombed out in snatch if all 3 completed with zero successes
		if (completedCount === 3 && successCount === 0) {
			return true;
		}
	}
	
	// Check C&J bombout: all 3 C&J attempts completed, all failed
	if (Array.isArray(athlete.cattempts) && athlete.cattempts.length >= 3) {
		let completedCount = 0;
		let successCount = 0;
		for (let i = 0; i < 3; i++) {
			const a = athlete.cattempts[i];
			if (!a) continue;
			const status = (a.liftStatus || a.status || '').toString().toLowerCase();
			if (status === 'good' || status === 'bad') {
				completedCount++;
				if (status === 'good') successCount++;
			}
		}
		// Bombed out in C&J if all 3 completed with zero successes
		if (completedCount === 3 && successCount === 0) {
			return true;
		}
	}
	
	return false;
}

/**
 * Get the next requested weight from an attempts array (first attempt with pending status)
 * @param {Array} attempts - Array of attempt objects
 * @returns {number} Next requested weight or 0
 */
function getNextRequest(attempts) {
	if (!Array.isArray(attempts)) return 0;
	for (const a of attempts) {
		if (!a) continue;
		const status = (a.liftStatus || a.status || '').toString().toLowerCase();
		if (status === 'request' || status === 'current' || status === 'next') {
			const weight = parseInt(a.value ?? a.stringValue, 10);
			return isNaN(weight) ? 0 : weight;
		}
	}
	return 0;
}

/**
 * Calculate predicted total IF the next lift succeeds (for THIS athlete)
 * 
 * Rules - "if next lift succeeds":
 * - 0 attempts done (no lifts): first declared snatch (snatch only, no CJ)
 * - 1-2 attempts done (in snatch): next requested snatch (snatch only, no CJ)
 * - 3 attempts done (snatch complete): best snatch + first requested C&J  
 * - 4-5 attempts done (in C&J): best snatch + next requested C&J
 * - 6 attempts done (complete): best snatch + best C&J (actual final total)
 * 
 * @param {Object} athlete - Athlete with sattempts, cattempts, bestSnatch, bestCleanJerk
 * @returns {number} Predicted total if next lift succeeds
 */
function calculatePredictedIfNext(athlete) {
	if (!athlete) return 0;
	
	const bestSnatch = parseFormattedNumber(athlete.bestSnatch) || 0;
	const bestCJ = parseFormattedNumber(athlete.bestCleanJerk) || 0;
	
	const snatchesDone = countCompletedSnatches(athlete);
	const cjsDone = countCompletedCleanJerks(athlete);
	const totalAttemptsDone = snatchesDone + cjsDone;
	
	// 6 attempts done - competition complete, return actual total
	if (totalAttemptsDone >= 6) {
		return bestSnatch + bestCJ;
	}
	
	// 4-5 attempts done (in C&J phase) - predict with next C&J request
	if (totalAttemptsDone >= 4 && totalAttemptsDone < 6) {
		const nextCJ = getNextRequest(athlete.cattempts);
		if (nextCJ > 0) {
			// If next C&J succeeds, total = bestSnatch + nextCJ
			return bestSnatch + nextCJ;
		}
		// No next request (shouldn't happen), return current total
		return bestSnatch + bestCJ;
	}
	
	// 3 attempts done (snatch complete, starting C&J) - predict with first C&J request
	if (totalAttemptsDone === 3) {
		const firstCJ = getNextRequest(athlete.cattempts);
		if (firstCJ > 0) {
			return bestSnatch + firstCJ;
		}
		// No C&J request yet
		return bestSnatch;
	}
	
	// 1-2 attempts done (in snatch phase) - predict with next snatch ONLY (no CJ)
	if (totalAttemptsDone >= 1 && totalAttemptsDone < 3) {
		const nextSnatch = getNextRequest(athlete.sattempts);
		if (nextSnatch > 0) {
			// If next snatch succeeds, predicted = nextSnatch (no CJ yet)
			return nextSnatch;
		}
		// No next snatch request (shouldn't happen)
		return bestSnatch;
	}
	
	// 0 attempts done - predict with first snatch ONLY (no CJ)
	if (totalAttemptsDone === 0) {
		const firstSnatch = getNextRequest(athlete.sattempts);
		if (firstSnatch > 0) {
			return firstSnatch;
		}
		return 0; // No declarations yet
	}
	
	// Fallback
	return bestSnatch + bestCJ;
}

/**
 * Calculate predicted total while optionally ignoring the first clean & jerk declaration.
 * When includeCjDeclaration=true: Include C&J declaration in the prediction (during snatch phase, shows snatch + C&J decl)
 * When includeCjDeclaration=false: Only snatch total until first C&J attempt is recorded (during snatch phase, shows snatch only)
 * @param {Object} athlete - Athlete data
 * @param {boolean} includeCjDeclaration - Whether to include the first CJ declaration in the prediction
 * @returns {number}
 */
function calculatePredictedTotal(athlete, includeCjDeclaration = true) {
	if (!athlete) return 0;

	const snatchesDone = countCompletedSnatches(athlete);
	const cjsDone = countCompletedCleanJerks(athlete);
	
	// During snatch phase (< 3 snatches done), special handling for includeCjDeclaration
	if (snatchesDone < 3) {
		const nextSnatch = getNextRequest(athlete.sattempts);
		const bestSnatch = nextSnatch > 0 ? nextSnatch : (parseFormattedNumber(athlete.bestSnatch) || 0);
		
		// If includeCjDeclaration is true, add the first C&J request
		if (includeCjDeclaration) {
			const firstCJ = getNextRequest(athlete.cattempts);
			if (firstCJ > 0) {
				return bestSnatch + firstCJ;
			}
		}
		// If includeCjDeclaration is false, return snatch-only total
		return bestSnatch;
	}

	// If snatch phase is complete (>= 3 snatches done), use standard prediction logic
	return calculatePredictedIfNext(athlete);
}

/**
 * Check if athlete's total is definitively zero (all attempts completed with no successful lifts)
 * @param {Object} athlete - Athlete object
 * @returns {boolean}
 */
function isDefinitiveTotalZero(athlete) {
	if (!athlete) return false;
	const total = parseFormattedNumber(athlete.total ?? athlete.displayTotal ?? 0);
	if (total !== 0) return false;

	const attempts = [];
	if (Array.isArray(athlete.sattempts)) attempts.push(...athlete.sattempts);
	if (Array.isArray(athlete.cattempts)) attempts.push(...athlete.cattempts);

	// If any attempt is still pending, not definitive
	for (const a of attempts) {
		if (!a) return false;
		const status = (a.liftStatus || a.status || '').toString().toLowerCase();
		if (status === 'request' || status === 'empty' || status === 'current' || status === 'next') return false;
	}

	return true;
}

/**
 * Create a TeamAthlete from a session athlete (from OWLCMS UPDATE message)
 * Session athletes already have OWLCMS-computed fields (bestSnatch, bestCleanJerk, sattempts/cattempts with status)
 * Does NOT mutate the original DTO - returns a new TeamAthlete object
 * 
 * NOTE: This function extracts RAW data. The bombout rule is NOT applied here.
 * Bombout is applied later at display/scoring time based on the scoreboard's enforceBombout option.
 * This allows the same competition to show different totals for IWF results vs team scoreboards.
 * 
 * @param {Object} sessionAthlete - Raw session athlete from hub (already flattened)
 * @param {Object} context - Context for enrichment
 * @param {number|null} context.liftingOrder - Position in lifting order
 * @param {number|null} context.bodyWeight - Body weight (from database if not in session)
 * @param {boolean} context.includeCjDeclaration - Include C&J declaration in predictions (default: true)
 * @returns {Object} TeamAthlete with uniform structure for team scoring (raw values only)
 */
function teamAthleteFromSession(sessionAthlete, context = {}) {
	const { liftingOrder = null, bodyWeight = null, includeCjDeclaration = true } = context;
	const displayLiftingOrder = isAthleteDoneLifting(sessionAthlete) ? null : liftingOrder;
	
	// Use body weight from context (merged from database) or from session athlete
	const athleteBodyWeight = bodyWeight ?? sessionAthlete.bodyWeight ?? 0;
	const normalizedGender = normalizeGender(sessionAthlete.gender);
	
	// Get age for scoring systems that use it (SMHF, Q-Masters, GAMX)
	const birthYear = parseInt(sessionAthlete.yearOfBirth || extractYearOfBirth(sessionAthlete.fullBirthDate) || 0);
	const currentYear = new Date().getFullYear();
	const age = birthYear > 0 ? currentYear - birthYear : 0;

	// Check if athlete bombed out (store the raw condition, NOT applied yet)
	// The enforceBombout option is applied later at display/scoring time
	const bombed = hasBombedOut(sessionAthlete);
	
	// Calculate RAW actual values from session athlete data (bombout NOT applied)
	const bestSnatchValue = parseFormattedNumber(sessionAthlete.bestSnatch);
	const bestCleanJerkValue = parseFormattedNumber(sessionAthlete.bestCleanJerk);
	const rawTotal = bestSnatchValue + bestCleanJerkValue;
	const hasResults = bestSnatchValue > 0 || bestCleanJerkValue > 0;
	
	// Calculate RAW predicted total if next lift succeeds (bombout NOT applied)
	const rawPredictedTotal = calculatePredictedTotal(sessionAthlete, includeCjDeclaration);
	
	// Extract rank fields from displayInfo (OWLCMS V2 format)
	const snatchRank = parseInt(sessionAthlete.snatchRank || 0);
	const cleanJerkRank = parseInt(sessionAthlete.cleanJerkRank || 0);
	const totalRank = parseInt(sessionAthlete.totalRank || 0);
	
	// Determine if total is definitively zero
	const definitiveZero = isDefinitiveTotalZero(sessionAthlete);
	
	// Return wrapped athlete - original DTO is preserved, enrichments are added
	// NOTE: actualTotal, actualScore, etc. are computed later when enforceBombout is known
	const athleteKey = normalizeKey(sessionAthlete.key ?? sessionAthlete.athleteKey);
	return {
		// Original session athlete data (spread to preserve all fields)
		...sessionAthlete,
		
		// Key for lookups (normalized)
		athleteKey,
		
		// Mark source
		_source: 'session',
		_originalDto: sessionAthlete,
		
		// Body weight (may be enriched from database)
		bodyWeight: athleteBodyWeight,
		gender: normalizedGender,
		age,
		
		// Raw values (bombout NOT applied - that's done at display/scoring time)
		rawTotal,
		rawPredictedTotal,
		bombed, // Flag indicating if athlete bombed out (for enforceBombout to use)
		hasResults,
		isDefinitiveZero: definitiveZero,
		
		// Best lift values for reference
		bestSnatchValue,
		bestCleanJerkValue,
		
		// Enrichment: rank fields (for team points)
		snatchRank,
		cleanJerkRank,
		totalRank,
		
		// Enrichment: ordering
		liftingOrder: displayLiftingOrder,
		
		// Markers
		inCurrentSession: true
	};
}

/**
 * Compute best lift from raw attempt values (database format)
 * @param {Array<string|number>} attempts - Array of actual lift values (e.g., [100, -105, 105])
 * @returns {number} Best successful lift or 0
 */
function computeBestLift(attempts) {
	let best = 0;
	for (const attempt of attempts) {
		if (attempt === null || attempt === undefined || attempt === '' || attempt === '-') continue;
		const val = parseInt(attempt, 10);
		if (isNaN(val) || val <= 0) continue; // Skip failed lifts (negative) and invalid
		if (val > best) best = val;
	}
	return best;
}

/**
 * Format a single attempt from database raw fields into display format
 * Priority: change2 > change1 > declaration > automaticProgression (last available wins)
 * 
 * @param {string|number} declaration - Initial declared weight
 * @param {string|number} change1 - First change
 * @param {string|number} change2 - Second change
 * @param {string|number} actualLift - Actual lift result (negative = fail)
 * @returns {Object} { stringValue, liftStatus } matching hub normalized format
 */
function formatAttemptFromDatabase(declaration, change1, change2, actualLift, automaticProgression = null) {
	// If actual lift exists (not null), it's been attempted
	// null means not yet attempted; 0 or negative means failed lift
	if (actualLift !== null && actualLift !== undefined) {
		const val = parseInt(actualLift, 10);
		if (!isNaN(val)) {
			if (val > 0) {
				return { stringValue: String(val), liftStatus: 'good' };
			} else {
				// Zero or negative = failed lift (display absolute value)
				const decl = parseInt(declaration, 10) || 0;
				return { stringValue: String(Math.abs(val) || decl || '-'), liftStatus: 'bad' };
			}
		}
	}
	
	// Not yet attempted - find the current request weight (last available wins)
	const requestWeight = getLastRequestWeight({ declaration, change1, change2, automaticProgression });
	if (requestWeight !== null) {
		return { stringValue: String(requestWeight), liftStatus: 'request' };
	}
	
	// No data
	return { stringValue: '-', liftStatus: 'empty' };
}

/**
 * Get the last valid value in the request sequence for an attempt
 * Priority: change2 > change1 > declaration > automaticProgression
 * (last available wins, but "0" or empty values are skipped)
 */
function getLastRequestWeight(attempt) {
	if (!attempt) return null;
	
	// Check in reverse priority order - last available wins
	const candidates = [
		attempt.change2,
		attempt.change1,
		attempt.declaration,
		attempt.automaticProgression
	];
	
	for (const candidate of candidates) {
		if (candidate === null || candidate === undefined || candidate === '') continue;
		const val = parseInt(candidate, 10);
		if (!isNaN(val) && val > 0) {
			return val;
		}
	}
	return null;
}

/**
 * Determine the current requested weight for a lift (snatch or C&J)
 * Finds the first attempt with a request weight that hasn't been attempted
 * @param {Array} attempts - Array of attempt data [{declaration, change1, change2, actualLift, automaticProgression}, ...]
 * @returns {number|null} The requested weight for the current attempt, or null if all attempts are filled or have no requests
 */
function getCurrentRequestedWeight(attempts) {
	if (!Array.isArray(attempts)) return null;
	
	for (const attempt of attempts) {
		if (!attempt) continue;
		
		// If this attempt has no actual lift (not yet attempted), check for request weight
		if (attempt.actualLift === null || attempt.actualLift === undefined) {
			const requestWeight = getLastRequestWeight(attempt);
			if (requestWeight !== null) {
				// Found the first incomplete attempt with a valid request - return it
				return requestWeight;
			}
			// This attempt has no request weight, continue looking at next attempts
		}
	}
	
	// No more incomplete attempts with requests found
	return null;
}

// Unicode non-breaking space for empty attempt cells (matches OWLCMS format)
const NBSP = '\u00A0';

/**
 * Build formatted attempts array for a lift (snatch or C&J)
 * NOTE: Database-only reconstruction should use 'request' status, NOT 'current'.
 * The 'current' and 'next' statuses are session-specific and only come from
 * OWLCMS's displayInfo for session athletes.
 * @param {Array} attemptDtos - Array of attempt data
 * @returns {Array} Formatted attempts with liftStatus: 'good', 'bad', 'request', or 'empty'
 */
function buildFormattedAttempts(attemptDtos) {
	if (!Array.isArray(attemptDtos)) return [];

	let foundFirstRequest = false;

	// Format each attempt - use 'request' for pending weights (not 'current')
	// 'current' and 'next' are session-specific and only set by OWLCMS displayInfo
	return attemptDtos.map((dto) => {
		if (!dto) return { stringValue: NBSP, liftStatus: 'empty' };

		// If actual lift exists, return result status
		if (dto.actualLift !== null && dto.actualLift !== undefined) {
			const val = parseInt(dto.actualLift, 10);
			if (!isNaN(val)) {
				if (val > 0) {
					return { stringValue: String(val), liftStatus: 'good' };
				} else {
					// Zero or negative = failed lift (display absolute value)
					// If value is 0, it's a "not taken" lift - show hyphen with bad status
					const absVal = Math.abs(val);
					const displayVal = absVal === 0 ? '-' : String(absVal || dto.declaration || '-');
					return { stringValue: displayVal, liftStatus: 'bad' };
				}
			}
		}

		// Not yet attempted - find the request weight (last available in sequence)
		const requestWeight = getLastRequestWeight(dto);
		if (requestWeight !== null) {
			// Only show the FIRST request in the sequence as 'request'
			// Subsequent requests are forced empty (no value shown)
			if (!foundFirstRequest) {
				foundFirstRequest = true;
				// Always use 'request' for database reconstruction
				// 'current' and 'next' only come from OWLCMS session data
				return { stringValue: String(requestWeight), liftStatus: 'request' };
			} else {
				// Found a subsequent request - force empty with no value
				return { stringValue: NBSP, liftStatus: 'empty' };
			}
		}

		// No data - use nbsp for empty cell
		return { stringValue: NBSP, liftStatus: 'empty' };
	});
}

function mapAttemptsToDisplayInfo(formattedAttempts) {
	return (formattedAttempts || []).map((attempt) => {
		// Check for empty: no attempt, no stringValue, hyphen, or nbsp
		if (!attempt || !attempt.stringValue || attempt.stringValue === '-' || attempt.stringValue === NBSP) {
			return { value: null, status: null };
		}

		const status = attempt.liftStatus === 'empty' ? null : attempt.liftStatus;
		return {
			value: attempt.stringValue,
			status
		};
	});
}


/**
 * Create a TeamAthlete from a database athlete (from OWLCMS DATABASE message)
 * Database athletes lack OWLCMS-computed fields, so we compute them here
 * Does NOT mutate the original DTO - returns a new TeamAthlete object
 * 
 * NOTE: This function extracts RAW data. The bombout rule is NOT applied here.
 * Bombout is applied later at display/scoring time based on the scoreboard's enforceBombout option.
 * This allows the same competition to show different totals for IWF results vs team scoreboards.
 * 
 * @param {Object} dbAthlete - Raw database athlete from databaseState.athletes
 * @param {Object} context - Context for enrichment
 * @param {number|null} context.liftingOrder - Position in lifting order (if known)
 * @returns {Object} TeamAthlete with uniform structure for team scoring (same as teamAthleteFromSession)
 */
function teamAthleteFromDatabase(dbAthlete, context = {}) {
	const { liftingOrder = null, includeCjDeclaration = true } = context;
	
	if (!dbAthlete) return null;
	
	const normalizedGender = normalizeGender(dbAthlete.gender);
	const athleteBodyWeight = parseFormattedNumber(dbAthlete.bodyWeight) || 0;
	
	// Get age for scoring systems that use it
	const birthYear = parseInt(extractYearOfBirth(dbAthlete.fullBirthDate) || 0);
	const currentYear = new Date().getFullYear();
	const age = birthYear > 0 ? currentYear - birthYear : 0;

	// Format name as "LASTNAME, Firstname" to match OWLCMS session format
	const lastName = (dbAthlete.lastName || '').toUpperCase();
	const firstName = dbAthlete.firstName || '';
	const fullName = lastName && firstName ? `${lastName}, ${firstName}` : lastName || firstName || '';
	
	// Use teamName from V2 parser (already resolved) or fall back to resolving from team ID
	const teamName = dbAthlete.teamName || competitionHub.getTeamNameById({ teamId: dbAthlete.team }) || '';
	
	// Extract ranks from participations array (OWLCMS stores per-championship ranks here)
	// Use first participation for now (team scoreboard uses first championship)
	const participations = dbAthlete.participations || [];
	const firstParticipation = participations[0] || {};
	const snatchRank = parseInt(firstParticipation.snatchRank, 10) || 0;
	const cleanJerkRank = parseInt(firstParticipation.cleanJerkRank, 10) || 0;
	const totalRank = parseInt(firstParticipation.totalRank, 10) || 0;
	const championshipType = firstParticipation.championshipType || '';
	
	// Build sattempts array from raw database fields
	// Uses 'request' for pending weights (not 'current' - that's session-specific)
	const snatchAttempts = [
		{ declaration: dbAthlete.snatch1Declaration, change1: dbAthlete.snatch1Change1, change2: dbAthlete.snatch1Change2, actualLift: dbAthlete.snatch1ActualLift, automaticProgression: dbAthlete.snatch1AutomaticProgression },
		{ declaration: dbAthlete.snatch2Declaration, change1: dbAthlete.snatch2Change1, change2: dbAthlete.snatch2Change2, actualLift: dbAthlete.snatch2ActualLift, automaticProgression: dbAthlete.snatch2AutomaticProgression },
		{ declaration: dbAthlete.snatch3Declaration, change1: dbAthlete.snatch3Change1, change2: dbAthlete.snatch3Change2, actualLift: dbAthlete.snatch3ActualLift, automaticProgression: dbAthlete.snatch3AutomaticProgression }
	];
	const sattempts = buildFormattedAttempts(snatchAttempts);
	
	// Build cattempts array from raw database fields
	// Uses 'request' for pending weights (not 'current' - that's session-specific)
	const cjAttempts = [
		{ declaration: dbAthlete.cleanJerk1Declaration, change1: dbAthlete.cleanJerk1Change1, change2: dbAthlete.cleanJerk1Change2, actualLift: dbAthlete.cleanJerk1ActualLift, automaticProgression: dbAthlete.cleanJerk1AutomaticProgression },
		{ declaration: dbAthlete.cleanJerk2Declaration, change1: dbAthlete.cleanJerk2Change1, change2: dbAthlete.cleanJerk2Change2, actualLift: dbAthlete.cleanJerk2ActualLift, automaticProgression: dbAthlete.cleanJerk2AutomaticProgression },
		{ declaration: dbAthlete.cleanJerk3Declaration, change1: dbAthlete.cleanJerk3Change1, change2: dbAthlete.cleanJerk3Change2, actualLift: dbAthlete.cleanJerk3ActualLift, automaticProgression: dbAthlete.cleanJerk3AutomaticProgression }
	];
	const cattempts = buildFormattedAttempts(cjAttempts);
	
	// Compute best lifts from actual lift results
	const bestSnatch = computeBestLift([
		dbAthlete.snatch1ActualLift,
		dbAthlete.snatch2ActualLift,
		dbAthlete.snatch3ActualLift
	]);
	const bestCleanJerk = computeBestLift([
		dbAthlete.cleanJerk1ActualLift,
		dbAthlete.cleanJerk2ActualLift,
		dbAthlete.cleanJerk3ActualLift
	]);
	
	// Build a normalized athlete object that looks like a session athlete
	// This allows calculatePredictedIfNext to work the same way
	const normalizedAthlete = {
		sattempts,
		cattempts,
		bestSnatch,
		bestCleanJerk
	};
	const displayLiftingOrder = isAthleteDoneLifting(normalizedAthlete) ? null : liftingOrder;
	
	// Check if athlete bombed out (store the raw condition, NOT applied yet)
	// The enforceBombout option is applied later at display/scoring time
	const bombed = hasBombedOut(normalizedAthlete);
	
	// Calculate RAW total (bombout NOT applied)
	const rawTotal = bestSnatch + bestCleanJerk;
	const hasResults = bestSnatch > 0 || bestCleanJerk > 0;
	
	// Calculate RAW predicted total if next lift succeeds (bombout NOT applied)
	const rawPredictedTotal = calculatePredictedTotal(normalizedAthlete, includeCjDeclaration);
	
	// Determine if total is definitively zero
	const definitiveZero = isDefinitiveTotalZero(normalizedAthlete);
	
	// Return TeamAthlete - same structure as teamAthleteFromSession
	const athleteKey = normalizeKey(dbAthlete.key);
	
	// Format category for display - replace underscores with spaces
	const categoryDisplay = (dbAthlete.categoryCode || '').replace(/_/g, ' ');
	
	// Note: displayInfo will be populated at display/scoring time after bombout is applied
	// For now, we only store raw values
	
	return {
		// Key for lookups (OWLCMS unique identifier)
		key: dbAthlete.key,
		athleteKey,
		
		// Computed display fields (matching session athlete format)
		fullName,
		firstName: dbAthlete.firstName,
		lastName: dbAthlete.lastName,
		membership: dbAthlete.membership || '',
		teamName,  // Resolved from team ID using hub's indexed teams
		team: dbAthlete.team,  // Original team ID
		startNumber: dbAthlete.startNumber,
		lotNumber: dbAthlete.lotNumber,
		category: categoryDisplay,
		categoryName: categoryDisplay,
		gender: dbAthlete.gender,
		bodyWeight: athleteBodyWeight,
		yearOfBirth: extractYearOfBirth(dbAthlete.fullBirthDate),
		sessionName: dbAthlete.sessionName || '',
		
		// Computed attempts arrays (same format as session athlete)
		sattempts,
		cattempts,
		
		// Mark source
		_source: 'database',
		_originalDto: dbAthlete,
		
		// Body weight (may be enriched from database)
		// gender already included above
		age, // Computed from birth year
		
		// Raw values (bombout NOT applied - that's done at display/scoring time)
		rawTotal,
		rawPredictedTotal,
		bombed, // Flag indicating if athlete bombed out (for enforceBombout to use)
		hasResults,
		isDefinitiveZero: definitiveZero,
		
		// Best lift values for reference
		bestSnatchValue: bestSnatch,
		bestCleanJerkValue: bestCleanJerk,
		
		// Legacy aliases for compatibility
		bestSnatch,
		bestCleanJerk,
		
		// Enrichment: rank fields (from first participation - for team points)
		snatchRank,
		cleanJerkRank,
		totalRank,
		championshipType,
		
		// Enrichment: ordering
		liftingOrder: displayLiftingOrder,
		
		// Markers
		inCurrentSession: false
	};
}

// Export for testing
export { calculatePredictedIfNext, calculatePredictedTotal, teamAthleteFromSession, teamAthleteFromDatabase };

// =============================================================================
// LAYER 2.5: SCORING COMPUTATION (applies bombout rule)
// =============================================================================

/**
 * Compute score using the specified scoring system
 * Uses custom calculateScore if provided, otherwise falls back to default
 * 
 * @param {number} total - Athlete total (with or without bombout applied)
 * @param {number} bodyWeight - Body weight
 * @param {string} gender - 'M' or 'F'
 * @param {string} scoringSystem - Scoring system name
 * @param {number} age - Athlete age (for masters systems)
 * @param {Object} athlete - Full athlete object for context (optional)
 * @param {Object} scoringConfig - Resolved year configuration for Sinclair-based systems
 * @returns {number} Calculated score
 */
function computeScore(total, bodyWeight, gender, scoringSystem, age = 0, athlete = null, scoringConfig = {}) {
	if (!total || total <= 0 || !bodyWeight || bodyWeight <= 0) return 0;
	const normalizedGender = normalizeGender(gender) || 'M';
	
	// Build context for custom scoring
	const context = {
		athlete: athlete || {},
		hub: competitionHub,
		scoringConfig
	};
	
	// Use custom calculator if available, otherwise default
	return calculateScoreWithContext(total, bodyWeight, normalizedGender, age, scoringSystem, context, _customCalculateScore);
}

/**
 * Format score for display based on scoring system
 * @param {number} score - Calculated score value
 * @param {string} scoringSystem - Scoring system name
 * @returns {string} Formatted score string
 */
function formatScore(score, scoringSystem) {
	if (!score || score <= 0 || !Number.isFinite(score)) return '-';
	
	// PDC (Points de Classement) uses 2 decimal places
	// Most other systems use 3 decimal places
	if (scoringSystem === 'PDC') {
		return score.toFixed(2);
	}
	
	return score.toFixed(3);
}

/**
 * Compute actual and display values from raw extracted athlete data
 * This is where the enforceBombout rule is applied.
 * 
 * NOTE: This separation allows the same competition to show:
 * - IWF official results with bombout enforced (total = 0 for bombed athletes)
 * - Team scoreboard with bombout NOT enforced (total = best lifts sum)
 * 
 * @param {Object} athlete - TeamAthlete with raw values (from teamAthleteFromSession/Database)
 * @param {Object} context - Scoring context
 * @param {boolean} context.enforceBombout - Apply IWF bombout rule (default: false)
 * @param {string} context.scoringSystem - Scoring system to use
 * @returns {Object} Athlete with computed actual/display values
 */
function computeAthleteScoring(athlete, context = {}) {
	if (!athlete) return athlete;
	
	const {
		enforceBombout = false,
		scoringSystem = 'Sinclair',
		scoringConfig = {}
	} = context;
	
	const { rawTotal = 0, rawPredictedTotal = 0, bombed = false, bodyWeight = 0, gender = 'M', age = 0 } = athlete;
	
	// Apply bombout rule to get actual totals
	const actualTotal = (enforceBombout && bombed) ? 0 : rawTotal;
	const predictedTotal = (enforceBombout && bombed) ? 0 : rawPredictedTotal;
	
	// Compute scores based on scoring system (pass athlete for custom scoring context)
	const actualScore = computeScore(actualTotal, bodyWeight, gender, scoringSystem, age, athlete, scoringConfig);
	const nextScore = computeScore(predictedTotal, bodyWeight, gender, scoringSystem, age, athlete, scoringConfig);
	
	// Format display values
	const displayTotal = actualTotal > 0 ? String(actualTotal) : '-';
	const displayScore = actualScore > 0 ? formatScore(actualScore, scoringSystem) : '-';
	const displayNextScore = nextScore > 0 ? formatScore(nextScore, scoringSystem) : '-';
	
	// Build displayInfo for session athletes (if not already present)
	// For database athletes, displayInfo was deferred until now
	let displayInfo = athlete.displayInfo;
	if (!displayInfo || athlete._source === 'database') {
		displayInfo = buildDisplayInfo(athlete, displayTotal);
	}
	
	return {
		...athlete,
		// Computed totals (bombout applied if enforced)
		total: actualTotal,
		actualTotal,
		predictedTotal,
		nextTotal: predictedTotal, // Legacy alias
		
		// Computed scores
		actualScore,
		nextScore,
		
		// Display values
		displayTotal,
		displayScore,
		displayNextScore,
		displayInfo
	};
}

/**
 * Build displayInfo object for an athlete
 * Used primarily for database athletes where displayInfo was deferred
 * @param {Object} athlete - TeamAthlete
 * @param {string} displayTotal - Formatted total string
 * @returns {Object} displayInfo object
 */
function buildDisplayInfo(athlete, displayTotal) {
	const mapAttemptsToDisplayInfo = (attempts) => {
		return (attempts || []).map((attempt) => {
			if (!attempt || !attempt.stringValue || attempt.stringValue === '-' || attempt.stringValue === '\u00A0') {
				return { value: null, status: null };
			}
			const status = attempt.liftStatus === 'empty' ? null : attempt.liftStatus;
			return {
				value: attempt.stringValue,
				status
			};
		});
	};
	
	const displayInfoSattempts = mapAttemptsToDisplayInfo(athlete.sattempts);
	const displayInfoCattempts = mapAttemptsToDisplayInfo(athlete.cattempts);
	
	return {
		fullName: athlete.fullName || '',
		teamName: athlete.teamName || '',
		yearOfBirth: athlete.yearOfBirth || '',
		gender: athlete.gender || '',
		startNumber: String(athlete.startNumber || ''),
		lotNumber: String(athlete.lotNumber || ''),
		category: athlete.category || athlete.categoryName || '',
		sattempts: displayInfoSattempts,
		cattempts: displayInfoCattempts,
		bestSnatch: (athlete.bestSnatchValue || athlete.bestSnatch) > 0 ? String(athlete.bestSnatchValue || athlete.bestSnatch) : '-',
		bestCleanJerk: (athlete.bestCleanJerkValue || athlete.bestCleanJerk) > 0 ? String(athlete.bestCleanJerkValue || athlete.bestCleanJerk) : '-',
		total: displayTotal,
		sinclairRank: '-',
		classname: athlete.classname || '',
		session: athlete.sessionName || athlete.group || '',
		subCategory: '',
		flagURL: athlete.flagURL || '',
		flagClass: athlete.flagClass || '',
		teamLength: (athlete.teamName || '').length,
		custom1: '',
		custom2: '',
		membership: athlete.membership || ''
	};
}

function getAthleteMembership(athlete) {
	if (!athlete) return '';
	if (athlete.membership !== undefined && athlete.membership !== null) {
		return String(athlete.membership);
	}
	if (athlete.displayInfo?.membership !== undefined && athlete.displayInfo?.membership !== null) {
		return String(athlete.displayInfo.membership);
	}
	return '';
}

function getAthleteBodyWeight(athlete) {
	const bodyWeight = parseFormattedNumber(athlete?.bodyWeight);
	return bodyWeight > 0 ? bodyWeight : '';
}

/**
 * Apply scoring computation to an array of athletes
 * @param {Array} athletes - Array of TeamAthletes with raw values
 * @param {Object} context - Scoring context (enforceBombout, scoringSystem)
 * @returns {Array} Athletes with computed actual/display values
 */
function applyScoring(athletes, context = {}) {
	return athletes.map(a => computeAthleteScoring(a, context));
}

// Export for testing
export { computeAthleteScoring, applyScoring };

// =============================================================================
// LAYER 3: TEAM GROUPING AND SCORING
// =============================================================================

/**
 * Get score from TeamAthlete for team scoring
 * Uses actualScore (computed Sinclair) or teamPoints (when scoringSystem is TeamPoints)
 * Note: scoringSystem check happens in groupByTeams via scoringFunction
 * @param {Object} athlete - TeamAthlete (must have been processed by applyScoring)
 * @returns {number}
 */
function getAthleteScore(athlete) {
	if (!athlete) return 0;
	// This function returns the regular score (Sinclair, etc.)
	// For TeamPoints mode, calculateAthleteTeamPoints is called directly
	if (typeof athlete.actualScore === 'number' && Number.isFinite(athlete.actualScore)) {
		return athlete.actualScore;
	}
	return 0;
}

/**
 * Compare two athletes for sorting within a team
 * Sort order: session name/number, then start number (if in current session), then lot number
 * @param {Object} a - First TeamAthlete
 * @param {Object} b - Second TeamAthlete
 * @returns {number} Comparison result
 */
function compareAthletesForTeamOrder(a, b) {
	// 1. Sort by session name/number (alphabetical/numerical)
	const sessionA = (a.group || a.sessionName || '').toString();
	const sessionB = (b.group || b.sessionName || '').toString();
	if (sessionA !== sessionB) {
		return sessionA.localeCompare(sessionB, undefined, { numeric: true });
	}
	
	// 2. Within same session, sort by start number (only current session athletes have start numbers)
	const startA = parseInt(a.startNumber, 10) || 999999;
	const startB = parseInt(b.startNumber, 10) || 999999;
	if (startA !== startB) {
		return startA - startB;
	}
	
	// 3. Fallback to lot number
	const lotA = parseInt(a.lotNumber, 10) || 999999;
	const lotB = parseInt(b.lotNumber, 10) || 999999;
	return lotA - lotB;
}

/**
 * Get predicted score from TeamAthlete
 * @param {Object} athlete - TeamAthlete
 * @returns {number}
 */
function getAthletePredictedScore(athlete) {
	if (!athlete) return 0;
	if (typeof athlete.nextScore === 'number' && Number.isFinite(athlete.nextScore)) {
		return athlete.nextScore;
	}
	return parseFormattedNumber(athlete.nextScore) || 0;
}

/**
 * Calculate team points for an athlete based on their ranks
 * @param {Object} athlete - TeamAthlete with rank fields
 * @param {Object} competition - Competition settings
 * @returns {number} Team points earned
 */
function calculateAthleteTeamPoints(athlete, competition) {
	const tp1 = competition?.teamPoints1st || 28;
	const tp2 = competition?.teamPoints2nd || 25;
	const tp3 = competition?.teamPoints3rd || 23;
	const snatchCJTotal = competition?.snatchCJTotalMedals || false;

	// Normalize rank fields — OWLCMS may send strings or alternate keys
	const parseRank = (value) => {
		const n = parseInt(value, 10);
		return Number.isFinite(n) && n > 0 ? n : 0;
	};

	const snatchRank = parseRank(
		athlete.snatchRank ?? athlete.snatchRankSession ?? athlete.snatchRankInGroup ?? athlete.snatchSessionRank
	);
	const cleanJerkRank = parseRank(
		athlete.cleanJerkRank ?? athlete.cjRank ?? athlete.cleanJerkRankSession ?? athlete.cleanJerkRankInGroup
	);
	const totalRank = parseRank(
		athlete.totalRank ?? athlete.totalRankSession ?? athlete.totalRankInGroup ?? athlete.rankTotal ?? athlete.rank
	);

	// Debug: log first athlete's rank fields to understand data structure
	if (!calculateAthleteTeamPoints._debugLogged) {
		logger.debug(`[TeamPoints DEBUG] Sample athlete keys with 'rank':`, Object.keys(athlete).filter(k => k.toLowerCase().includes('rank')));
		logger.debug(`[TeamPoints DEBUG] snatchRank=${snatchRank}, cleanJerkRank=${cleanJerkRank}, totalRank=${totalRank}`);
		logger.debug(`[TeamPoints DEBUG] Raw values: athlete.snatchRank=${athlete.snatchRank}, athlete.totalRank=${athlete.totalRank}, athlete.championshipType=${athlete.championshipType}`);
		logger.debug(`[TeamPoints DEBUG] tp1=${tp1}, tp2=${tp2}, tp3=${tp3}, snatchCJTotal=${snatchCJTotal}`);
		calculateAthleteTeamPoints._debugLogged = true;
	}

	let points = 0;

	// Get athlete's actual lift values
	const bestSnatch = parseInt(athlete.bestSnatch) || 0;
	const bestCleanJerk = parseInt(athlete.bestCleanJerk) || 0;
	const total = parseInt(athlete.total) || 0;

	// For live session, all athletes are considered team members
	const teamMember = true;

	// Debug: log first athlete and ALJASIM
	if (!calculateAthleteTeamPoints._loggedOnce) {
		logger.debug(`[TeamPoints] First athlete:`, {
			fullName: athlete.fullName,
			lastName: athlete.lastName,
			bestSnatch,
			bestCleanJerk,
			total,
			snatchRank,
			cleanJerkRank,
			totalRank
		});
		calculateAthleteTeamPoints._loggedOnce = true;
	}

	if (athlete.lastName?.includes('ALJASIM') || athlete.fullName?.includes('ALJASIM') || athlete.fullName?.includes('aljasim')) {
		logger.debug(`[TeamPoints ALJASIM]`, {
			fullName: athlete.fullName,
			lastName: athlete.lastName,
			snatchRank,
			cleanJerkRank,
			totalRank,
			bestSnatch,
			bestCleanJerk,
			total,
			tp1,
			tp2,
			tp3,
			snatchCJTotal
		});
	}

	if (snatchCJTotal) {
		// Award points for snatch, clean & jerk, and total
		// Shared formula validates liftValue > 0 and teamMember before awarding points
		const snatchPoints = calculateTeamPoints(snatchRank, bestSnatch, teamMember, tp1, tp2, tp3);
		const cjPoints = calculateTeamPoints(cleanJerkRank, bestCleanJerk, teamMember, tp1, tp2, tp3);
		const totalPoints = calculateTeamPoints(totalRank, total, teamMember, tp1, tp2, tp3);
		
		if (athlete.lastName?.includes('ALJASIM') || athlete.fullName?.includes('ALJASIM') || athlete.fullName?.includes('aljasim')) {
			logger.debug(`[TeamPoints ALJASIM CALC]`, { snatchPoints, cjPoints, totalPoints, sum: snatchPoints + cjPoints + totalPoints });
		}
		
		points += snatchPoints;
		points += cjPoints;
		points += totalPoints;
	} else {
		// Award points only for total
		// Shared formula validates liftValue > 0 and teamMember before awarding points
		points += calculateTeamPoints(totalRank, total, teamMember, tp1, tp2, tp3);
	}

	return points;
}

/**
 * Compare athletes by score with session as tiebreaker
 * Primary: higher score first
 * Tiebreaker: smaller session number first (earlier session = higher priority)
 * 
 * @param {Object} a - First athlete
 * @param {Object} b - Second athlete
 * @param {Function} scoreFn - Function to get score from athlete
 * @returns {number} Comparison result
 */
function compareByScoreWithSessionTiebreaker(a, b, scoreFn) {
	const scoreA = scoreFn(a);
	const scoreB = scoreFn(b);
	
	// Primary sort: higher score first
	if (scoreB !== scoreA) {
		return scoreB - scoreA;
	}
	
	// Tiebreaker: smaller session number first (earlier session = higher priority)
	const sessionA = (a.group || a.sessionName || '').toString();
	const sessionB = (b.group || b.sessionName || '').toString();
	return sessionA.localeCompare(sessionB, undefined, { numeric: true });
}

/**
 * Determine top contributors for a team (for actual or predicted scores)
 * 
 * When scores are equal, athletes from earlier sessions have priority
 * (smaller session number = higher priority)
 * 
 * @param {Array} athletes - Array of TeamAthlete objects for this team
 * @param {string} gender - Gender filter ('M', 'F', or 'MF')
 * @param {Function} scoreFn - Function to get score from athlete
 * @param {Object} topCounts - Top score counts { topM, topF, topMFm, topMFf }
 * @returns {Set} Set of athlete keys for top contributors
 */
function findTopContributors(athletes, gender, scoreFn, topCounts = {}) {
	const { topM = 4, topF = 4, topMFm = 2, topMFf = 2 } = topCounts;
	let topContributors = [];
	
	if (gender === 'MF') {
		// Mixed: top N men + top N women (configurable)
		const males = athletes.filter(a => normalizeGender(a.gender) === 'M');
		const females = athletes.filter(a => normalizeGender(a.gender) === 'F');
		
		// Sort each gender by score (highest first), with session as tiebreaker
		males.sort((a, b) => compareByScoreWithSessionTiebreaker(a, b, scoreFn));
		females.sort((a, b) => compareByScoreWithSessionTiebreaker(a, b, scoreFn));
		
		topContributors = [...males.slice(0, topMFm), ...females.slice(0, topMFf)];
	} else if (gender === 'F') {
		// Female only: top N by score (configurable)
		const byScore = [...athletes].sort((a, b) => compareByScoreWithSessionTiebreaker(a, b, scoreFn));
		topContributors = byScore.slice(0, topF);
	} else {
		// Male only (default): top N by score (configurable)
		const byScore = [...athletes].sort((a, b) => compareByScoreWithSessionTiebreaker(a, b, scoreFn));
		topContributors = byScore.slice(0, topM);
	}
	
	// Use athleteKey for identification (OWLCMS unique key)
	return new Set(
		topContributors.map(a => normalizeKey(a.athleteKey ?? a.key)).filter(Boolean)
	);
}

/**
 * Group TeamAthletes by team and compute team scores
 * 
 * Team score = sum of top N contributors' actualScore (Sinclair)
 *   - Single gender M: top topM by actualScore
 *   - Single gender F: top topF by actualScore  
 *   - Mixed (MF): top topMFm men + top topMFf women by actualScore
 * 
 * All highlighting is precomputed as CSS class names on each athlete:
 *   - scoreHighlightClass: CSS class for actual score cell (e.g., 'top-contributor-m', 'top-contributor-f', 'top-contributor')
 *   - nextScoreHighlightClass: CSS class for predicted score cell
 * 
 * Athletes within team are sorted by: session, start number, lot number
 * Teams are sorted by: alphabetical team name when fixedTeamOrder is enabled, otherwise by team score
 * 
 * @param {Array} teamAthletes - Array of TeamAthlete objects
 * @param {string} gender - Gender filter ('M', 'F', or 'MF')
 * @param {Object} headers - Translated headers
 * @param {Object} topCounts - Top score counts { topM, topF, topMFm, topMFf }
 * @param {boolean} includeAllAthletes - Whether to include all athletes in team score
 * @param {Object} competition - Competition settings (for team points calculation)
 * @param {Object} options - Plugin options (e.g., teamPoints flag)
 * @returns {Array} Array of team objects ready for frontend display
 */
function groupByTeams(teamAthletes, gender, headers, topCounts = {}, includeAllAthletes = false, competition = {}, options = {}) {
	const { topM = 4, topF = 4, topMFm = 2, topMFf = 2 } = topCounts;
	const keepFixedTeamOrder = options.fixedTeamOrder !== false && options.fixedTeamOrder !== 'false';
	logger.debug(`[Team groupByTeams] Input: ${teamAthletes.length} athletes, gender filter: ${gender}, topCounts: M=${topM}, F=${topF}, MFm=${topMFm}, MFf=${topMFf}, includeAll=${includeAllAthletes}`);
	
	// Filter athletes with no team
	const athletesWithTeams = teamAthletes.filter(a => {
		const teamName = (a.teamName ?? a.team ?? '').toString().trim();
		return teamName.length > 0;
	});
	
	logger.debug(`[Team groupByTeams] After team filter: ${athletesWithTeams.length} athletes with teams`);
	
	// Filter by gender if not mixed
	const filteredAthletes = gender !== 'MF' 
		? athletesWithTeams.filter(a => normalizeGender(a.gender) === gender)
		: athletesWithTeams;
	
	logger.debug(`[Team groupByTeams] After gender filter: ${filteredAthletes.length} athletes`);
	
	// Group by team
	const teamMap = new Map();
	filteredAthletes.forEach(athlete => {
		const teamName = (athlete.teamName ?? athlete.team ?? '').toString().trim();
		if (!teamMap.has(teamName)) {
			teamMap.set(teamName, []);
		}
		teamMap.get(teamName).push(athlete);
	});
	
	// Build team objects with scores
	const teams = Array.from(teamMap.entries()).map(([teamName, allTeamAthletes]) => {
		// Filter out spacers
		const athletes = allTeamAthletes.filter(a => !a.isSpacer);
		
		// Determine scoring function based on scoringSystem
		const useTeamPoints = options.scoringSystem === 'TeamPoints';
		const scoringFunction = useTeamPoints 
			? (athlete) => calculateAthleteTeamPoints(athlete, competition)
			: getAthleteScore;
		
		// Find top contributors for ACTUAL score
		const actualTopContributors = findTopContributors(athletes, gender, scoringFunction, topCounts);
		
		// Find top contributors for PREDICTED score (may differ from actual!)
		// When using team points, predicted score is disabled (same as actual)
		const predictedTopContributors = useTeamPoints 
			? actualTopContributors
			: findTopContributors(athletes, gender, getAthletePredictedScore, topCounts);
		
		// Calculate team scores
		let teamScore = 0;
		let teamNextScore = 0;
		
		// For TeamPoints tiebreaker: count placements (1st, 2nd, 3rd, 4th places)
		let count1st = 0, count2nd = 0, count3rd = 0, count4th = 0;
		
		athletes.forEach(a => {
			const athleteKey = normalizeKey(a.athleteKey ?? a.key);
			if (actualTopContributors.has(athleteKey)) {
				const athletePoints = useTeamPoints ? calculateAthleteTeamPoints(a, competition) : getAthleteScore(a);
				teamScore += athletePoints;
				
				// Count placements for tiebreaker (only when using TeamPoints)
				if (useTeamPoints) {
					const snatchCJTotal = competition?.snatchCJTotalMedals || false;
					// Count 1st/2nd/3rd/4th places across all ranked lifts
					const ranksToCount = snatchCJTotal 
						? [a.snatchRank, a.cleanJerkRank, a.totalRank]
						: [a.totalRank];
					ranksToCount.forEach(rank => {
						const r = parseInt(rank, 10) || 0;
						if (r === 1) count1st++;
						else if (r === 2) count2nd++;
						else if (r === 3) count3rd++;
						else if (r === 4) count4th++;
					});
				}
			}
			if (predictedTopContributors.has(athleteKey)) {
				teamNextScore += useTeamPoints ? calculateAthleteTeamPoints(a, competition) : getAthletePredictedScore(a);
			}
		});
		
		// Add tiebreaker decimals to team score (not displayed, only used for sorting)
		// 0.1 per 1st place, 0.01 per 2nd, 0.001 per 3rd, 0.0001 per 4th
		if (useTeamPoints) {
			teamScore += count1st * 0.1 + count2nd * 0.01 + count3rd * 0.001 + count4th * 0.0001;
		}
		
		// Precompute highlight class names for each athlete
		const athletesWithHighlighting = athletes.map(a => {
			const athleteKey = normalizeKey(a.athleteKey ?? a.key);
			const isActualContributor = actualTopContributors.has(athleteKey);
			const isPredictedContributor = predictedTopContributors.has(athleteKey);
			const includedInTeamScore = includeAllAthletes || isActualContributor;
			const includedInProjectedTeamScore = includeAllAthletes || isPredictedContributor;
			const athleteGender = normalizeGender(a.gender);
			
			// Recalculate team points with actual competition settings (if using TeamPoints)
			const athleteTeamPoints = useTeamPoints ? calculateAthleteTeamPoints(a, competition) : a.teamPoints;
			const displayTeamPoints = athleteTeamPoints > 0 ? String(athleteTeamPoints) : '-';
			
			// Determine CSS class for actual score highlight
			let scoreHighlightClass = '';
			if (!includeAllAthletes && isActualContributor) {
				if (gender === 'MF') {
					// In MF mode, differentiate by gender
					scoreHighlightClass = athleteGender === 'F' ? 'top-contributor-f' : 'top-contributor-m';
				} else {
					scoreHighlightClass = 'top-contributor';
				}
			}
			
			// Determine CSS class for predicted score highlight
			let nextScoreHighlightClass = '';
			if (!includeAllAthletes && isPredictedContributor) {
				if (gender === 'MF') {
					nextScoreHighlightClass = athleteGender === 'F' ? 'top-contributor-f' : 'top-contributor-m';
				} else {
					nextScoreHighlightClass = 'top-contributor';
				}
			}
			
			return {
				...a,
				teamPoints: athleteTeamPoints,
				displayTeamPoints,
				includedInTeamScore,
				includedInProjectedTeamScore,
				scoreHighlightClass,
				nextScoreHighlightClass
			};
		});
		
		// Sort athletes within team by: session, start number, lot number
		athletesWithHighlighting.sort(compareAthletesForTeamOrder);
		
		// Count contributors (for display label)
		const contributorCount = actualTopContributors.size;
		
		// Build totalLabel using translations with placeholders
		// Tracker.TopMScores = "top {0} scores" for single gender
		// Tracker.TopMFScores = "top {0}+{1} scores" for mixed
		let totalLabel;
		if (includeAllAthletes) {
			totalLabel = '';
		} else if (gender === 'MF') {
			const template = headers?.topMFScores || 'top {0}+{1} scores';
			totalLabel = template.replace('{0}', topMFm).replace('{1}', topMFf);
		} else if (gender === 'F') {
			const template = headers?.topMScores || 'top {0} scores';
			totalLabel = template.replace('{0}', topF);
		} else {
			const template = headers?.topMScores || 'top {0} scores';
			totalLabel = template.replace('{0}', topM);
		}
		
		return {
			teamName,
			flagUrl: getFlagUrl({ teamName }),
			athletes: athletesWithHighlighting,
			athleteCount: athletes.length,
			// Label describing which athletes contribute to the team total
			totalLabel,
			teamScore,
			teamNextScore,
			contributorCount,
			contributorLabel: totalLabel
		};
	});
	
	if (keepFixedTeamOrder) {
		teams.sort((a, b) => a.teamName.localeCompare(b.teamName, undefined, { sensitivity: 'base' }));
	} else {
		// Sort teams by actual score (highest first), then by predicted score as tiebreaker
		teams.sort((a, b) => {
			const scoreDiff = b.teamScore - a.teamScore;
			if (scoreDiff !== 0) return scoreDiff;
			// Tiebreaker: team with better predicted score first
			return b.teamNextScore - a.teamNextScore;
		});
	}
	
	return teams;
}

// Timer and decision extraction now imported from shared module:
// import { extractTimers, computeDisplayMode, extractDecisionState } from '$lib/server/timer-decision-helpers.js';

// =============================================================================
// MAIN SCOREBOARD DATA FUNCTION
// =============================================================================

/**
 * Get formatted scoreboard data for SSR/API (SERVER-SIDE ONLY)
 * 
 * For team-based scoreboards:
 * - Uses session athletes from hub (already flattened, OWLCMS-computed values)
 * - Wraps each athlete with enrichment (sinclair, predictions)
 * - Groups by team and computes team scores
 * 
 * @param {string} fopName - FOP name (default: 'A')
 * @param {Object} options - User preferences
 * @returns {Object} Formatted data ready for browser consumption
 */
export function getScoreboardData(fopName = 'A', options = {}) {
	logger.debug(`[TeamScoreboard] ===== START getScoreboardData fop=${fopName}, scoringSystem=${options.scoringSystem} =====`);
	
	const fopUpdate = getFopUpdate(fopName);
	const databaseState = getDatabaseState();
	
	// Options - defaults are applied by the API from config.js
	// Fallbacks (using ??) are only for options that an extension might not define
	const showRecords = options.showRecords ?? false;
	const sortBy = 'score';
	const currentAttemptInfo = options.currentAttemptInfo ?? true;
	const scoringSystem = options.scoringSystem || 'Sinclair';
	// cjDecl: fallback to true if extension doesn't define it
	const includeCjDeclaration = options.cjDecl ?? true;
	// showPredicted: fallback to false if extension doesn't define it
	// When TeamPoints is selected, force showPredicted to false (team points don't have predicted values)
	const showPredicted = scoringSystem === 'TeamPoints' ? false : (options.showPredicted ?? false);
	const topN = options.topN ?? 0;
	const language = options.lang || options.language || 'no';
	const translations = competitionHub.getTranslations({ locale: language });
	const learningMode = process.env.LEARNING_MODE === 'true' ? 'enabled' : 'disabled';
	const competitionSinclairYear = getCompetitionSinclairYear(databaseState);
	const scoringConfig = {
		sinclairYear: competitionSinclairYear,
		smhfOverrideSinclairYear: resolveSinclairYearOption(options.smhfOverrideSinclairYear, competitionSinclairYear, DEFAULT_SMHF_SINCLAIR_YEAR),
		smhfAgeFactorYear: normalizeMastersAgeFactorYear(options.smhfAgeFactorYear, DEFAULT_SMHF_AGE_FACTOR_YEAR)
	};
	
	// enforceBombout: fallback to false if extension doesn't define it
	const enforceBombout = options.enforceBombout ?? false;
	
	// Options are the single source of truth (config defaults + URL overrides, applied by the API layer)
	const includeAllAthletes = options.allAthletes === true || options.allAthletes === 'true';
	const exportOnlyScoringAthletes = options.exportOnlyScoringAthletes !== false && options.exportOnlyScoringAthletes !== 'false';
	
	// Top score counts (from options, which already have config defaults applied)
	// When includeAllAthletes is true, use 10 for all counts (effectively includes everyone)
	const topCounts = includeAllAthletes ? {
		topM: 10,
		topF: 10,
		topMFm: 10,
		topMFf: 10
	} : {
		topM: parseInt(options.topM, 10) || 4,
		topF: parseInt(options.topF, 10) || 4,
		topMFm: parseInt(options.topMFm, 10) || 2,
		topMFf: parseInt(options.topMFf, 10) || 2
	};
	logger.debug(`[TeamScoreboard] includeAllAthletes=${includeAllAthletes}, topCounts: M=${topCounts.topM}, F=${topCounts.topF}, MFm=${topCounts.topMFm}, MFf=${topCounts.topMFf}`);
	const sessionStatus = competitionHub.getSessionStatus({ fopName });

	// Detect session gender from session athletes
	let helperDetectedGender = 'unknown';
	let helperDetectedAthlete = null;
	
	const sessionAthletes = getSessionAthletes(fopName);
	if (sessionAthletes.length > 0) {
		helperDetectedAthlete = sessionAthletes.find(a => a.fullName || a.startNumber) || sessionAthletes[0];
		helperDetectedGender = normalizeGender(helperDetectedAthlete?.gender) || normalizeGender(fopUpdate?.gender) || 'unknown';
	} else {
		helperDetectedGender = normalizeGender(fopUpdate?.gender) || 'unknown';
	}
	
	// Update last known gender if we detected one from the session
	if (helperDetectedGender && helperDetectedGender !== 'unknown') {
		lastKnownGenderByFop.set(fopName, helperDetectedGender);
	}
	
	// Get the last known gender for this FOP (may be undefined if never set)
	const lastKnownGender = lastKnownGenderByFop.get(fopName);
	
	logger.debug(`[Team helpers] Detected session athlete: "${helperDetectedAthlete?.fullName || 'none'}" gender: ${helperDetectedGender}, lastKnown: ${lastKnownGender || 'none'}`);

	// Track if we're in "current" mode with no gender history
	// This is used to show just the attempt bar when no session has run yet
	let noGenderHistory = false;

	// Resolve gender option
	// - Explicit URL parameter (M, F, MF) takes precedence
	// - 'current' uses detected gender from session, or last known, or shows minimal UI
	// - No option: use detected gender from session, or last known, or shows minimal UI
	let gender = 'M';
	
	if (options.gender === true) {
		// Legacy: gender=true means MF mode
		gender = 'MF';
	} else if (typeof options.gender === 'string') {
		const genderOption = String(options.gender).trim().toUpperCase();
		if (genderOption === 'CURRENT') {
			// Use detected gender, fall back to last known
			if (helperDetectedGender && helperDetectedGender !== 'unknown') {
				gender = helperDetectedGender;
			} else if (lastKnownGender) {
				gender = lastKnownGender;
			} else {
				// No session active and no previous session - show minimal UI
				noGenderHistory = true;
				gender = 'M'; // Default for any data we might show
			}
		} else if (genderOption === 'MF' || genderOption === 'M' || genderOption === 'F') {
			gender = genderOption === 'MF' ? 'MF' : normalizeGender(genderOption);
		} else {
			// Unknown option - treat as single gender or default
			gender = normalizeGender(options.gender) || lastKnownGender || 'M';
		}
	} else {
		// No explicit option: use detected gender, fall back to last known
		if (helperDetectedGender && helperDetectedGender !== 'unknown') {
			gender = helperDetectedGender;
		} else if (lastKnownGender) {
			gender = lastKnownGender;
		} else {
			// No session active and no previous session - show minimal UI
			noGenderHistory = true;
			gender = 'M'; // Default for any data we might show
		}
	}

	// Determine if we're actually in mixed-gender mode (explicit MF request)
	// Only show "2+2" text when user explicitly requests MF mode via URL parameter
	const isExplicitMixedMode = typeof options.gender === 'string' && 
		String(options.gender).trim().toUpperCase() === 'MF';

	// Helper to substitute {0}, {1}, etc. placeholders in translation strings
	const formatTranslation = (template, ...args) => {
		if (!template) return '';
		return args.reduce((str, arg, i) => str.replace(`{${i}}`, arg), template);
	};

	// Build headers from translations (all from OWLCMS, using Tracker.* keys for new ones)
	const headers = {
		order: translations['Tracker.Order'] || translations.Start || translations.Order || 'Order',
		membership: translations['Results.Membership'] || translations.Membership || 'Membership',
		name: translations.Name || 'Name',
		category: translations.Category || 'Cat.',
		bodyWeight: translations['Results.BodyWeight'] || translations['Scoreboard.BodyWeight'] || translations.BodyWeight || 'B.W.',
		birth: translations['Scoreboard.Birth'] || translations.Birth || 'Born',
		team: translations.Team || 'Team',
		snatch: translations.Snatch || 'Snatch',
		cleanJerk: translations.Clean_and_Jerk || 'Clean & Jerk',
		total: translations['Scoreboard.Total'] || translations.TOTAL || 'Total',
		score: translations.Score || 'Score',
		best: translations.Best || '✔',
		rank: translations.Rank || 'Rank',
		session: translations['Tracker.Session'] || translations.Session || 'Session',
		scoringSystem: translations['Tracker.ScoringSystem'] || translations.ScoringSystems || 'Scoring System',
		// Translation templates for top scores labels
		topMScores: translations['Tracker.TopNScores'] || 'top {0} scores',
		topMFScores: translations['Tracker.TopNPlusNScores'] || 'top {0}+{1} scores',
		totalNextS: translations['Tracker.TotalNextScore'] || 'Total Next S',
		scoreNextS: translations['Tracker.ScoreNextScore'] || 'Score Next S',
		waitingForData: translations['Tracker.WaitingForData'] || 'Waiting for competition data...',
		noCompetitionData: translations['Tracker.WaitingForData'] || 'Waiting for competition data...',
		noAthleteLifting: translations['Tracker.NoAthleteLifting'] || 'No athlete currently lifting'
	};

	// Early return for waiting states - but only if we have NO data at all
	// If we have database data, show it even without an active session
	if (!fopUpdate && !databaseState) {
		return {
			competition: { name: headers.noCompetitionData, fop: 'unknown' },
			currentAthlete: null,
			timer: { state: 'stopped', timeRemaining: 0 },
			sessionStatus: { isDone: false, sessionName: '', lastActivity: 0 },
			teams: [],
			headers,
			status: 'waiting',
			message: headers.waitingForData,
			learningMode
		};
	}
	
	// If gender=Current (or no explicit gender) and no session history exists,
	// return minimal UI showing just the attempt bar without team data
	// This avoids showing arbitrary gender data before any session has started
	// unless we have database data to show.
	if (noGenderHistory && helperDetectedGender === 'unknown' && (!databaseState?.athletes || databaseState.athletes.length === 0)) {
		logger.debug(`[Team helpers] No gender history, no active session, and no database data - showing minimal UI`);
		const { timer, breakTimer } = extractTimers(fopUpdate, language);
		const decision = extractDecisionState(fopUpdate);
		const { displayMode, displayClass, activeTimer } = computeDisplayMode(timer, breakTimer, decision);
		
		// Build platform label for session info
		const platformLabel = translations.Platform || 'Platform';
		const platformSessionInfo = `${platformLabel} ${fopName}`;
		
		return {
			competition: { 
				name: databaseState?.competition?.competitionName || fopUpdate?.competitionName || 'Competition', 
				fop: fopName,
				sessionInfo: platformSessionInfo,
				showWeight: false,
				showTimer: true,
				showLiftType: false
			},
			currentAthlete: null,
			timer: activeTimer,
			breakTimer,
			decision,
			displayMode,
			displayClass,
			sessionStatus: { isDone: false, sessionName: platformSessionInfo, lastActivity: 0 },
			teams: [],
			headers,
			hideHeaders: true,  // Signal to hide table headers when no data
			status: 'waiting_for_session',
			message: headers.noAthleteLifting || 'No athlete currently lifting',
			hasCurrentAthlete: false,
			attemptBarClass: 'hide-because-null-session',  // Always hide when no active session
			gender,
			learningMode
		};
	}
	
	// If gender was auto-detected (not explicitly set via URL) and no session is active,
	// default to 'M' to show men from database. Do NOT override explicit MF request.
	// isExplicitMixedMode is true when user explicitly set gender=MF in URL
	if (gender === 'MF' && !isExplicitMixedMode && helperDetectedGender === 'unknown' && databaseState?.athletes?.length > 0) {
		gender = 'M';
		logger.debug(`[Team helpers] No active session, defaulting to M (show men from database)`);
	}

	// Check cache - include hub FOP version and resolved gender in cache key
	// Determine platform state early (needed for cache hit path)
	// fopState values: INACTIVE, BREAK, CURRENT_ATHLETE, TIME_STARTED, TIME_STOPPED, DOWN_SIGNAL, DECISION_VISIBLE, etc.
	// Any fopState other than INACTIVE means we have an active session
	const platformState = fopUpdate?.fopState || 'INACTIVE';
	const hasActiveSession = platformState !== 'INACTIVE';
	
	// Also include whether a session is selected (sessionName present) so null-session switches invalidate cache
	const sessionKeyState = (fopUpdate?.sessionName != null && fopUpdate?.sessionName !== '') ? 'session' : 'no-session';
	const cacheKey = buildCacheKey({
		fopName,
		includeFop: true,
		opts: {
			gender,
			sessionKeyState,
			...options,
			resolvedSinclairYear: scoringConfig.sinclairYear,
			resolvedSmhfOverrideSinclairYear: scoringConfig.smhfOverrideSinclairYear,
			resolvedSmhfAgeFactorYear: scoringConfig.smhfAgeFactorYear
		}
	});
	logger.debug(`[Team helpers] Cache check: key=${String(cacheKey).substring(0, 120)}..., gender=${gender}`);
	logger.debug(`[Team helpers] Debug state: fopState=${fopUpdate?.fopState}, currentAthleteKey=${fopUpdate?.currentAthleteKey}, sessionName=${fopUpdate?.sessionName}`);
	
	if (teamScoreboardCache.has(cacheKey)) {
		const cached = teamScoreboardCache.get(cacheKey);
		logger.debug(`[Team helpers] Cache HIT - returning cached data with ${cached.teams?.length || 0} teams`);
		let sessionStatusMessage = null;
		if (sessionStatus.isDone && fopUpdate?.fullName) {
			sessionStatusMessage = (fopUpdate.fullName || '').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—');
		}
		
		// Extract timers and compute display mode (what should be visible)
		const { timer, breakTimer } = extractTimers(fopUpdate, language);
		const decision = extractDecisionState(fopUpdate);
		const { displayMode, displayClass, activeTimer } = computeDisplayMode(timer, breakTimer, decision);
		
		// Determine attempt bar visibility based on session and athlete state
		const attemptBarClass = computeAttemptBarVisibility(fopUpdate);
		const hasCurrentAthleteFlag = hasCurrentAthlete(fopUpdate, sessionStatus);
		
		logAttemptBarDebug(fopUpdate, sessionStatus, 'Team helpers [cache HIT]');

		// Extract current attempt using shared function (handles break mode)
		const currentAttempt = extractCurrentAttempt(fopUpdate, language);
		const mode = fopUpdate?.mode || 'WAIT';
		const breakTitle = isBreakMode(mode) ? inferGroupName(fopUpdate, language) : null;

		// Build fresh competition object (never cached) with current session info
		// Need to determine lift type for sessionInfo
		const liftTypeKey = fopUpdate?.liftTypeKey || 'Snatch';
		const liftType = liftTypeKey === 'Snatch' ? 'snatch' : 'cleanJerk';
		
		// Use shared buildSessionInfo for consistent formatting across all scoreboards
		const hasSessionName = fopUpdate?.sessionName != null && fopUpdate?.sessionName !== '';
		const sessionInfo = hasSessionName ? buildSessionInfo(fopUpdate, language) : '&nbsp;';

		// Determine if there's a current athlete in the cache hit path
		const hasCurrentAthleteForCompetition = hasCurrentAthlete(fopUpdate, sessionStatus);

		return {
			...cached,
			competition: {
				name: fopUpdate?.competitionName || databaseState?.competition?.name || 'Competition',
				fop: fopName,
				state: platformState,
				session: hasSessionName ? (fopUpdate?.sessionName || '') : '',
				liftType: hasActiveSession ? liftType : null,
				sessionInfo,
				// Visibility flags - must match cache miss path
				showWeight: hasCurrentAthleteForCompetition,
				showTimer: hasActiveSession,
				showLiftType: hasActiveSession
			},
			currentAttempt,
			breakTitle,
			timer: activeTimer,
			breakTimer,
			displayMode,
			displayClass,
			decision,
			sessionStatus,
			sessionStatusMessage,
			isBreak: fopUpdate?.break === 'true' || isBreakMode(mode),
			hasCurrentAthlete: hasCurrentAthleteFlag,
			attemptBarClass,
			learningMode
		};
	}
	
	logger.debug(`[Team helpers] Cache MISS - computing data for gender=${gender}`);

	// Determine current lift type
	const liftTypeKey = fopUpdate?.liftTypeKey || 'Snatch';
	const liftType = liftTypeKey === 'Snatch' ? 'snatch' : 'cleanJerk';
	const liftTypeLabel = liftType === 'snatch' 
		? (translations.Snatch || 'Snatch') 
		: (translations.Clean_and_Jerk || 'Clean & Jerk');
	
	// Build lifting order map for ordering info (keyed by athleteKey)
	const liftingOrderMap = new Map();
	if (Array.isArray(fopUpdate?.liftingOrderAthletes)) {
		let orderPosition = 1;
		for (const entry of fopUpdate.liftingOrderAthletes) {
			if (!entry || entry.isSpacer) continue;
			const athleteKey = normalizeKey(entry.athleteKey ?? entry.key);
			if (athleteKey && !liftingOrderMap.has(athleteKey)) {
				liftingOrderMap.set(athleteKey, orderPosition);
			}
			orderPosition += 1;
		}
	}
	
	// =========================================================================
	// LAYER 2: Build ALL team athletes (session + database)
	// Session athletes have live data, database athletes have historical data
	// =========================================================================
	
	// enforceBombout is read from URL parameters (see above)
	// When true (IWF rule), athletes who fail all 3 attempts in snatch or C&J get total=0
	
	// Build session athletes map by key (for merging)
	const sessionAthletesByKey = new Map();
	
	// Only use session athletes if we have an active session
	if (hasActiveSession) {
		sessionAthletes
			.filter(athlete => !athlete.isSpacer)
			.forEach(sessionAthlete => {
				const athleteKey = normalizeKey(sessionAthlete.athleteKey ?? sessionAthlete.key);
				if (athleteKey) {
					sessionAthletesByKey.set(athleteKey, sessionAthlete);
				}
			});
		// DEBUG: Log first few session keys to compare with database keys
		const sessionKeys = Array.from(sessionAthletesByKey.keys()).slice(0, 3);
		logger.warn(`[Team DEBUG] Session athlete keys (first 3): ${JSON.stringify(sessionKeys)}`);
	} else {
		logger.warn(`[Team DEBUG] hasActiveSession is FALSE, platformState=${platformState}`);
	}
	
	// Process ALL database athletes - use session data if available, else database data
	const allTeamAthletes = [];
	
	logger.debug(`[Team helpers] Database has ${databaseState?.athletes?.length || 0} athletes, session has ${sessionAthletesByKey.size} athletes`);
	
	if (databaseState?.athletes && Array.isArray(databaseState.athletes)) {
		// DEBUG: Log first few database keys
		const dbKeys = databaseState.athletes.slice(0, 3).map(a => normalizeKey(a.key));
		logger.warn(`[Team DEBUG] Database athlete keys (first 3): ${JSON.stringify(dbKeys)}`);
		
		for (const dbAthlete of databaseState.athletes) {
			const athleteKey = normalizeKey(dbAthlete.key);
			if (!athleteKey) {
				logger.debug(`[Team helpers] Skipping athlete with no key:`, dbAthlete?.lastName);
				continue;
			}
			
			// Check if this athlete is in the current session
			const sessionAthlete = sessionAthletesByKey.get(athleteKey);
			
			if (sessionAthlete) {
				// DEBUG: Check if classname is present in session athlete
				if (sessionAthlete.classname && sessionAthlete.classname !== '') {
					logger.warn(`[Team DEBUG] Session athlete ${sessionAthlete.fullName} has classname: "${sessionAthlete.classname}", liftingOrder: ${liftingOrderMap.get(athleteKey)}`);
				}
				// Athlete is in current session - use session data (has live updates)
				const wrapped = teamAthleteFromSession(sessionAthlete, {
					liftType,
					liftingOrder: liftingOrderMap.get(athleteKey) ?? null,
					bodyWeight: dbAthlete.bodyWeight || sessionAthlete.bodyWeight || 0,
					includeCjDeclaration
					// NOTE: enforceBombout and scoringSystem are applied in Layer 2.5 (applyScoring)
				});
				allTeamAthletes.push(wrapped);
			} else {
				// Athlete is NOT in current session - use database data
				const wrapped = teamAthleteFromDatabase(dbAthlete, {
					liftingOrder: null, // Not in current lifting order
					includeCjDeclaration
					// NOTE: enforceBombout and scoringSystem are applied in Layer 2.5 (applyScoring)
				});
				if (wrapped) {
					allTeamAthletes.push(wrapped);
				} else {
					logger.debug(`[Team helpers] teamAthleteFromDatabase returned null for:`, dbAthlete?.lastName);
				}
			}
		}
	}
	
	logger.debug(`[Team helpers] Built ${allTeamAthletes.length} team athletes from database`);
	
	// =========================================================================
	// LAYER 2.5: Apply scoring (bombout rule + score computation)
	// This is where enforceBombout is applied to convert raw values to actual/display
	// =========================================================================
	const scoringContext = {
		enforceBombout,
		scoringSystem,
		scoringConfig
	};
	const scoredAthletes = applyScoring(allTeamAthletes, scoringContext);
	
	logger.debug(`[Team helpers] Applied scoring to ${scoredAthletes.length} athletes (enforceBombout=${enforceBombout})`);
	
	// Add flag URLs
	const athletesWithFlags = scoredAthletes.map(athlete => ({
		...athlete,
		flagUrl: athlete.flagUrl || athlete.flagURL || getFlagUrl({ teamName: athlete.teamName || athlete.team })
	}));
	
	// Extract competition settings (needed for team points calculation)
	const competitionSettings = {
		teamPoints1st: databaseState?.competition?.teamPoints1st || 28,
		teamPoints2nd: databaseState?.competition?.teamPoints2nd || 25,
		teamPoints3rd: databaseState?.competition?.teamPoints3rd || 23,
		snatchCJTotalMedals: databaseState?.competition?.snatchCJTotalMedals || false,
		enforceBombout // Passed for reference (already applied in scoring)
	};
	
	// =========================================================================
	// LAYER 3: Group by teams
	// =========================================================================
	const teams = groupByTeams(athletesWithFlags, gender, headers, topCounts, includeAllAthletes, competitionSettings, options);
	
	logger.debug(`[Team helpers] Grouped ${allTeamAthletes.length} athletes into ${teams.length} teams (gender=${gender})`);
	if (teams.length > 0) {
		teams.forEach(t => logger.debug(`[Team helpers]   Team "${t.teamName}": ${t.athleteCount} athletes, score=${t.teamScore?.toFixed(2)}`));
	}
	
	// Determine if there's a current athlete lifting
	const hasCurrentAthleteFlag = hasCurrentAthlete(fopUpdate, sessionStatus);
	
	// Check if a session is selected: OWLCMS clears currentAthleteKey when session is null
	// Use currentAthleteKey + fopState to determine session status
	const hasCurrentAthleteKey = Boolean(fopUpdate?.currentAthleteKey);
	const hasSessionSelected = hasCurrentAthleteKey || (platformState !== 'INACTIVE');
	
	// Build sessionInfo only when session is selected; otherwise blank
	// Use shared buildSessionInfo for consistent formatting across all scoreboards
	const sessionInfo = (hasSessionSelected && fopUpdate?.sessionName)
		? buildSessionInfo(fopUpdate, language)
		: '&nbsp;';
	
	// Extract competition info
	const competition = {
		name: fopUpdate?.competitionName || databaseState?.competition?.name || 'Competition',
		fop: fopName,
		state: platformState,
		// Only show session name if a session is actually selected (sessionName/currentAthleteKey present)
		session: hasSessionSelected ? (fopUpdate?.sessionName || '') : '',
		liftType: hasActiveSession ? liftType : null,
		sessionInfo,
		// Visibility flags - no logic in svelte, all controlled here
		// showTimer: true if fopState indicates active competition (not INACTIVE)
		showWeight: hasCurrentAthleteFlag,
		showTimer: hasActiveSession,
		showLiftType: hasActiveSession
	};

	// If no active session, clear start numbers for all athletes
	if (!hasActiveSession) {
		teams.forEach(team => {
			team.athletes.forEach(athlete => {
				athlete.startNumber = '';
			});
		});
	}
	
	// Extract current attempt using shared function (handles break mode)
	const currentAttempt = extractCurrentAttempt(fopUpdate, language);
	const mode = fopUpdate?.mode || 'WAIT';
	const breakTitle = isBreakMode(mode) ? inferGroupName(fopUpdate, language) : null;
	
	// Session done message (separate from currentAttempt)
	let sessionStatusMessage = null;
	if (sessionStatus.isDone && fopUpdate?.fullName) {
		sessionStatusMessage = (fopUpdate.fullName || '').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—');
	}

	// Extract timers and compute display mode
	const { timer, breakTimer } = extractTimers(fopUpdate, language);
	const decision = extractDecisionState(fopUpdate);
	const { displayMode, displayClass, activeTimer } = computeDisplayMode(timer, breakTimer, decision);
	
	// Compute max team name length for responsive layout
	const maxTeamNameLength = Math.max(0, ...teams.map(t => (t.teamName || '').length));
	const compactTeamColumn = maxTeamNameLength < 7;

	const responseOptions = {
		showRecords,
		sortBy,
		gender: options.gender !== undefined ? options.gender : undefined,
		currentAttemptInfo,
		showPredicted,
		topN,
		cjDecl: includeCjDeclaration,
		scoringSystem,
		smhfOverrideSinclairYear: scoringConfig.smhfOverrideSinclairYear,
		smhfAgeFactorYear: scoringConfig.smhfAgeFactorYear,
		allAthletes: includeAllAthletes,
		exportOnlyScoringAthletes
	};

	// Show attempt bar unless inactive with no currentAthleteKey (covers breaks)
	// Note: hasCurrentAthleteKey already defined above for session info logic
	let attemptBarClass = '';
	if (!hasActiveSession && !hasCurrentAthleteKey) {
		attemptBarClass = 'hide-because-null-session';
	}

	const result = {
		competition,
		currentAttempt,
		hasCurrentAthlete: hasCurrentAthleteFlag,
		attemptBarClass,
		breakTitle,  // Group name during breaks
		detectedAthlete: {
			fullName: helperDetectedAthlete?.fullName || helperDetectedAthlete?.startNumber || null,
			gender: helperDetectedGender || null
		},
		timer: activeTimer,
		breakTimer,
		displayMode,
		displayClass,
		sessionStatusMessage,
		teams,
		allAthletes: athletesWithFlags,
		stats: getCompetitionStats(databaseState),
		headers,
		displaySettings: fopUpdate?.showTotalRank || fopUpdate?.showSinclair ? {
			showTotalRank: fopUpdate.showTotalRank === 'true',
			showSinclair: fopUpdate.showSinclair === 'true',
			showLiftRanks: fopUpdate.showLiftRanks === 'true',
			showSinclairRank: fopUpdate.showSinclairRank === 'true'
		} : {},
		isBreak: fopUpdate?.break === 'true' || isBreakMode(mode),
		breakType: fopUpdate?.breakType,
		sessionStatus,
		compactTeamColumn,
		status: (fopUpdate || databaseState) ? 'ready' : 'waiting',
		lastUpdate: fopUpdate?.lastUpdate || Date.now(),
		options: responseOptions
	};
	
	// Cache result (excluding frequently changing fields)
	teamScoreboardCache.set(cacheKey, {
		// NOTE: competition object is NOT cached because it contains session-dependent fields
		// sessionInfo and session change based on current sessionName, so we recompute them
		// on every request even if everything else is cached
		currentAttempt: result.currentAttempt,
		hasCurrentAthlete: hasCurrentAthleteFlag,
		attemptBarClass: result.attemptBarClass,
		detectedAthlete: result.detectedAthlete,
		teams: result.teams,
		allAthletes: result.allAthletes,
		stats: result.stats,
		displaySettings: result.displaySettings,
		headers: result.headers,
		isBreak: result.isBreak,
		breakType: result.breakType,
		status: result.status,
		lastUpdate: result.lastUpdate,
		options: responseOptions
	});
	
	logger.debug(`[Team] Cache now has ${teamScoreboardCache.size} entries`);
    
	// Cleanup old cache entries (keep last 3)
	// Null out large objects before deletion to help V8 GC
	if (teamScoreboardCache.size > 3) {
		const firstKey = teamScoreboardCache.keys().next().value;
		const expiredEntry = teamScoreboardCache.get(firstKey);
		if (expiredEntry) {
			// Null out large arrays to help GC
			if (expiredEntry.teams) expiredEntry.teams = null;
			if (expiredEntry.allAthletes) expiredEntry.allAthletes = null;
		}
		teamScoreboardCache.delete(firstKey);
	}

	const finalResult = {
		...result,
		sessionStatus,
		decision,
		learningMode
	};

	// ALWAYS ensure competition object is fresh (never cached)
	// because it contains session-dependent fields like sessionInfo and session
	if (!finalResult.competition) {
		finalResult.competition = result.competition;
	}

	return finalResult;
}

/**
 * Create a waiting response for when session data is not available
 */
function createWaitingResponse(fopName, fopUpdate, databaseState, headers, learningMode, gender, currentAttemptInfo, topN, showRecords, sortBy) {
	return {
		competition: { name: fopUpdate?.competitionName || databaseState?.competition?.name || 'Competition', fop: fopName },
		currentAttempt: null,
		detectedAthlete: { fullName: null, gender: null },
		timer: { state: 'stopped', timeRemaining: 0 },
		sessionStatus: { isDone: false, sessionName: '', lastActivity: 0 },
		teams: [],
		headers,
		status: 'waiting',
		hasCurrentAthlete: false,
		attemptBarClass: 'hide-because-null-session',
		learningMode,
		options: { showRecords, sortBy, gender, currentAttemptInfo, topN }
	};
}

// =============================================================================
// STATISTICS AND UTILITIES
// =============================================================================

/**
 * Get competition statistics
 */
export function getCompetitionStats(competitionState = null) {
	if (!competitionState) {
		competitionState = getDatabaseState();
	}
	
	if (!competitionState?.athletes) {
		return {
			totalAthletes: 0,
			activeAthletes: 0,
			completedAthletes: 0,
			categories: [],
			teams: []
		};
	}

	const athletes = competitionState.athletes;
	const categories = [...new Set(athletes.map(a => a.categoryName || a.category).filter(Boolean))];
	const teamsSet = [...new Set(athletes.map(a => a.teamName || a.team).filter(Boolean))];

	return {
		totalAthletes: athletes.length,
		activeAthletes: athletes.filter(a => a.total > 0 || a.bestSnatch > 0 || a.bestCleanJerk > 0).length,
		completedAthletes: athletes.filter(a => a.total > 0).length,
		categories,
		teams: teamsSet,
		averageTotal: athletes.filter(a => a.total > 0).reduce((sum, a, _, arr) => sum + a.total / arr.length, 0) || 0
	};
}

/**
 * Get top athletes from competition state
 */
export function getTopAthletes(competitionState, limit = 10) {
	if (!competitionState?.athletes || !Array.isArray(competitionState.athletes)) {
		return [];
	}

	return competitionState.athletes
		.filter(athlete => athlete && (athlete.total > 0 || athlete.bestSnatch > 0 || athlete.bestCleanJerk > 0))
		.sort((a, b) => {
			const totalA = a.total || 0;
			const totalB = b.total || 0;
			if (totalA !== totalB) return totalB - totalA;
			
			const sinclairA = a.sinclair || 0;
			const sinclairB = b.sinclair || 0;
			if (sinclairA !== sinclairB) return sinclairB - sinclairA;
			
			return (b.bestSnatch || 0) - (a.bestSnatch || 0);
		})
		.slice(0, limit);
}

/**
 * Get team rankings
 */
export function getTeamRankings() {
	return competitionHub.getTeamRankings();
}

// =============================================================================
// PLUGIN ACTIONS
// =============================================================================

/**
 * Handle plugin actions (e.g., Excel export)
 * @param {Object} params - Action parameters
 * @param {string} params.action - Action name ('exportScoreboard' or 'exportFlat')
 * @param {Object} params.options - Options including platform, scoringSystem, gender, etc.
 * @returns {Promise<Object>} Result object with success status or binary data
 */
export async function handleAction({ action, options }) {
	if (action === 'exportScoreboard' || action === 'exportFlat') {
		try {
			// Dynamically import exceljs (externalized dependency)
			let ExcelJS;
			try {
				const module = await import('exceljs');
				// Handle both ESM default export and direct export
				ExcelJS = module.default || module;
			} catch (importErr) {
				return {
					success: false,
					error: 'missing_dependency',
					message: 'ExcelJS is not installed. Run: npm install exceljs'
				};
			}

			// Get the scoreboard data using the same logic as the display
			const fopName = options.platform || options.fop;
			if (!fopName) {
				return {
					success: false,
					error: 'missing_fop',
					message: 'Platform/FOP parameter is required'
				};
			}

			logger.warn(
				`[Team Scoreboard][Excel] action=${action} fop=${fopName} language=${options.lang || options.language || 'no'}`
			);

			const data = await getScoreboardData(fopName, options);
			if (!data || !data.teams) {
				return {
					success: false,
					error: 'no_data',
					message: 'No team data available for this platform'
				};
			}

			// Create workbook
			const workbook = new ExcelJS.Workbook();
			workbook.creator = 'OWLCMS Tracker';
			workbook.created = new Date();

			const worksheet = workbook.addWorksheet('Team Results');

			if (action === 'exportScoreboard') {
				// Scoreboard format: team-grouped with merged headers
				return await generateScoreboardFormat(workbook, worksheet, data, options);
			} else {
				// Flat format: one row per athlete
				return await generateFlatFormat(workbook, worksheet, data, options);
			}
		} catch (error) {
			logger.error('[Team Scoreboard] Excel export error:', error.message);
			return {
				success: false,
				error: 'export_failed',
				message: error.message
			};
		}
	}

	return {
		success: false,
		error: 'unknown_action',
		message: `Unknown action: ${action}`
	};
}

function shouldExportOnlyScoringAthletes(options = {}) {
	return options.exportOnlyScoringAthletes !== false && options.exportOnlyScoringAthletes !== 'false';
}

function getExportTeamAthletes(team, options = {}) {
	const athletes = team?.athletes || [];
	if (!shouldExportOnlyScoringAthletes(options)) {
		return athletes;
	}

	return athletes.filter((athlete) => athlete.includedInTeamScore);
}

/**
 * Generate scoreboard format Excel (team-grouped with merged headers)
 */
async function generateScoreboardFormat(workbook, worksheet, data, options) {
	const { teams, headers, competition } = data;
	const scoringSystem = options.scoringSystem || 'Sinclair';

	// Column widths (no header text — we build the 2-row header manually)
	// Cols: 1=Membership, 2=Name, 3=Cat, 4=Bodyweight, 5=Born, 6=Team, 7-9=Sn1-3, 10=BestSn, 11-13=CJ1-3, 14=BestCJ, 15=Total, 16=Score
	const colWidths = [14, 25, 10, 10, 8, 20, 8, 8, 8, 10, 8, 8, 8, 10, 10, 12];
	colWidths.forEach((w, i) => { worksheet.getColumn(i + 1).width = w; });

	const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
	const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
	const headerBorder = {
		top: { style: 'thin' }, bottom: { style: 'thin' },
		left: { style: 'thin' }, right: { style: 'thin' }
	};
	const centerAlign = { vertical: 'middle', horizontal: 'center' };

	// --- Row 1: group headers with merges ---
	// MEMBERSHIP (merge rows 1-2)
	worksheet.mergeCells(1, 1, 2, 1);
	// NAME (merge rows 1-2)
	worksheet.mergeCells(1, 2, 2, 2);
	// CATEGORY (merge rows 1-2)
	worksheet.mergeCells(1, 3, 2, 3);
	// BODYWEIGHT (merge rows 1-2)
	worksheet.mergeCells(1, 4, 2, 4);
	// BORN (merge rows 1-2)
	worksheet.mergeCells(1, 5, 2, 5);
	// TEAM (merge rows 1-2)
	worksheet.mergeCells(1, 6, 2, 6);
	// SNATCH group (cols 7-10 in row 1)
	worksheet.mergeCells(1, 7, 1, 10);
	// CLEAN&JERK group (cols 11-14 in row 1)
	worksheet.mergeCells(1, 11, 1, 14);
	// TOTAL (merge rows 1-2)
	worksheet.mergeCells(1, 15, 2, 15);
	// SCORE (merge rows 1-2)
	worksheet.mergeCells(1, 16, 2, 16);

	const row1 = worksheet.getRow(1);
	row1.getCell(1).value = headers?.membership || 'Membership';
	row1.getCell(2).value = headers?.name || 'Name';
	row1.getCell(3).value = headers?.category || 'Cat.';
	row1.getCell(4).value = headers?.bodyWeight || 'B.W.';
	row1.getCell(5).value = headers?.birth || 'Born';
	row1.getCell(6).value = headers?.team || 'Team';
	row1.getCell(7).value = headers?.snatch || 'Snatch';
	row1.getCell(11).value = headers?.cleanJerk || 'Clean & Jerk';
	row1.getCell(15).value = headers?.total || 'Total';
	row1.getCell(16).value = headers?.score || 'Score';

	// Style row 1
	for (let col = 1; col <= 16; col++) {
		const cell = row1.getCell(col);
		cell.fill = headerFill;
		cell.font = headerFont;
		cell.alignment = centerAlign;
		cell.border = headerBorder;
	}

	// --- Row 2: sub-headers for attempt columns ---
	const row2 = worksheet.getRow(2);
	row2.getCell(7).value = '1';
	row2.getCell(8).value = '2';
	row2.getCell(9).value = '3';
	row2.getCell(10).value = headers?.best || '✔';
	row2.getCell(11).value = '1';
	row2.getCell(12).value = '2';
	row2.getCell(13).value = '3';
	row2.getCell(14).value = headers?.best || '✔';

	for (let col = 1; col <= 16; col++) {
		const cell = row2.getCell(col);
		cell.fill = headerFill;
		cell.font = headerFont;
		cell.alignment = centerAlign;
		cell.border = headerBorder;
	}

	let currentRow = 3;

	// Add each team
	for (const team of teams) {
		const teamAthletes = getExportTeamAthletes(team, options);
		if (teamAthletes.length === 0) {
			continue;
		}

		// Team header row (merged across name columns)
		const teamRow = worksheet.getRow(currentRow);
		worksheet.mergeCells(currentRow, 1, currentRow, 6); // Merge Membership through Team columns
		
		const teamCell = teamRow.getCell(1);
		teamCell.value = team.teamName;
		teamCell.font = { bold: true, size: 12 };
		teamCell.fill = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: 'FFE7E6E6' }
		};
		teamCell.alignment = { vertical: 'middle', horizontal: 'left' };
		
		// Team score in the Score column
		const scoreCell = teamRow.getCell(16); // Score column
		scoreCell.value = team.teamScore;
		scoreCell.font = { bold: true, size: 12 };
		scoreCell.fill = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: 'FFE7E6E6' }
		};
		scoreCell.alignment = { vertical: 'middle', horizontal: 'right' };
		scoreCell.numFmt = scoringSystem === 'TeamPoints' ? '0' : '0.00';

		// Apply borders to team header row
		for (let col = 1; col <= 16; col++) {
			teamRow.getCell(col).border = {
				top: { style: 'thin' },
				bottom: { style: 'thin' },
				left: { style: 'thin' },
				right: { style: 'thin' }
			};
		}

		currentRow++;

		// Add athlete rows
		for (const athlete of teamAthletes) {
			const row = worksheet.getRow(currentRow);
			
			row.getCell(1).value = getAthleteMembership(athlete);
			row.getCell(2).value = athlete.fullName || '';
			row.getCell(3).value = athlete.category || '';
			const bodyWeightCell = row.getCell(4);
			bodyWeightCell.value = getAthleteBodyWeight(athlete);
			bodyWeightCell.alignment = { horizontal: 'right' };
			bodyWeightCell.numFmt = '0.00';
			row.getCell(5).value = athlete.yearOfBirth || '';
			row.getCell(6).value = athlete.teamName || '';
			
			// Attempts - format with strikethrough for failed lifts
			const sattempts = athlete.sattempts || [];
			const cattempts = athlete.cattempts || [];
			
			for (let i = 0; i < 3; i++) {
				const snCell = row.getCell(7 + i);
				const attempt = sattempts[i];
				snCell.alignment = { horizontal: 'right' };
				if (attempt && attempt.stringValue && attempt.stringValue !== '\u00A0') {
					snCell.value = attempt.stringValue;
					if (attempt.liftStatus === 'bad') {
						snCell.font = { strike: true, color: { argb: 'FFFF0000' } };
					}
				}
			}
			
			const bestSnCell = row.getCell(10);
			bestSnCell.value = athlete.bestSnatch || '';
			bestSnCell.alignment = { horizontal: 'right' };
			bestSnCell.font = { bold: true };
			
			for (let i = 0; i < 3; i++) {
				const cjCell = row.getCell(11 + i);
				const attempt = cattempts[i];
				cjCell.alignment = { horizontal: 'right' };
				if (attempt && attempt.stringValue && attempt.stringValue !== '\u00A0') {
					cjCell.value = attempt.stringValue;
					if (attempt.liftStatus === 'bad') {
						cjCell.font = { strike: true, color: { argb: 'FFFF0000' } };
					}
				}
			}
			
			const bestCjCell = row.getCell(14);
			bestCjCell.value = athlete.bestCleanJerk || '';
			bestCjCell.alignment = { horizontal: 'right' };
			bestCjCell.font = { bold: true };
			const totalCell = row.getCell(15);
			totalCell.value = athlete.displayTotal || '';
			totalCell.alignment = { horizontal: 'right' };
			totalCell.font = { bold: true };
			
			const scoreValue = scoringSystem === 'TeamPoints' ? athlete.displayTeamPoints : athlete.displayScore;
			const scoreCell = row.getCell(16);
			scoreCell.value = scoreValue || '';
			scoreCell.numFmt = scoringSystem === 'TeamPoints' ? '0' : '0.00';
			scoreCell.alignment = { horizontal: 'right' };

			// Highlight score cell if this athlete contributes to the team score
			if (athlete.includedInTeamScore) {
				scoreCell.fill = {
					type: 'pattern',
					pattern: 'solid',
					fgColor: { argb: 'FFFFF2CC' }  // Light gold
				};
				scoreCell.font = { bold: true };
			}

			// Apply borders
			for (let col = 1; col <= 16; col++) {
				row.getCell(col).border = {
					top: { style: 'thin' },
					bottom: { style: 'thin' },
					left: { style: 'thin' },
					right: { style: 'thin' }
				};
			}

			currentRow++;
		}

		// Add spacing row after team
		currentRow++;
	}

	// Generate buffer
	const buffer = await workbook.xlsx.writeBuffer();
	const base64 = buffer.toString('base64');

	const timestamp = new Date().toISOString().slice(0, 10);
	const filename = `Team_Results_Scoreboard_${competition?.fop || 'Platform'}_${timestamp}.xlsx`;

	return {
		success: true,
		binary: true,
		contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		filename,
		buffer: base64
	};
}

/**
 * Generate flat format Excel (one row per athlete)
 */
async function generateFlatFormat(workbook, worksheet, data, options) {
	const { teams, headers, competition } = data;
	const scoringSystem = options.scoringSystem || 'Sinclair';

	// Flatten team-grouped athletes (same processed data as scoreboard format)
	const flatAthletes = [];
	if (teams) {
		for (const team of teams) {
			for (const athlete of getExportTeamAthletes(team, options)) {
				flatAthletes.push(athlete);
			}
		}
	}

	// Sort by team name, then by score descending
	flatAthletes.sort((a, b) => {
		const teamCompare = (a.teamName || '').localeCompare(b.teamName || '');
		if (teamCompare !== 0) return teamCompare;
		const scoreA = parseFloat(a.displayScore) || 0;
		const scoreB = parseFloat(b.displayScore) || 0;
		return scoreB - scoreA;
	});

	// Column definitions
	const columns = [
		{ header: headers?.membership || 'Membership', key: 'membership', width: 14 },
		{ header: headers?.team || 'Team', key: 'team', width: 20 },
		{ header: headers?.name || 'Name', key: 'name', width: 25 },
		{ header: headers?.category || 'Category', key: 'category', width: 10 },
		{ header: headers?.bodyWeight || 'B.W.', key: 'bodyWeight', width: 10 },
		{ header: headers?.birth || 'Born', key: 'born', width: 8 },
		{ header: 'Sn1', key: 'sn1', width: 8 },
		{ header: 'Sn2', key: 'sn2', width: 8 },
		{ header: 'Sn3', key: 'sn3', width: 8 },
		{ header: headers?.best || 'Best Snatch', key: 'bestSnatch', width: 12 },
		{ header: 'CJ1', key: 'cj1', width: 8 },
		{ header: 'CJ2', key: 'cj2', width: 8 },
		{ header: 'CJ3', key: 'cj3', width: 8 },
		{ header: headers?.best || 'Best CJ', key: 'bestCj', width: 12 },
		{ header: headers?.total || 'Total', key: 'total', width: 10 },
		{ header: headers?.score || 'Score', key: 'score', width: 12 },
		{ header: headers?.team || 'Team', key: 'teamGender', width: 8 }
	];

	worksheet.columns = columns;

	// Header row styling
	const headerRow = worksheet.getRow(1);
	headerRow.font = { bold: true, size: 11 };
	headerRow.fill = {
		type: 'pattern',
		pattern: 'solid',
		fgColor: { argb: 'FF4472C4' }
	};
	headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
	headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
	headerRow.border = {
		top: { style: 'thin' },
		bottom: { style: 'thin' },
		left: { style: 'thin' },
		right: { style: 'thin' }
	};

	// Add athlete rows
	let currentRow = 2;
	for (const athlete of flatAthletes) {
		const row = worksheet.getRow(currentRow);
		
		row.getCell(1).value = getAthleteMembership(athlete);
		row.getCell(2).value = athlete.teamName || '';
		row.getCell(3).value = athlete.fullName || '';
		row.getCell(4).value = athlete.category || '';
		const bodyWeightCell = row.getCell(5);
		bodyWeightCell.value = getAthleteBodyWeight(athlete);
		bodyWeightCell.alignment = { horizontal: 'right' };
		bodyWeightCell.numFmt = '0.00';
		row.getCell(6).value = athlete.yearOfBirth || '';
		
		// Attempts
		const sattempts = athlete.sattempts || [];
		const cattempts = athlete.cattempts || [];
		
		for (let i = 0; i < 3; i++) {
			const snCell = row.getCell(7 + i);
			const attempt = sattempts[i];
			snCell.alignment = { horizontal: 'right' };
			if (attempt && attempt.stringValue && attempt.stringValue !== '\u00A0') {
				snCell.value = attempt.stringValue;
				if (attempt.liftStatus === 'bad') {
					snCell.font = { strike: true, color: { argb: 'FFFF0000' } };
				}
			}
		}
		
		const bestSnCell = row.getCell(10);
		bestSnCell.value = athlete.bestSnatch || '';
		bestSnCell.alignment = { horizontal: 'right' };
		bestSnCell.font = { bold: true };
		
		for (let i = 0; i < 3; i++) {
			const cjCell = row.getCell(11 + i);
			const attempt = cattempts[i];
			cjCell.alignment = { horizontal: 'right' };
			if (attempt && attempt.stringValue && attempt.stringValue !== '\u00A0') {
				cjCell.value = attempt.stringValue;
				if (attempt.liftStatus === 'bad') {
					cjCell.font = { strike: true, color: { argb: 'FFFF0000' } };
				}
			}
		}
		
		const bestCjCell = row.getCell(14);
		bestCjCell.value = athlete.bestCleanJerk || '';
		bestCjCell.alignment = { horizontal: 'right' };
		bestCjCell.font = { bold: true };
		const totalCell = row.getCell(15);
		totalCell.value = athlete.displayTotal || '';
		totalCell.alignment = { horizontal: 'right' };
		totalCell.font = { bold: true };
		
		const scoreValue = scoringSystem === 'TeamPoints' ? athlete.displayTeamPoints : athlete.displayScore;
		const scoreCell = row.getCell(16);
		scoreCell.value = scoreValue || '';
		scoreCell.numFmt = scoringSystem === 'TeamPoints' ? '0' : '0.00';
		scoreCell.alignment = { horizontal: 'right' };

		// Highlight score cell if this athlete contributes to the team score
		const contributes = athlete.includedInTeamScore;
		if (contributes) {
			scoreCell.fill = {
				type: 'pattern',
				pattern: 'solid',
				fgColor: { argb: 'FFFFF2CC' }  // Light gold
			};
			scoreCell.font = { bold: true };
		}

		// Team gender column - show M/F only for scoring athletes
		const teamGenderCell = row.getCell(17);
		if (contributes) {
			const normalizedGender = normalizeGender(athlete.gender);
			teamGenderCell.value = normalizedGender || '';
			teamGenderCell.alignment = { horizontal: 'center' };
		}

		// Apply borders
		for (let col = 1; col <= 17; col++) {
			row.getCell(col).border = {
				top: { style: 'thin' },
				bottom: { style: 'thin' },
				left: { style: 'thin' },
				right: { style: 'thin' }
			};
		}

		currentRow++;
	}

	// Generate buffer
	const buffer = await workbook.xlsx.writeBuffer();
	const base64 = buffer.toString('base64');

	const timestamp = new Date().toISOString().slice(0, 10);
	const filename = `Team_Results_Flat_${competition?.fop || 'Platform'}_${timestamp}.xlsx`;

	return {
		success: true,
		binary: true,
		contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		filename,
		buffer: base64
	};
}

// =============================================================================
// FACTORY FUNCTION FOR PLUGIN INHERITANCE
// =============================================================================

/**
 * Create helpers with optional custom score calculator
 * 
 * Derivative plugins can provide a custom calculateScore function that:
 * - Receives: (total, bw, gender, age, system, context)
 * - context contains: { athlete, hub }
 * - Returns: number (use custom score) or null (defer to default scoring)
 * 
 * Example derivative plugin:
 * ```javascript
 * import { createHelpers } from '../../teams/team-scoreboard/helpers.data.js';
 * 
 * function calculateScore(total, bw, gender, age, system, context) {
 *   if (system === 'PDC') {
 *     const bestSnatch = parseFloat(context.athlete.bestSnatch) || 0;
 *     return bw > 0 ? (bestSnatch + total) / bw : 0;
 *   }
 *   return null; // Defer to base for other systems
 * }
 * 
 * export const { getScoreboardData, getDatabaseState, getFopUpdate, getCompetitionStats, getTopAthletes, getTeamRankings } = createHelpers(calculateScore);
 * ```
 * 
 * @param {Function|null} customCalculateScore - Custom score calculator or null
 * @returns {Object} Object with all exported helper functions
 */
export function createHelpers(customCalculateScore = null) {
	// Set the module-level custom calculator
	_customCalculateScore = customCalculateScore;
	
	// Return all public functions
	return {
		getScoreboardData,
		getDatabaseState,
		getFopUpdate,
		getCompetitionStats,
		getTopAthletes,
		getTeamRankings,
		handleAction
	};
}
