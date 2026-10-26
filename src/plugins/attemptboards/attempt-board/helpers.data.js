/**
 * Attempt Board - Server-side data helpers
 * 
 * Provides data for full-screen attempt board display including:
 * - Current athlete info (name, team, category, weight)
 * - Platform plate configuration for barbell visualization
 * - Timer and decision state
 */

import { competitionHub } from '$lib/server/competition-hub.js';
import { logger } from '@owlcms/tracker-core';
import { getFlagUrl, getPictureUrl } from '$lib/server/flag-resolver.js';
import { extractTimerAndDecisionState, extractDecisionDisplayDefaults } from '$lib/server/timer-decision-helpers.js';
import {
	adjudicationKey,
	buildJuryLabels,
	isJuryBreak,
	resolveCardSeconds,
	resolveShowJuryVotes,
	reviewLabelKey
} from './decision-display.js';

/**
 * Get the full database state - SERVER-SIDE ONLY
 */
export function getDatabaseState() {
	return competitionHub.getDatabaseState();
}

/**
 * Get the latest UPDATE message for a specific FOP - SERVER-SIDE ONLY
 */
export function getFopUpdate(fopName = 'A') {
	return competitionHub.getFopUpdate({ fopName });
}

/**
 * Calculate plates needed to reach target weight
 * Based on OWLCMS PlatesElement.java logic
 * 
 * @param {number} targetWeight - Total weight to load on bar
 * @param {number} barWeight - Weight of the bar (typically 20kg men, 15kg women)
 * @param {Object} platform - Platform configuration with plate counts
 * @returns {Array} Array of plate objects for display
 */
function calculatePlates(targetWeight, barWeight, platform) {
	if (!targetWeight || targetWeight <= 0) return [];
	if (!platform) return [];
	
	const plates = [];
	let remainingWeight = targetWeight - barWeight;
	
	// Check if we should use collar (2.5kg each side = 5kg total)
	const collarAvailable = platform.nbC_2_5 || 0;
	const useCollar = collarAvailable > 0 && remainingWeight >= 5;
	
	if (useCollar) {
		remainingWeight -= 5; // Reserve weight for collars
	}
	
	// Add bar visualization
	plates.push({ type: 'bar', class: 'bar', weight: 0 });
	plates.push({ type: 'barInner', class: 'barInner', weight: 0 });
	
	// Large plates (bumper plates) - pair weights
	const largePlates = [
		{ class: 'L_25', pairWeight: 50, available: platform.nbL_25 || 0 },
		{ class: 'L_20', pairWeight: 40, available: platform.nbL_20 || 0 },
		{ class: 'L_15', pairWeight: 30, available: platform.nbL_15 || 0 },
		{ class: 'L_10', pairWeight: 20, available: platform.nbL_10 || 0 },
		{ class: 'L_5', pairWeight: 10, available: platform.nbL_5 || 0 },
		{ class: 'L_2_5', pairWeight: 5, available: platform.nbL_2_5 || 0 }
	];
	
	// Track if we've used any large plate (for 5kg/2.5kg logic)
	let usedLargePlate = false;
	
	// Add large plates
	for (const plate of largePlates) {
		let count = plate.available;
		while (count > 0 && remainingWeight >= plate.pairWeight) {
			// Special logic: only use L_5 if no larger plate used and weight >= 10
			if (plate.class === 'L_5' && !usedLargePlate && remainingWeight < 10) break;
			// Special logic: only use L_2_5 if no larger plate used and weight >= 5
			if (plate.class === 'L_2_5' && !usedLargePlate && remainingWeight < 5) break;
			
			plates.push({ type: 'large', class: plate.class, weight: plate.pairWeight / 2 });
			remainingWeight -= plate.pairWeight;
			count--;
			usedLargePlate = true;
		}
	}
	
	// Small plates (change plates) - pair weights
	const smallPlates = [
		{ class: 'S_5', pairWeight: 10, available: platform.nbS_5 || 0 },
		{ class: 'S_2_5', pairWeight: 5, available: platform.nbS_2_5 || 0 }
	];
	
	// Add small plates before collar
	for (const plate of smallPlates) {
		let count = plate.available;
		while (count > 0 && remainingWeight >= plate.pairWeight) {
			plates.push({ type: 'small', class: plate.class, weight: plate.pairWeight / 2 });
			remainingWeight -= plate.pairWeight;
			count--;
		}
	}
	
	// Add collar if used
	if (useCollar) {
		plates.push({ type: 'collar', class: 'C_2_5', weight: 2.5 });
		remainingWeight += 5; // We reserved this earlier, add back to check remaining
		remainingWeight -= 5; // And now use it
	}
	
	// Remaining small plates after collar
	const remainingSmallPlates = [
		{ class: 'S_2', pairWeight: 4, available: platform.nbS_2 || 0 },
		{ class: 'S_1_5', pairWeight: 3, available: platform.nbS_1_5 || 0 },
		{ class: 'S_1', pairWeight: 2, available: platform.nbS_1 || 0 },
		{ class: 'S_0_5', pairWeight: 1, available: platform.nbS_0_5 || 0 }
	];
	
	for (const plate of remainingSmallPlates) {
		let count = plate.available;
		while (count > 0 && remainingWeight >= plate.pairWeight) {
			plates.push({ type: 'small', class: plate.class, weight: plate.pairWeight / 2 });
			remainingWeight -= plate.pairWeight;
			count--;
		}
	}
	
	// Add bar outer end
	plates.push({ type: 'barOuter', class: 'barOuter', weight: 0 });
	
	return plates;
}

