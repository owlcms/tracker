import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	buildStatusSocketUrl, buildReplayStateUrl, buildReplaySessionsUrl,
	buildReplaySessionLiftsUrl, buildReplayUrl, buildExactReplayUrl,
	buildReplayPlaybackFailurePayload, fetchReplayState, replayBaseUrlWithToken
} from '../helpers.client.js';
import config from '../config.js';
import { openReplaysPage, replayTokenStorageKey } from '../token-session.js';
import { buildOptions } from '../../../../lib/server/build-options.js';

describe('replay token URLs', () => {
	afterEach(() => vi.unstubAllGlobals());
	it('passes the token to the replay tab without putting it in the URL', () => {
		const child = {
			sessionStorage: { setItem: vi.fn() },
			opener: {},
			location: { replace: vi.fn() },
			close: vi.fn()
		};
		const browser = { open: vi.fn().mockReturnValue(child) };
		openReplaysPage(browser, '/replays?replaysBaseUrl=http%3A%2F%2Fhost', 'secret');
		expect(child.sessionStorage.setItem).toHaveBeenCalledWith(replayTokenStorageKey, 'secret');
		expect(child.opener).toBeNull();
		expect(child.location.replace).toHaveBeenCalledWith('/replays?replaysBaseUrl=http%3A%2F%2Fhost');
		expect(child.location.replace.mock.calls[0][0]).not.toContain('secret');
	});

	it('does not open a replay page without its configured token if storage fails', () => {
		const child = {
			sessionStorage: { setItem: vi.fn(() => { throw new Error('storage unavailable'); }) },
			location: { replace: vi.fn() },
			close: vi.fn()
		};
		expect(() => openReplaysPage({ open: () => child }, '/replays', 'secret')).toThrow('storage unavailable');
		expect(child.close).toHaveBeenCalled();
		expect(child.location.replace).not.toHaveBeenCalled();
	});

	it('uses the separate password option for the Video requests', async () => {
		const tokenOption = config.options.find((option) => option.key === 'replayToken');
		expect(tokenOption.type).toBe('password');
		const url = new URL('http://tracker.test/replays');
		url.searchParams.set('replaysBaseUrl', 'https://replays.example/?token=old');
		url.searchParams.set('replayToken', ' new-token ');
		const options = buildOptions({ scoreboard: { config }, url });
		const base = replayBaseUrlWithToken(options.replaysBaseUrl, options.replayToken);
		const urls = [
			buildStatusSocketUrl(base),
			buildReplayStateUrl(base).url,
			buildReplaySessionsUrl(base).url,
			buildReplaySessionLiftsUrl(base, 'session').url,
			buildReplayUrl(base, 1, 123).url,
			buildExactReplayUrl(base, '/videos/test.mp4', 123).url
		];
		for (const value of urls) {
			expect(new URL(value).searchParams.getAll('token')).toEqual(['new-token']);
		}
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
		vi.stubGlobal('fetch', fetchMock);
		await fetchReplayState(base);
		expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('token')).toBe('new-token');
	});

	it('keeps an existing URL token when the separate option is empty', () => {
		const base = 'https://replays.example/?token=existing';
		expect(new URL(buildReplayStateUrl(replayBaseUrlWithToken(base, '')).url).searchParams.get('token')).toBe('existing');
		expect(new URL(buildReplayStateUrl(replayBaseUrlWithToken('replays.example', '')).url).searchParams.has('token')).toBe(false);
		expect(buildReplayStateUrl(replayBaseUrlWithToken('http://[invalid', 'secret')).error).toBeTruthy();
	});

	it('preserves the token across all endpoints without forwarding unrelated options', () => {
		const base = 'https://replays.example/?token=secret&ignored=value';
		const urls = [
			buildStatusSocketUrl(base),
			buildReplayStateUrl(base).url,
			buildReplaySessionsUrl(base).url,
			buildReplaySessionLiftsUrl(base, 'session').url,
			buildReplayUrl(base, 1, 123).url,
			buildExactReplayUrl(base, '/videos/test.mp4', 123).url
		];
		for (const value of urls) {
			const url = new URL(value);
			expect(url.searchParams.get('token')).toBe('secret');
			expect(url.searchParams.has('ignored')).toBe(false);
		}
		expect(urls[0].startsWith('wss://')).toBe(true);
		expect(buildExactReplayUrl(base, 'https://other.example/video').error).toBeTruthy();
	});

	it('does not include tokens in playback failure reports', () => {
		const payload = buildReplayPlaybackFailurePayload({
			replayUrl: 'http://example.test/video?token=secret',
			videoElement: { currentSrc: 'http://example.test/video?token=secret' }
		});
		expect(JSON.stringify(payload)).not.toContain('secret');
	});

	it('redacts encoded tokens in playback errors', () => {
		const payload = buildReplayPlaybackFailurePayload({
			replayUrl: 'https://tracker.test/?replaysBaseUrl=https%3A%2F%2Fhost%2F%3Ftoken%3Dsecret',
			videoElement: { currentSrc: 'http://example.test/video?token=secret' }
		});
		expect(JSON.stringify(payload)).not.toContain('secret');
	});

	it('redacts the separate token option from replay failure reports', () => {
		vi.stubGlobal('window', { location: { href: 'https://tracker.test/replays?replayToken=secret%2Bmore&other=1' } });
		const payload = buildReplayPlaybackFailurePayload({});
		expect(payload.details.pageUrl).toContain('replayToken=[redacted]&other=1');
		expect(JSON.stringify(payload)).not.toContain('secret');
		expect(JSON.stringify(payload)).not.toContain('more');
	});

	it('reports a rejected replay token', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
		expect(await fetchReplayState('http://example.test/?token=bad')).toEqual({
			error: 'Replays token missing, wrong or expired'
		});
	});
});
