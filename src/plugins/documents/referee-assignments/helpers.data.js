/**
 * Referee Assignments Scoreboard - Server-side helpers
 * 
 * This scoreboard displays referee and official assignments across all sessions/groups
 * in a professional IWF protocol format.
 */

import { competitionHub } from '$lib/server/competition-hub.js';
import { buildCacheKey, registerCache } from '$lib/server/cache-utils.js';
import { compareDateTimes, formatDateISO, formatTime } from '$lib/date-time.js';

// Cache for referee-assignments
const refereeAssignmentsCache = new Map();
registerCache(refereeAssignmentsCache);

/**
 * Returns the current date/time formatted as yyyy-mm-dd HHhMM (no timezone).
 */
function formatProductionTimestamp() {
	const now = new Date();
	const date = [
		now.getFullYear(),
		String(now.getMonth() + 1).padStart(2, '0'),
		String(now.getDate()).padStart(2, '0')
	].join('-');
	const time = String(now.getHours()).padStart(2, '0') + 'h' + String(now.getMinutes()).padStart(2, '0');
	return `${date} ${time}`;
}

/**
 * Main function to get referee assignment data
 * @param {string} fopName - Field of play name (not used for this scoreboard, but required by system)
 * @param {object} options - User options (including lang/language for translation locale)
 * @returns {object} Referee assignment data structured for display
 */
