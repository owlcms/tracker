import { competitionHub } from '$lib/server/competition-hub.js';
import { compareDateTimes } from '$lib/date-time.js';

function normalizeReplaySessionId(value) {
	return String(value || '')
		.trim()
		.replaceAll(' ', '_');
}

function buildFallbackSessions(databaseState) {
	const groupMap = new Map();
	for (const athlete of databaseState?.athletes || []) {
		const sessionName = athlete?.sessionName || athlete?.group || '';
		if (!sessionName || groupMap.has(sessionName)) {
			continue;
		}
		groupMap.set(sessionName, {
			name: sessionName,
			description: sessionName,
			platformName: ''
		});
	}
	return Array.from(groupMap.values());
}

export function getScoreboardData(_fopName = '*', options = {}) {
	const databaseState = competitionHub.getDatabaseState() || {};
	const rawSessions = Array.isArray(databaseState.sessions) && databaseState.sessions.length > 0
		? databaseState.sessions
		: buildFallbackSessions(databaseState);

	const trackerSessions = [...rawSessions]
		.sort((left, right) => {
			const timeCompare = compareDateTimes(left?.competitionTime, right?.competitionTime);
			if (timeCompare !== 0) {
				return timeCompare;
			}
			return String(left?.name || '').localeCompare(String(right?.name || ''), undefined, {
				numeric: true,
				sensitivity: 'base'
			});
		})
		.map((session) => ({
			id: normalizeReplaySessionId(session?.name || session?.description || ''),
			name: session?.name || '',
			displayName: session?.description || session?.name || '',
			platformName: session?.platformName || '',
			competitionTime: session?.competitionTime ?? null
		}))
		.filter((session) => session.id);

	return {
		trackerSessions,
		options
	};
}

export default getScoreboardData;