/**
 * Get bar weight based on gender (20kg men, 15kg women)
 */
function getBarWeight(gender, platform) {
	// Check for non-standard bar first
	if (platform?.nonStandardBarWeight && platform.nonStandardBarWeight > 0) {
		return platform.nonStandardBarWeight;
	}
	// Standard bars: 20kg for men, 15kg for women
	return gender === 'F' ? 15 : 20;
}

/**
 * Board modes from OWLCMS (mutually exclusive):
 * WAIT, INTRO_COUNTDOWN, LIFT_COUNTDOWN, LIFT_COUNTDOWN_CEREMONY, 
 * CURRENT_ATHLETE, INTERRUPTION, SESSION_DONE, CEREMONY
 */

/**
 * Check if we're in a break mode
 * @param {string} mode - Board mode from fopUpdate
 * @returns {boolean}
 */
function isBreakMode(mode) {
	return mode === 'INTERRUPTION' || 
	       mode === 'INTRO_COUNTDOWN' || 
	       mode === 'LIFT_COUNTDOWN' || 
	       mode === 'LIFT_COUNTDOWN_CEREMONY' || 
	       mode === 'SESSION_DONE' || 
	       mode === 'CEREMONY';
}

/**
 * Check if we're in a countdown break mode (showing break timer)
 * @param {string} mode - Board mode from fopUpdate
 * @returns {boolean}
 */
function isCountdownMode(mode) {
	return mode === 'INTRO_COUNTDOWN' || 
	       mode === 'LIFT_COUNTDOWN' || 
	       mode === 'LIFT_COUNTDOWN_CEREMONY';
}

/**
 * Format the attempt string using translations
 * Uses Snatch_number / C_and_J_number translation keys
 * @param {string} liftTypeKey - "Snatch" or "Clean_and_jerk"
 * @param {string|number} attemptNumber - 1, 2, or 3
 * @param {Object} translations - Translation map
 * @returns {string} e.g., "Snatch #2" or "C&J #1"
 */
function formatAttempt(liftTypeKey, attemptNumber, translations) {
	if (!liftTypeKey || !attemptNumber) {
		return '';
	}
	
	// Choose translation key based on lift type
	let template;
	if (liftTypeKey === 'Snatch' || liftTypeKey === 'SNATCH') {
		template = translations?.Snatch_number || translations?.['Snatch_number'] || 'Snatch #{0}';
	} else {
		// Clean_and_jerk, CLEANJERK, etc.
		template = translations?.C_and_J_number || translations?.['C_and_J_number'] || 'C&J #{0}';
	}
	
	return template.replace('{0}', attemptNumber);
}

/**
 * Infer the group/session name for break display
 * Mirrors OWLCMS BreakDisplay.inferGroupName()
 * @param {Object} fopUpdate - FOP update object
 * @param {Object} translations - Translation map
 * @returns {string}
 */