export function getScoreboardData(fopName = 'A', options = {}) {
	const databaseState = competitionHub.getDatabaseState();
	
	// Get language from options (same pattern as team-scoreboard)
	const language = options.lang || options.language || 'en';
	const translations = competitionHub.getTranslations({ locale: language });
	
	// Include translations checksum in cache key so cache invalidates when translations change
	const translationsChecksum = competitionHub.lastTranslationsChecksum || 'none';
	const cacheKey = buildCacheKey({ includeFop: false, opts: options }) + `-txcs:${translationsChecksum.substring(0, 8)}`;
	
	if (refereeAssignmentsCache.has(cacheKey)) {
		return { ...refereeAssignmentsCache.get(cacheKey), productionTimestamp: formatProductionTimestamp() };
	}
	
	if (!databaseState || !databaseState.competition) {
		return {
			status: 'no_data',
			message: 'No competition data available',
			days: [],
			header: {},
			productionTimestamp: formatProductionTimestamp()
		};
	}

	// Use sessions if available, otherwise extract from athletes' group assignments
	let sessions = databaseState.sessions || [];
	
	if (sessions.length === 0 && databaseState.athletes) {
		// Extract unique groups from athletes
		const groupMap = new Map();
		databaseState.athletes.forEach(athlete => {
			if (athlete.group && !groupMap.has(athlete.group)) {
				groupMap.set(athlete.group, { name: athlete.group, description: athlete.group });
			}
		});
		sessions = Array.from(groupMap.values());
	}
	
	if (sessions.length === 0) {
		// If still no sessions, at least show the competition header with placeholder
		const competition = databaseState.competition;
		const result = {
			status: 'ready',
			header: {
				competitionName: competition.competitionName || 'Competition',
				fileTitle: `Referee Assignments - ${competition.competitionName || 'Competition'}`,
				locationLine: '',
				title: translations['OfficialAssignments'] || `!${language}:OfficialAssignments`
			},
			days: [],
			totalSessions: 0,
			labels: buildLabels(translations, language)
		};
		refereeAssignmentsCache.set(cacheKey, result);
		return { ...result, productionTimestamp: formatProductionTimestamp() };
	}

	// Sort sessions by competition time first, then by name for stable ordering.
	const sortedSessions = [...sessions].sort((a, b) => {
		const timeCompare = compareDateTimes(a.competitionTime, b.competitionTime);
		if (timeCompare !== 0) return timeCompare;
		return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' });
	});

	// Get competition info for header
	const competition = databaseState.competition;
	
	// Build location line (combines site, city, and date range in ISO format)
	function buildLocationLine() {
		const parts = [];
		if (competition.competitionSite) parts.push(competition.competitionSite);
		if (competition.competitionCity) parts.push(competition.competitionCity);
		
		// Format dates in ISO format (yyyy-mm-dd)
		const startDate = competition.competitionDate ? formatDateISO(competition.competitionDate) : '';
		const endDate = competition.competitionEndDate ? formatDateISO(competition.competitionEndDate) : '';
		
		if (startDate && endDate) {
			parts.push(`${startDate} - ${endDate}`);
		} else if (startDate) {
			parts.push(startDate);
		}
		
		return parts.filter(p => p).join(', ');
	}
	
	// Helper function to split names on " et " or " and "
	function formatNames(value) {
		if (!value || value.trim() === '') {
			return null;
		}
		
		const trimmed = value.trim();
		const names = trimmed.split(/\s+(?:et|and)\s+/i).map(n => n.trim()).filter(n => n.length > 0);
		
		return {
			raw: trimmed,
			split: names.length > 1 ? names : []
		};
	}

	// Build session columns data with ISO date extraction
	const sessionColumns = sortedSessions.map((session, idx) => {
		// Get category info if available - find athletes in this session
		const sessionAthletes = (databaseState.athletes || []).filter(a => a.group === session.name);
		
		return {
			id: `session-${idx}`,
			name: session.name,
			displayName: session.description || session.name,
			platformName: session.platformName || '',
			weighInTime: session.weighInTime ? formatTime(session.weighInTime) : '',
			competitionTime: session.competitionTime ? formatTime(session.competitionTime) : '',
			competitionDay: session.competitionTime ? formatDateISO(session.competitionTime) : '',
			athleteCount: sessionAthletes.length,
			officials: {
				weighIn1: formatNames(session.weighIn1),
				weighIn2: formatNames(session.weighIn2),
				announcer: formatNames(session.announcer),
				marshall: formatNames(session.marshall),
				marshal2: formatNames(session.marshal2),
				technicalController: formatNames(session.technicalController),
				technicalController2: formatNames(session.technicalController2),
				technicalController3: formatNames(session.technicalController3),
				timeKeeper: formatNames(session.timeKeeper),
				referee1: formatNames(session.referee1),
				referee2: formatNames(session.referee2),
				referee3: formatNames(session.referee3),
				reserve: formatNames(session.reserve),
				jury1: formatNames(session.jury1),
				jury2: formatNames(session.jury2),
				jury3: formatNames(session.jury3),
				jury4: formatNames(session.jury4),
				jury5: formatNames(session.jury5),
				reserveJury: formatNames(session.reserveJury),
				competitionDirector: formatNames(session.competitionDirector),
				competitionSecretary: formatNames(session.competitionSecretary),
				competitionSecretary2: formatNames(session.competitionSecretary2),
				doctor: formatNames(session.doctor),
				doctor2: formatNames(session.doctor2),
				doctor3: formatNames(session.doctor3)
			}
		};
	});
	
	// Group sessions by competition day (ISO date) then by platform
	const dayPlatformGroups = new Map();
	sessionColumns.forEach(session => {
		const day = session.competitionDay || 'unknown';
		const platform = session.platformName || 'Platform';
		const key = `${day}|${platform}`;
		
		if (!dayPlatformGroups.has(key)) {
			dayPlatformGroups.set(key, {
				day,
				platform,
				sessions: []
			});
		}
		dayPlatformGroups.get(key).sessions.push(session);
	});
	
	// Convert to sorted array grouped by day, then by platform
	const groupedByDay = new Map();
	Array.from(dayPlatformGroups.values())
		.sort((a, b) => {
			// Sort by day first, then by platform
			const dayCompare = a.day.localeCompare(b.day);
			if (dayCompare !== 0) return dayCompare;
			return a.platform.localeCompare(b.platform);
		})
		.forEach(group => {
			if (!groupedByDay.has(group.day)) {
				groupedByDay.set(group.day, []);
			}
			groupedByDay.get(group.day).push({
				platform: group.platform,
				sessions: group.sessions
			});
		});
	
	// Convert to final array structure with platform counts
	const days = Array.from(groupedByDay.entries())
		.map(([date, platforms]) => ({
			date,
			platforms,
			hasMultiplePlatforms: platforms.length > 1
		}));

	// Build result with translations
	const sideRefereeBase = translations['SideReferee'] || `!${language}:SideReferee`;
	
	// Check if there are multiple platforms across all days
	const allPlatforms = new Set();
	sessionColumns.forEach(s => allPlatforms.add(s.platformName || 'Platform'));
	const hasMultiplePlatforms = allPlatforms.size > 1;
	
	const competitionName = competition.competitionName || 'Competition';

	const result = {
		status: 'ready',
		header: {
			competitionName,
			locationLine: buildLocationLine(),
			title: translations['OfficialAssignments'] || `!${language}:OfficialAssignments`,
			fileTitle: `Referee Assignments - ${competitionName}`
		},
		days: days,
		hasMultiplePlatforms,
		totalSessions: sortedSessions.length,
		// Pass translations and labels for use in component
		labels: buildLabels(translations, language)
	};

	// Cache the result (without timestamp — timestamp is added fresh on every call)
	refereeAssignmentsCache.set(cacheKey, result);
	if (refereeAssignmentsCache.size > 3) {
		const firstKey = refereeAssignmentsCache.keys().next().value;
		const expiredEntry = refereeAssignmentsCache.get(firstKey);
		if (expiredEntry) {
			if (expiredEntry.referees) expiredEntry.referees = null;
			if (expiredEntry.sessions) expiredEntry.sessions = null;
		}
		refereeAssignmentsCache.delete(firstKey);
	}

	return { ...result, productionTimestamp: formatProductionTimestamp() };
}

