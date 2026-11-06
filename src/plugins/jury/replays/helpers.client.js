export function ensureAbsoluteUrl(rawUrl) {
	const trimmed = String(rawUrl || '').trim();
	if (!trimmed) {
		return '';
	}

	return /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)
		? trimmed
		: `http://${trimmed}`;
}

function retainReplayToken(url) {
	const tokens = url.searchParams.getAll('token');
	url.search = '';
	for (const token of tokens) url.searchParams.append('token', token);
}

function redactReplayTokens(value) {
	return String(value || '').replace(/((?:[?&]|%3f|%26)token(?:=|%3d))[^&#\s%"'<>]*/gi, '$1[redacted]');
}

export function normalizeReplaySessionId(value) {
	return String(value || '')
		.trim()
		.replaceAll(' ', '_');
}

export function normalizeTrackerSessions(trackerSessions = []) {
	return Array.isArray(trackerSessions)
		? trackerSessions
			.filter((session) => session?.id)
			.map((session) => ({
				...session,
				id: normalizeReplaySessionId(session.id || session.name || session.displayName || '')
			}))
		: [];
}

function normalizeAttemptKeyText(value) {
	return String(value || '')
		.trim()
		.replaceAll('_', ' ')
		.replace(/\s+/g, ' ')
		.toLowerCase();
}

function normalizeAttemptKeyNumber(value) {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export function buildAttemptKey(athleteName, liftType, attemptNumber, session) {
	const athlete = normalizeAttemptKeyText(athleteName);
	const lift = normalizeAttemptKeyText(liftType);
	const attempt = normalizeAttemptKeyNumber(attemptNumber);
	if (!athlete || !lift || !attempt) {
		return '';
	}

	return [normalizeReplaySessionId(session), athlete, lift, attempt].join('|');
}

export function buildStatusAttemptKey(message) {
	return buildAttemptKey(message?.athleteName, message?.liftType, message?.attemptNumber, message?.session);
}

export function buildReplaySelectionAttemptKey(selection) {
	return buildAttemptKey(selection?.athleteName, selection?.liftType, selection?.attemptNumber, selection?.session);
}

export function extractStatusAttemptDetails(message = {}) {
	const parsedAttempt = Number(message?.attemptNumber);
	return {
		athleteName: typeof message?.athleteName === 'string' ? message.athleteName : '',
		liftType: typeof message?.liftType === 'string' ? message.liftType : '',
		attemptNumber: Number.isInteger(parsedAttempt) && parsedAttempt > 0 ? parsedAttempt : null,
		session: typeof message?.session === 'string' ? message.session : ''
	};
}

export function parseReplaysStatusMessage(rawData) {
	try {
		const message = JSON.parse(rawData);
		if (!message || typeof message.text !== 'string') {
			return null;
		}

		return {
			message,
			statusCode: Number.isFinite(message.code) ? Number(message.code) : null,
			details: extractStatusAttemptDetails(message)
		};
	} catch {
		return null;
	}
}

export function openReplaysStatusSocket(socketUrl, { onStatus, onClose } = {}) {
	if (!socketUrl || typeof WebSocket === 'undefined') {
		return null;
	}

	const socket = new WebSocket(socketUrl);

	socket.onmessage = (event) => {
		const statusMessage = parseReplaysStatusMessage(event.data);
		if (!statusMessage) {
			return;
		}

		onStatus?.(statusMessage);
	};

	socket.onerror = () => {
		socket.close();
	};

	socket.onclose = () => {
		onClose?.();
	};

	return socket;
}

function hasCompleteAttemptDetails(details = {}) {
	return Boolean(
		typeof details.athleteName === 'string' && details.athleteName.trim() &&
		typeof details.liftType === 'string' && details.liftType.trim() &&
		Number.isInteger(Number(details.attemptNumber)) && Number(details.attemptNumber) > 0
	);
}

function shouldResolveStatusDetailsFromApi(statusCode, details = {}) {
	return [0, 1, 2].includes(statusCode) && !hasCompleteAttemptDetails(details);
}

function replayStateAttemptDetails(replayState) {
	return {
		athleteName: replayState?.currentAthlete || '',
		liftType: replayState?.currentLiftType || '',
		attemptNumber: replayState?.currentAttempt || null,
		session: replayState?.resolvedSession || replayState?.activeSession || ''
	};
}

export function mergeAttemptDetails(primary = {}, fallback = {}) {
	return {
		athleteName: primary.athleteName || fallback.athleteName || '',
		liftType: primary.liftType || fallback.liftType || '',
		attemptNumber: primary.attemptNumber || fallback.attemptNumber || null,
		session: primary.session || fallback.session || ''
	};
}

export async function resolveLiveStatusDetails(baseUrl, statusCode, currentDetails = {}) {
	if (!shouldResolveStatusDetailsFromApi(statusCode, currentDetails)) {
		return currentDetails;
	}

	const replayState = await fetchReplayState(baseUrl);
	return mergeAttemptDetails(currentDetails, replayStateAttemptDetails(replayState));
}

export function buildStatusSocketUrl(baseUrl) {
	const normalized = ensureAbsoluteUrl(baseUrl);
	if (!normalized) {
		return '';
	}

	try {
		const url = new URL(normalized);
		url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
		if (/\/replay\/\d+(\.mp4)?$/.test(url.pathname)) {
			url.pathname = url.pathname.replace(/\/replay\/\d+(\.mp4)?$/, '/ws');
		} else {
			const basePath = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
			url.pathname = `${basePath}/ws`;
		}
		retainReplayToken(url);
		url.hash = '';
		return url.toString();
	} catch {
		return '';
	}
}

export function buildReplayStateUrl(baseUrl) {
	const normalized = ensureAbsoluteUrl(baseUrl);
	if (!normalized) {
		return { error: 'Provide the replays server URL in the tracker home page before opening this plugin.' };
	}

	try {
		const url = new URL(normalized);
		if (/\/replay\/\d+(\.mp4)?$/.test(url.pathname)) {
			url.pathname = url.pathname.replace(/\/replay\/\d+(\.mp4)?$/, '/api/replay-state');
		} else {
			const basePath = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
			url.pathname = `${basePath}/api/replay-state`;
		}
		retainReplayToken(url);
		url.hash = '';
		return { url: url.toString() };
	} catch {
		return { error: 'The replays server URL is not valid. Use a full URL such as http://192.168.1.50:8091.' };
	}
}

export function buildReplaySessionsUrl(baseUrl) {
	const normalized = ensureAbsoluteUrl(baseUrl);
	if (!normalized) {
		return { error: 'Provide the replays server URL in the tracker home page before opening this plugin.' };
	}

	try {
		const url = new URL(normalized);
		const basePath = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
		url.pathname = `${basePath}/api/sessions`;
		retainReplayToken(url);
		url.hash = '';
		return { url: url.toString() };
	} catch {
		return { error: 'The replays server URL is not valid. Use a full URL such as http://192.168.1.50:8091.' };
	}
}

export function buildReplaySessionLiftsUrl(baseUrl, sessionId, sortMode = 'time') {
	const normalized = ensureAbsoluteUrl(baseUrl);
	const normalizedSessionId = normalizeReplaySessionId(sessionId);
	if (!normalized) {
		return { error: 'Provide the replays server URL in the tracker home page before opening this plugin.' };
	}
	if (!normalizedSessionId) {
		return { error: 'Choose a session before loading replay history.' };
	}

	try {
		const url = new URL(normalized);
		const basePath = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
		url.pathname = `${basePath}/api/sessions/${encodeURIComponent(normalizedSessionId)}/lifts`;
		retainReplayToken(url);
		url.hash = '';
		url.searchParams.set('sort', sortMode === 'athlete' ? 'athlete' : 'time');
		return { url: url.toString() };
	} catch {
		return { error: 'The replays server URL is not valid. Use a full URL such as http://192.168.1.50:8091.' };
	}
}

export function buildReplayUrl(baseUrl, cameraNumber, cacheBust = Date.now()) {
	const normalized = ensureAbsoluteUrl(baseUrl);
	if (!normalized) {
		return { error: 'Provide the replays server URL in the tracker home page before opening this plugin.' };
	}

	try {
		const url = new URL(normalized);
		if (/\/replay\/\d+(\.mp4)?$/.test(url.pathname)) {
			url.pathname = url.pathname.replace(/\/replay\/\d+(\.mp4)?$/, `/replay/${cameraNumber}`);
		} else {
			const basePath = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
			url.pathname = `${basePath}/replay/${cameraNumber}`;
		}

		if (url.searchParams.has('token')) retainReplayToken(url);
		url.searchParams.set('_t', String(cacheBust));
		return { url: url.toString() };
	} catch {
		return { error: 'The replays server URL is not valid. Use a full URL such as http://192.168.1.50:8091.' };
	}
}

export function buildExactReplayUrl(baseUrl, videoPath, cacheBust = Date.now()) {
	const normalized = ensureAbsoluteUrl(baseUrl);
	if (!normalized || !videoPath) {
		return { error: 'Replay metadata is missing a playable video path.' };
	}

	try {
		const base = new URL(normalized);
		if (!base.pathname.endsWith('/')) base.pathname += '/';
		const url = new URL(videoPath, base);
		const tokens = base.searchParams.getAll('token');
		if (tokens.length) {
			if (url.origin !== base.origin) {
				return { error: 'Replay metadata points to a different server.' };
			}
			url.search = '';
			for (const token of tokens) url.searchParams.append('token', token);
		}
		url.searchParams.set('_t', String(cacheBust));
		return { url: url.toString() };
	} catch {
		return { error: 'Unable to build the exact replay URL from the replays server state.' };
	}
}

export function replayStateView(replayState) {
	return {
		sessionId: normalizeReplaySessionId(replayState?.resolvedSession || replayState?.activeSession || ''),
		cameras: Array.isArray(replayState?.cameras) ? replayState.cameras : []
	};
}

export async function fetchReplayState(baseUrl) {
	const replayStateTarget = buildReplayStateUrl(baseUrl);
	if (replayStateTarget.error) {
		return null;
	}

	try {
		const response = await fetch(replayStateTarget.url, { cache: 'no-store' });
		if (!response.ok) {
			if (response.status === 401) {
				return { error: 'Replays token missing, wrong or expired' };
			}
			return null;
		}

		return await response.json();
	} catch {
		return null;
	}
}

export async function fetchReplaySessions(baseUrl) {
	const replaySessionsTarget = buildReplaySessionsUrl(baseUrl);
	if (replaySessionsTarget.error) {
		return { sessions: [], activeSessionId: '' };
	}

	try {
		const response = await fetch(replaySessionsTarget.url, { cache: 'no-store' });
		if (!response.ok) {
			if (response.status === 401) {
				return { sessions: [], activeSessionId: '', error: 'Replays token missing, wrong or expired' };
			}
			return { sessions: [], activeSessionId: '' };
		}

		const payload = await response.json();
		const activeSessionId = normalizeReplaySessionId(payload?.activeSession || '');
		const sessions = (Array.isArray(payload?.sessions) ? payload.sessions : [])
			.map((session) => {
				const id = normalizeReplaySessionId(session?.id || session?.name || '');
				return id
					? {
						id,
						name: session?.name || session?.id || id,
						displayName: session?.name || session?.id || id,
						platformName: '',
						active: Boolean(session?.active) || id === activeSessionId
					}
					: null;
			})
			.filter(Boolean);
		return { sessions, activeSessionId };
	} catch {
		return { sessions: [], activeSessionId: '' };
	}
}

export async function fetchReplaySessionLifts(baseUrl, sessionId, sortMode = 'time') {
	const replayLiftsTarget = buildReplaySessionLiftsUrl(baseUrl, sessionId, sortMode);
	if (replayLiftsTarget.error) {
		return { lifts: [], error: replayLiftsTarget.error };
	}

	try {
		const response = await fetch(replayLiftsTarget.url, { cache: 'no-store' });
		if (!response.ok) {
			throw new Error(response.status === 401 ? 'Replays token missing, wrong or expired'
				: response.status === 404 ? 'No replay history is available for that session yet.'
					: 'Unable to load replay history from the replays server.');
		}

		const payload = await response.json();
		return { lifts: Array.isArray(payload?.lifts) ? payload.lifts : [], error: '' };
	} catch (error) {
		return { lifts: [], error: error?.message || 'Unable to load replay history from the replays server.' };
	}
}

export function getReplaySelectionForCamera(replayState, cameraNumber, attemptKey = '') {
	const replaySelections = Array.isArray(replayState?.cameras) ? replayState.cameras : [];
	return replaySelections.find((selection) =>
		Number(selection?.camera) === cameraNumber &&
		selection?.available &&
		typeof selection?.videoPath === 'string' &&
		selection.videoPath.length > 0 &&
		(!attemptKey || buildReplaySelectionAttemptKey(selection) === attemptKey)
	);
}

function normalizeLogText(value, maxLength = 240) {
	if (value === null || value === undefined) {
		return '';
	}

	const normalized = redactReplayTokens(value).replace(/\s+/g, ' ').trim();
	if (!normalized) {
		return '';
	}

	return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function roundLogNumber(value) {
	return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

function describeReadyState(value) {
	switch (value) {
		case 0:
			return 'HAVE_NOTHING';
		case 1:
			return 'HAVE_METADATA';
		case 2:
			return 'HAVE_CURRENT_DATA';
		case 3:
			return 'HAVE_FUTURE_DATA';
		case 4:
			return 'HAVE_ENOUGH_DATA';
		default:
			return '';
	}
}

function describeNetworkState(value) {
	switch (value) {
		case 0:
			return 'NETWORK_EMPTY';
		case 1:
			return 'NETWORK_IDLE';
		case 2:
			return 'NETWORK_LOADING';
		case 3:
			return 'NETWORK_NO_SOURCE';
		default:
			return '';
	}
}

function describeMediaErrorCode(value) {
	switch (value) {
		case 1:
			return 'MEDIA_ERR_ABORTED';
		case 2:
			return 'MEDIA_ERR_NETWORK';
		case 3:
			return 'MEDIA_ERR_DECODE';
		case 4:
			return 'MEDIA_ERR_SRC_NOT_SUPPORTED';
		default:
			return '';
	}
}

function normalizePlaybackMode(mode, slowMotionEnabled) {
	return mode === 'slow' && slowMotionEnabled ? 'slow' : 'normal';
}

export function buildReplayPlaybackFailurePayload({
	error,
	playbackRate,
	blockedStatusMessage,
	blockedErrorMessage,
	context = {},
	videoElement,
	activeCameraNumber,
	replayUrl,
	selectedPlaybackMode,
	slowMotionEnabled,
	athlete,
	liftType,
	attempt,
	session
}) {
	const playErrorName = normalizeLogText(error?.name || error?.constructor?.name || 'UnknownError', 80);
	const playErrorMessage = normalizeLogText(error?.message || error?.toString?.() || '', 320);
	const mediaErrorCode = videoElement?.error?.code ?? null;
	const mode = normalizePlaybackMode(context?.mode || selectedPlaybackMode, slowMotionEnabled);

	return {
		source: 'jury-replays',
		category: 'media.play',
		message: `Replay play() failed during ${normalizeLogText(context?.action || 'playback', 80) || 'playback'}: ${playErrorName}${playErrorMessage ? ` - ${playErrorMessage}` : ''}`,
		details: {
			action: normalizeLogText(context?.action || 'playback', 80),
			mode,
			cameraNumber: Number.isInteger(activeCameraNumber) ? activeCameraNumber : null,
			playbackRate: roundLogNumber(playbackRate),
			replayUrl: normalizeLogText(redactReplayTokens(replayUrl), 320),
			currentSrc: normalizeLogText(redactReplayTokens(videoElement?.currentSrc || ''), 320),
			pageUrl: normalizeLogText(redactReplayTokens(typeof window === 'undefined' ? '' : window.location?.href || ''), 320),
			documentVisibility: normalizeLogText(typeof document === 'undefined' ? '' : document.visibilityState || '', 40),
			playErrorName,
			playErrorMessage,
			mediaErrorCode,
			mediaErrorLabel: describeMediaErrorCode(mediaErrorCode),
			readyState: videoElement?.readyState ?? null,
			readyStateLabel: describeReadyState(videoElement?.readyState),
			networkState: videoElement?.networkState ?? null,
			networkStateLabel: describeNetworkState(videoElement?.networkState),
			paused: Boolean(videoElement?.paused),
			ended: Boolean(videoElement?.ended),
			currentTime: roundLogNumber(videoElement?.currentTime),
			duration: roundLogNumber(videoElement?.duration),
			muted: Boolean(videoElement?.muted),
			volume: roundLogNumber(videoElement?.volume),
			statusMessage: normalizeLogText(blockedStatusMessage, 200),
			uiErrorMessage: normalizeLogText(blockedErrorMessage, 200),
			athlete: normalizeLogText(athlete, 120),
			liftType: normalizeLogText(liftType, 40),
			attempt: attempt ?? null,
			session: normalizeLogText(session, 120),
			userAgent: normalizeLogText(typeof navigator === 'undefined' ? '' : navigator.userAgent || '', 320)
		}
	};
}

export async function reportReplayPlaybackFailure(options = {}) {
	if (typeof window === 'undefined' || typeof fetch !== 'function') {
		return;
	}

	const payload = buildReplayPlaybackFailurePayload(options);

	try {
		await fetch('/api/client-log', {
			method: 'POST',
			headers: {
				'content-type': 'application/json'
			},
			body: JSON.stringify(payload),
			keepalive: true
		});
	} catch (loggingError) {
		console.warn('[Replays] Failed to report play() rejection to tracker logs:', loggingError, payload);
	}
}