function inferGroupName(fopUpdate, translations) {
	const sessionName = fopUpdate?.sessionName || fopUpdate?.groupName || '';
	if (!sessionName) {
		return '';
	}
	// Use translation key "Group_number" with session name, or fallback
	const template = translations?.Group_number || translations?.['Group_number'] || '!Group_number {0}';
	return template.replace('{0}', sessionName);
}

/**
 * Infer the break message for break display
 * Mirrors OWLCMS BreakDisplay.inferMessage()
 * @param {string} breakType - Break type from fopUpdate
 * @param {string} ceremonyType - Ceremony type if applicable
 * @param {Object} translations - Translation map
 * @returns {string}
 */
function inferBreakMessage(breakType, ceremonyType, translations, mode) {
	if (!breakType && !ceremonyType) {
		return translations?.['PublicMsg.CompetitionPaused'] || '!PublicMsg.CompetitionPaused';
	}
	
	// Ceremonies overlay a break; CeremonyDone can still carry the old ceremonyType,
	// so the board mode determines whether the ceremony is active.
	if (ceremonyType && (mode === 'CEREMONY' || mode === 'LIFT_COUNTDOWN_CEREMONY' || breakType === 'CEREMONY')) {
		switch (ceremonyType) {
			case 'INTRODUCTION':
				return translations?.['BreakMgmt.IntroductionOfAthletes'] || '!BreakMgmt.IntroductionOfAthletes';
			case 'MEDALS':
				return translations?.['PublicMsg.Medals'] || '!PublicMsg.Medals';
			case 'OFFICIALS_INTRODUCTION':
				return translations?.['BreakMgmt.IntroductionOfOfficials'] || '!BreakMgmt.IntroductionOfOfficials';
		}
	}
	
	// Handle regular break types
	if (breakType) {
		switch (breakType) {
			case 'FIRST_CJ':
				return translations?.['BreakType.FIRST_CJ'] || '!BreakType.FIRST_CJ';
			case 'FIRST_SNATCH':
				return translations?.['BreakType.FIRST_SNATCH'] || '!BreakType.FIRST_SNATCH';
			case 'BEFORE_INTRODUCTION':
				return translations?.['BreakType.BEFORE_INTRODUCTION'] || '!BreakType.BEFORE_INTRODUCTION';
			case 'TECHNICAL':
				return translations?.['PublicMsg.CompetitionPaused'] || '!PublicMsg.CompetitionPaused';
			case 'JURY':
				return translations?.['PublicMsg.JuryDeliberation'] || '!PublicMsg.JuryDeliberation';
			case 'CHALLENGE':
				return translations?.['PublicMsg.CHALLENGE'] || '!PublicMsg.CHALLENGE';
			case 'GROUP_DONE':
				return translations?.['PublicMsg.GroupDone'] || '!PublicMsg.GroupDone';
			case 'MARSHAL':
				return translations?.['PublicMsg.CompetitionPaused'] || '!PublicMsg.CompetitionPaused';
			case 'CEREMONY':
				// breakType is CEREMONY but no ceremonyType - fall through to default
				break;
			default:
				return `!BreakType.${breakType}`;
		}
	}
	
	// Fallback
	return translations?.['PublicMsg.CompetitionPaused'] || '!PublicMsg.CompetitionPaused';
}

function isEnabledOption(value) {
	return value !== false && value !== 'false';
}

/**
 * Get formatted scoreboard data for SSR/API (SERVER-SIDE ONLY)
 */
