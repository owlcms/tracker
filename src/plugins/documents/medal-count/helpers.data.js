/**
 * Medal Count - Server-side helpers
 *
 * Reports how many gold/silver/bronze medals are required for each session.
 *
 * A category is awarded its medals in the LAST session in which any of its
 * athletes competes, so a category spread over several sessions is counted only
 * once, at the point where its results become final.
 */

import { competitionHub } from '$lib/server/competition-hub.js';
import { buildCacheKey, registerCache } from '$lib/server/cache-utils.js';
import { compareDateTimes, formatDateISO, formatTime } from '$lib/date-time.js';
import { formatCategoryDisplay } from '@owlcms/tracker-core';
import { buildMedalLiftsResolver } from '$lib/medal-policy.js';

const medalCountCache = new Map();
registerCache(medalCountCache);

export function clearCache() {
	medalCountCache.clear();
}

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
 * Number of medal places for an age group.
 * OWLCMS exports `medals` either as a boolean (medals awarded or not) or as a
 * count of awarded places.
 */
function medalPlaces(ageGroup) {
	const medals = ageGroup?.medals;
	if (medals === false) return 0;
	if (typeof medals === 'number') return Math.max(0, Math.min(3, medals));
	return 3;
}

/**
 * Build lookup tables that resolve an athlete category code to its category and
 * age group. Older OWLCMS exports omit `category.code`, so the canonical
 * `<ageGroupCode>_<gender><maximumWeight>` form is reconstructed as a fallback.
 */
function buildCategoryLookup(ageGroups = []) {
	const byCode = new Map();
	const ageGroupCodes = [];

	ageGroups.forEach((ageGroup) => {
		if (ageGroup?.active === false) return;
		if (ageGroup.code) ageGroupCodes.push({ code: String(ageGroup.code), ageGroup });

		(ageGroup.categories || []).forEach((category) => {
			const entry = { ageGroup, category };
			const keys = [category.code, category.categoryCode];
			if (ageGroup.code && category.gender && category.maximumWeight != null) {
				keys.push(`${ageGroup.code}_${category.gender}${category.maximumWeight}`);
			}
			keys.forEach((key) => {
				if (key && !byCode.has(String(key))) byCode.set(String(key), entry);
			});
		});
	});

	// Longest code first so "M45" is not matched before "M45B" style codes.
	ageGroupCodes.sort((a, b) => b.code.length - a.code.length);

	return { byCode, ageGroupCodes };
}

function resolveCategory(catCode, lookup) {
	if (!catCode) return null;
	const code = String(catCode);
	const direct = lookup.byCode.get(code);
	if (direct) return direct;

	const prefixMatch = lookup.ageGroupCodes.find((entry) => code.startsWith(`${entry.code}_`));
	if (prefixMatch) return { ageGroup: prefixMatch.ageGroup, category: null };
	return null;
}

function categoryDisplayName(catCode, category) {
	const name = category?.categoryName || category?.name;
	if (name) return formatCategoryDisplay(name);
	return String(catCode || '').replace(/_/g, ' ');
}

/**
 * Main entry point.
 * @param {string} fopName - unused, this document covers the whole competition
 * @param {object} options - user options
 */
