import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	buildStatusSocketUrl, buildReplayStateUrl, buildReplaySessionsUrl,
	buildReplaySessionLiftsUrl, buildReplayUrl, buildExactReplayUrl,
	buildReplayPlaybackFailurePayload, fetchReplayState
} from '../helpers.client.js';

describe('replay token URLs', () => {
	afterEach(() => vi.unstubAllGlobals());
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

	it('reports a rejected replay token', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
		expect(await fetchReplayState('http://example.test/?token=bad')).toEqual({
			error: 'Replays token missing, wrong or expired'
		});
	});
});