/**
 * Format date array [year, month, day] to locale-appropriate string
 * @param {Array} dateArray - [year, month, day]
 * @param {string} language - Language code (e.g., 'en', 'fr', 'fr_CA')
 */
function formatDate(dateArray, language = 'en') {
	if (!dateArray || dateArray.length < 3) return '';
	const [year, month, day] = dateArray;
	
	// Use ISO format (yyyy-mm-dd) for French Canadian and other locales that prefer it
	// Use international format (dd/mm/yyyy) for most European locales
	// Use US format (mm/dd/yyyy) for US English
	const lang = language.toLowerCase();
	
	if (lang === 'fr_ca' || lang === 'fr-ca' || lang === 'en_ca' || lang === 'en-ca') {
		// Canadian format: yyyy-mm-dd (ISO)
		return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
	} else if (lang === 'en_us' || lang === 'en-us') {
		// US format: mm/dd/yyyy
		return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`;
	} else {
		// International/European format: dd/mm/yyyy
		return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
	}
}

/**
 * Build labels object from translations
 */
function buildLabels(translations, language) {
	const sideRefereeBase = translations['SideReferee'] || `!${language}:SideReferee`;
	
	return {
		group: translations['Group'] || `!${language}:Group`,
		weigh_in: translations['WeighIn'] || 'Weigh-In',
		official_at_weighin: translations['WeighInOfficials'] || `!${language}:WeighInOfficials`,
		officials: translations['Officials'] || 'Officials',
		weighin_time: translations['WeighInTime_StartList'] || `!${language}:WeighInTime_StartList`,
		competition_time: translations['StartTime'] || `!${language}:StartTime`,
		announcer: 'Speaker',
		referees: translations['Referees'] || `!${language}:Referees`,
		center_referee: translations['CenterReferee'] || `!${language}:CenterReferee`,
		side_referee_1: (sideRefereeBase + ' 1'),
		side_referee_2: (sideRefereeBase + ' 3'),
		reserve_referee: translations['ReserveReferee'] || `!${language}:ReserveReferee`,
		marshals: translations['Marshals'] || `!${language}:Marshals`,
		marshall: translations['Marshals'] || translations['Marshall'] || `!${language}:Marshall`,
		timekeeper: translations['Timekeeper'] || `!${language}:Timekeeper`,
		technical_controller: 'Technical Controllers',
		secretaries: translations['Secretaries'] || `!${language}:Secretaries`,
		secretary: translations['Secretary'] || `!${language}:Secretary`,
		competition_secretaries: translations['CompetitionSecretaries'] || 'Competition Secretaries',
		doctor: translations['Doctor'] || `!${language}:Doctor`,
		jury: translations['Jury'] || `!${language}:Jury`,
		jury_president: translations['JuryPresident'] || `!${language}:JuryPresident`,
		jury_members: translations['JuryMembers'] || `!${language}:JuryMembers`,
		reserve: translations['Reserve'] || `!${language}:Reserve`,
		support_it: translations['TechnologySupport'] || `!${language}:TechnologySupport`,
		tis1: translations['TIS1'] || `!${language}:TIS1`,
		tis2: translations['TIS2'] || `!${language}:TIS2`
	};
}