export function getScoreboardData(fopName = '*', options = {}) {
	const databaseState = competitionHub.getDatabaseState();
	const language = options.lang || options.language || 'en';
	const translations = competitionHub.getTranslations({ locale: language }) || {};
	const labels = buildLabels(translations);

	const translationsChecksum = competitionHub.lastTranslationsChecksum || 'none';
	const cacheKey =
		buildCacheKey({ includeFop: false, opts: options }) + `-v2-txcs:${translationsChecksum.substring(0, 8)}`;

	if (medalCountCache.has(cacheKey)) {
		return { ...medalCountCache.get(cacheKey), productionTimestamp: formatProductionTimestamp() };
	}

	if (!databaseState || !databaseState.competition) {
		return {
			status: 'no_data',
			header: {},
			sessions: [],
			labels,
			productionTimestamp: formatProductionTimestamp()
		};
	}

	const competition = databaseState.competition;
	// Lifts awarded medals follow the medal policy of each category's championship.
	const medalLiftsFor = buildMedalLiftsResolver(databaseState);
	const liftLabels = (lifts) => [
		lifts.snatch ? labels.snatch : null,
		lifts.cleanJerk ? labels.cleanJerk : null,
		lifts.total ? labels.total : null
	].filter(Boolean);

	// Order the sessions of the competition, so that "last session of a category"
	// is well defined.
	const dbSessions = databaseState.sessions || [];
	const sortedSessions = [...dbSessions].sort((a, b) => {
		const timeCompare = compareDateTimes(a.competitionTime, b.competitionTime);
		if (timeCompare !== 0) return timeCompare;
		return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' });
	});

	const sessionOrder = new Map();
	sortedSessions.forEach((session, index) => sessionOrder.set(session.name, index));

	const lookup = buildCategoryLookup(databaseState.ageGroups);

	// Collect, per category, the participating athletes and the sessions involved.
	const categories = new Map();
	let unassignedAthletes = 0;

	(databaseState.athletes || []).forEach((athlete) => {
		if (athlete.eligibleForIndividualRanking === false) return;

		const sessionName = athlete.sessionName || athlete.group || null;
		if (!sessionName) {
			unassignedAthletes += 1;
			return;
		}

		let participations = athlete.participations;
		if (!participations || participations.length === 0) {
			if (!athlete.categoryCode) return;
			participations = [{ categoryCode: athlete.categoryCode }];
		}

		participations.forEach((participation) => {
			const catCode = participation.categoryCode || athlete.categoryCode;
			if (!catCode) return;

			const resolved = resolveCategory(catCode, lookup);
			// Unknown or inactive age group: no medals to plan for.
			if (!resolved) return;
			const places = medalPlaces(resolved.ageGroup);
			if (places === 0) return;

			let entry = categories.get(String(catCode));
			if (!entry) {
				const championshipName = resolved.ageGroup.championshipName || resolved.ageGroup.code || '';
				const lifts = liftLabels(medalLiftsFor(championshipName));
				entry = {
					championshipName,
					lifts,
					code: String(catCode),
					name: categoryDisplayName(catCode, resolved.category),
					ageGroup: resolved.ageGroup.championshipName || resolved.ageGroup.code || '',
					gender: resolved.category?.gender || resolved.ageGroup.gender || '',
					places,
					athleteCount: 0,
					sessionNames: new Set()
				};
				categories.set(String(catCode), entry);
			}
			entry.athleteCount += 1;
			entry.sessionNames.add(sessionName);
		});
	});

	// Assign each category to the session where its medals are awarded.
	// Every scheduled session is listed, including those awarding no medals.
	const bySession = new Map();
	sortedSessions.forEach((session) => bySession.set(session.name, []));
	categories.forEach((entry) => {
		const sessionNames = Array.from(entry.sessionNames);
		const awardSession = sessionNames.reduce((latest, name) => {
			if (latest === null) return name;
			const latestIndex = sessionOrder.has(latest) ? sessionOrder.get(latest) : Number.MAX_SAFE_INTEGER;
			const candidateIndex = sessionOrder.has(name) ? sessionOrder.get(name) : Number.MAX_SAFE_INTEGER;
			return candidateIndex > latestIndex ? name : latest;
		}, null);

		const awarded = Math.min(entry.athleteCount, entry.places);
		const row = {
			code: entry.code,
			name: entry.name,
			ageGroup: entry.ageGroup,
			gender: entry.gender,
			athleteCount: entry.athleteCount,
			gold: (awarded >= 1 ? 1 : 0) * entry.lifts.length,
			silver: (awarded >= 2 ? 1 : 0) * entry.lifts.length,
			bronze: (awarded >= 3 ? 1 : 0) * entry.lifts.length,
			spansSessions: sessionNames.length > 1,
			sessionNames: sessionNames.sort((a, b) => (sessionOrder.get(a) ?? 0) - (sessionOrder.get(b) ?? 0))
		};

		if (!bySession.has(awardSession)) bySession.set(awardSession, []);
		bySession.get(awardSession).push(row);
	});

	const sessionsById = new Map(sortedSessions.map((session) => [session.name, session]));
	const platformNames = new Set();

	const sessions = [];
	bySession.forEach((rows, sessionName) => {
		const session = sessionsById.get(sessionName) || { name: sessionName };
		platformNames.add(session.platformName || '');

		rows.sort((a, b) => {
			const ageCompare = (a.ageGroup || '').localeCompare(b.ageGroup || '');
			if (ageCompare !== 0) return ageCompare;
			const genderCompare = (a.gender || '').localeCompare(b.gender || '');
			if (genderCompare !== 0) return genderCompare;
			return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
		});

		const totals = rows.reduce(
			(acc, row) => ({
				categories: acc.categories + 1,
				gold: acc.gold + row.gold,
				silver: acc.silver + row.silver,
				bronze: acc.bronze + row.bronze
			}),
			{ categories: 0, gold: 0, silver: 0, bronze: 0 }
		);

		sessions.push({
			id: `session-${sessionName}`,
			name: sessionName,
			description: session.description || '',
			platform: session.platformName || '',
			date: formatDateISO(session.competitionTime),
			time: formatTime(session.competitionTime),
			order: sessionOrder.has(sessionName) ? sessionOrder.get(sessionName) : Number.MAX_SAFE_INTEGER,
			categories: rows,
			totals
		});
	});

	sessions.sort((a, b) => {
		if (a.order !== b.order) return a.order - b.order;
		return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
	});

	const grandTotal = sessions.reduce(
		(acc, session) => ({
			categories: acc.categories + session.totals.categories,
			gold: acc.gold + session.totals.gold,
			silver: acc.silver + session.totals.silver,
			bronze: acc.bronze + session.totals.bronze
		}),
		{ categories: 0, gold: 0, silver: 0, bronze: 0 }
	);
	grandTotal.medals = grandTotal.gold + grandTotal.silver + grandTotal.bronze;

	// One header line when all championships award the same lifts, otherwise one entry per championship.
	const liftsByChampionship = new Map();
	categories.forEach((entry) => {
		if (!liftsByChampionship.has(entry.championshipName)) {
			liftsByChampionship.set(entry.championshipName, entry.lifts.join(' / '));
		}
	});
	const distinctLifts = new Set(liftsByChampionship.values());
	const medalLifts = distinctLifts.size <= 1
		? Array.from(distinctLifts)
		: Array.from(liftsByChampionship, ([name, lifts]) => (name ? `${name}: ${lifts}` : lifts));

	const competitionName = competition.competitionName || '';
	const result = {
		status: sessions.length > 0 ? 'ready' : 'no_sessions',
		header: {
			competitionName,
			locationLine: buildLocationLine(competition),
			title: labels.title,
			fileTitle: competitionName ? `${labels.title} - ${competitionName}` : labels.title
		},
		sessions,
		grandTotal,
		medalLifts,
		unassignedAthletes,
		hasMultiplePlatforms: platformNames.size > 1,
		labels
	};

	medalCountCache.set(cacheKey, result);
	if (medalCountCache.size > 3) {
		medalCountCache.delete(medalCountCache.keys().next().value);
	}

	return { ...result, productionTimestamp: formatProductionTimestamp() };
}