export function getScoreboardData(fopName = 'A', options = {}) {
	const fopUpdate = getFopUpdate(fopName);
	const databaseState = getDatabaseState();
	
	const showPlates = isEnabledOption(options.showPlates);
	const showTimer = isEnabledOption(options.showTimer);
	const showDecisions = isEnabledOption(options.showDecisions);
	const lang = options.lang || 'en';
	const showJuryVotes = resolveShowJuryVotes(options.showJuryVotes, extractDecisionDisplayDefaults(fopUpdate));
	const juryCardSeconds = resolveCardSeconds(options.juryCardSeconds);
	
	// Get learning mode from environment
	const learningMode = process.env.LEARNING_MODE === 'true' ? 'enabled' : 'disabled';
	
	// Extract timer, breakTimer, decision, and displayMode using shared helpers
	const { timer, breakTimer, decision: baseDecision, displayMode } = extractTimerAndDecisionState(fopUpdate, fopName);

	// The jury card is latched by the page: it needs the judged athlete and how old the decision is
	const adjudicationReceivedAt = baseDecision?.adjudicationDecisionReceivedAt || null;
	const decision = baseDecision?.adjudicationDecision
		? { ...baseDecision, athleteFull: fopUpdate?.athleteFull || null }
		: baseDecision;
	
	// Extract mode from fopUpdate (OWLCMS board mode)
	// Values: WAIT, INTRO_COUNTDOWN, LIFT_COUNTDOWN, LIFT_COUNTDOWN_CEREMONY, 
	//         CURRENT_ATHLETE, INTERRUPTION, SESSION_DONE, CEREMONY
	const mode = fopUpdate?.mode || 'WAIT';
	const breakType = fopUpdate?.breakType || null;
	const ceremonyType = fopUpdate?.ceremonyType || null;
	
	// DEBUG: Log all break-related fields from fopUpdate
	logger.warn(`[Attempt Board] mode="${mode}", breakType="${breakType}", ceremonyType="${ceremonyType}"`);
	logger.warn(`[Attempt Board] fopUpdate keys: ${fopUpdate ? Object.keys(fopUpdate).filter(k => k.toLowerCase().includes('break') || k.toLowerCase().includes('ceremony')).join(', ') : 'null'}`);
	
	// Get translations for break messages
	const translations = competitionHub.getTranslations({ locale: lang }) || {};
	
	// Debug: Check if translations are available
	const translationKeys = Object.keys(translations);
	const hasBreakTypeKeys = translationKeys.filter(k => k.startsWith('BreakType.')).length;
	logger.debug(`[Attempt Board] Translations: ${translationKeys.length} keys, ${hasBreakTypeKeys} BreakType keys, breakType="${breakType}"`);
	if (breakType) {
		const key = `BreakType.${breakType}`;
		logger.debug(`[Attempt Board] Looking for key "${key}": ${translations[key] || 'NOT FOUND'}`);
	}
	
	if (!fopUpdate && !databaseState) {
		return {
			scoreboardName: 'Attempt Board',
			competition: { name: '', fop: fopName },
			currentAttempt: null,
			plates: [],
			timer,
			breakTimer,
			decision,
			displayMode,
			mode,
			breakType,
			ceremonyType,
			sessionStatus: { isDone: false },
			options: { showPlates, showTimer, showDecisions, showJuryVotes, juryCardSeconds, showFlag: false, showPicture: false },
			juryLabels: buildJuryLabels(translations),
			status: 'waiting',
			message: translations?.WaitingNextGroup || 'Waiting for next group',
			learningMode
		};
	}

	// Get session status
	const sessionStatus = competitionHub.getSessionStatus({ fopName });

	// Extract basic competition info
	const competition = {
		name: fopUpdate?.competitionName || databaseState?.competition?.name || 'Competition',
		fop: fopName,
		state: fopUpdate?.fopState || 'INACTIVE',
		session: fopUpdate?.sessionName || '',
		sessionInfo: (fopUpdate?.sessionInfo || '').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—'),
		liftsDone: fopUpdate?.liftsDone || ''
	};

	// Get platform configuration for plates
	let platform = null;
	if (databaseState?.platforms) {
		// Find platform matching this FOP name
		platform = databaseState.platforms.find(p => p.name === fopName) 
			|| databaseState.platforms[0];
		logger.debug(`[Attempt Board] Platform found: ${platform?.name}, fopName: ${fopName}, nbL_25: ${platform?.nbL_25}`);
	} else {
		logger.debug(`[Attempt Board] No platforms in database. databaseState exists: ${!!databaseState}`);
	}
	
	// Extract current athlete from session athletes
	let currentAttempt = null;
	let plates = [];
	let barWeight = 20;
	
	// Get session athletes from competition hub
	const sessionAthletes = competitionHub.getSessionAthletes({ fopName }) || [];
	
	const currentAthlete = sessionAthletes.find(a => 
		a.classname && a.classname.includes('current')
	);
	
	if (currentAthlete) {
		// Parse names - fullName is "LASTNAME, FirstName"
		const fullName = currentAthlete.fullName || '';
		let lastName = '';
		let firstName = '';
		
		if (fullName.includes(',')) {
			const parts = fullName.split(',');
			lastName = parts[0].trim();
			firstName = parts.slice(1).join(',').trim();
		} else {
			lastName = fullName;
		}
		
		// Determine gender for bar weight
		const gender = currentAthlete.gender || fopUpdate?.gender || 'M';
		barWeight = getBarWeight(gender, platform);
		
		// Get weight from fopUpdate (current requested weight)
		const weight = parseInt(fopUpdate?.weight) || 0;
		
		// Get picture and flag URLs using unified resolver
		const pictureUrl = getPictureUrl(currentAthlete.membership, true);
			const flagUrl = getFlagUrl(currentAthlete.teamName, true);
		
		// Format attempt string using translations (e.g., "Snatch #2" or "C&J #1")
		const liftTypeKey = fopUpdate?.liftTypeKey || '';
		const attemptNumber = fopUpdate?.attemptNumber || '';
		const attempt = formatAttempt(liftTypeKey, attemptNumber, translations);
		
		currentAttempt = {
			fullName,
			lastName,
			firstName,
			teamName: currentAthlete.teamName || '',
			flagUrl,
			pictureUrl,
			startNumber: currentAthlete.startNumber || fopUpdate?.startNumber || '',
			categoryName: currentAthlete.category || fopUpdate?.categoryName || '',
			attempt,
			attemptNumber,
			weight,
			gender,
			barWeight
		};
		
		// Calculate plates for barbell display
		if (showPlates && weight > 0 && platform) {
			plates = calculatePlates(weight, barWeight, platform);
		}
	}
	
	// Session status message for breaks - now using tracker's own translations
	const inBreak = isBreakMode(mode);
	const inCountdown = isCountdownMode(mode);
	
	// Review label (jury deliberation, adjudication panel review, challenge) from OWLCMS decisionState
	const reviewKey = reviewLabelKey(decision?.decisionState);
	const reviewLabel = reviewKey ? (translations?.[reviewKey] || `!${reviewKey}`) : null;

	// Compute break titles using tracker translations (not OWLCMS fullName)
	let breakTitle = null;  // lastName during breaks (group/session name)
	let breakMessage = null;  // firstName during breaks (break type message)
	
	if (inBreak) {
		breakTitle = inferGroupName(fopUpdate, translations);
		breakMessage = inferBreakMessage(breakType, ceremonyType, translations, mode);
		if (reviewLabel && isJuryBreak(breakType)) {
			breakMessage = reviewLabel;
		}
		logger.debug(`[Attempt Board] Break: breakType="${breakType}", breakTitle="${breakTitle}", breakMessage="${breakMessage}"`);
	}

	// Determine overall status
	const hasData = !!(fopUpdate || databaseState);
	const status = hasData ? 'ready' : 'waiting';
	const message = !hasData ? (translations?.WaitingNextGroup || 'Waiting for next group') : null;

	return {
		scoreboardName: 'Attempt Board',
		competition,
		currentAttempt,
		plates,
		barWeight,
		platform: platform ? {
			name: platform.name,
			hasCollar: (platform.nbC_2_5 || 0) > 0
		} : null,
		// Full platform plate configuration for PlatesElement component
		platformPlates: platform,
		timer,
		breakTimer,
		decision,
		displayMode,
		// Board mode from OWLCMS
		mode,
		breakType,
		ceremonyType,
		// Break state helpers
		isBreak: inBreak,
		isCountdown: inCountdown,
		// Break display content (computed by tracker, not from OWLCMS fullName)
		breakTitle,      // Shows in lastName position during breaks
		breakMessage,    // Shows in firstName position during breaks
		reviewLabel,
		// Jury card: texts, identity and age (server clock) of the latest adjudicationDecision
		juryLabels: buildJuryLabels(translations),
		adjudicationKey: adjudicationKey(decision?.adjudicationDecision, adjudicationReceivedAt),
		adjudicationAgeMs: adjudicationReceivedAt ? Math.max(0, Date.now() - adjudicationReceivedAt) : 0,
		sessionStatus,
		options: { 
			showPlates, 
			showTimer, 
			showDecisions, 
			showJuryVotes,
			juryCardSeconds,
			showFlag: !!currentAttempt?.flagUrl, 
			showPicture: !!currentAttempt?.pictureUrl 
		},
		status,
		message,
		lastUpdate: fopUpdate?.lastUpdate || Date.now(),
		learningMode
	};
}
