export const replayTokenStorageKey = 'owlcms.jury.replays.token';

export function openReplaysPage(browserWindow, url, token) {
	const replayWindow = browserWindow.open('about:blank', '_blank');
	if (!replayWindow) {
		throw new Error('The browser blocked the replay window.');
	}

	try {
		replayWindow.sessionStorage.setItem(replayTokenStorageKey, String(token ?? ''));
		replayWindow.opener = null;
		replayWindow.location.replace(url);
	} catch (error) {
		replayWindow.close();
		throw error;
	}
}