function buildLocationLine(competition) {
	const parts = [];
	if (competition.competitionSite) parts.push(competition.competitionSite);
	if (competition.competitionCity) parts.push(competition.competitionCity);

	const startDate = formatDateISO(competition.competitionDate);
	const endDate = formatDateISO(competition.competitionEndDate);
	if (startDate && endDate && startDate !== endDate) {
		parts.push(`${startDate} - ${endDate}`);
	} else if (startDate) {
		parts.push(startDate);
	}

	return parts.filter((part) => part).join(', ');
}

function label(translations, key) {
	return translations[key] || key;
}

function buildLabels(translations) {
	return {
		title: label(translations, 'Results.Medals'),
		session: label(translations, 'Session'),
		description: label(translations, 'Group.Description'),
		platform: label(translations, 'Platform'),
		category: label(translations, 'Results.Category'),
		ageGroup: label(translations, 'Results.RecordAgeGroup'),
		athletes: label(translations, 'Athletes'),
		gold: label(translations, 'Medal.Gold'),
		silver: label(translations, 'Medal.Silver'),
		bronze: label(translations, 'Medal.Bronze'),
		medals: label(translations, 'Results.Medals'),
		snatch: label(translations, 'Results.Snatch'),
		cleanJerk: label(translations, 'Results.Clean_and_Jerk'),
		total: label(translations, 'Results.Total'),
		summary: label(translations, 'Books.Statistics'),
		categories: label(translations, 'Preparation_Categories'),
		waitingForData: label(translations, 'Tracker.WaitingForData')
	};
}
