import { beforeEach, describe, expect, it, vi } from 'vitest';

const registry = vi.hoisted(() => ({
	initialize: vi.fn(),
	getScoreboard: vi.fn(),
	getBaseScoreboard: vi.fn(),
	saveOptionDefaults: vi.fn(),
	reloadScoreboard: vi.fn()
}));

vi.mock('$lib/server/scoreboard-registry.js', () => ({ scoreboardRegistry: registry }));

import { GET, POST } from '../src/routes/api/plugin-action/+server.js';

function jsonRequest(url, body) {
	return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

describe('saving plugin options', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		registry.getScoreboard.mockReturnValue({
			config: { options: [{ key: 'replayToken', type: 'password', default: 'old-token' }] }
		});
		registry.getBaseScoreboard.mockReturnValue(null);
		registry.saveOptionDefaults.mockReturnValue({ success: true, savedKeys: ['replayToken'] });
	});

	it('accepts a token and an empty override in the POST body', async () => {
		const url = new URL('http://tracker.test/api/plugin-action?plugin=replays&action=saveOptions');
		for (const token of ['new-token', '']) {
			const request = jsonRequest(url, { replayToken: token });
			const response = await POST({ url, request });
			expect(response.status).toBe(200);
			expect(registry.saveOptionDefaults).toHaveBeenLastCalledWith('replays', { replayToken: token });
		}
	});

	it('retains existing GET action support', async () => {
		const url = new URL('http://tracker.test/api/plugin-action?plugin=replays&action=saveOptions&replayToken=legacy');
		expect((await GET({ url })).status).toBe(200);
		expect(registry.saveOptionDefaults).toHaveBeenCalledWith('replays', { replayToken: 'legacy' });
	});

	it('passes body options to any action and keeps them out of the URL', async () => {
		const handleAction = vi.fn().mockResolvedValue({ success: true });
		registry.getScoreboard.mockReturnValue({
			handleAction,
			config: { options: [{ key: 'streamKey', type: 'password', default: '' }] }
		});
		const url = new URL('http://tracker.test/api/plugin-action?plugin=streaming&action=configureOBS&platform=A');
		const request = jsonRequest(url, { streamKey: 'live_123' });
		expect((await POST({ url, request })).status).toBe(200);
		expect(handleAction).toHaveBeenCalledWith({
			action: 'configureOBS',
			options: expect.objectContaining({ streamKey: 'live_123', platform: 'A' })
		});
		expect(url.search).not.toContain('live_123');
	});

	it('refuses a body that is not a flat object', async () => {
		const url = new URL('http://tracker.test/api/plugin-action?plugin=replays&action=saveOptions');
		for (const body of [['x'], { replayToken: { nested: true } }, { action: 'other' }]) {
			expect((await POST({ url, request: jsonRequest(url, body) })).status).toBe(400);
		}
		expect(registry.saveOptionDefaults).not.toHaveBeenCalled();
	});

	it('still accepts action requests without a body', async () => {
		const handleAction = vi.fn().mockResolvedValue({ success: true });
		registry.getScoreboard.mockReturnValue({ handleAction, config: { options: [] } });
		const url = new URL('http://tracker.test/api/plugin-action?plugin=streaming&action=status&obsHost=h');
		expect((await POST({ url, request: new Request(url, { method: 'POST' }) })).status).toBe(200);
		expect(handleAction).toHaveBeenCalledWith({ action: 'status', options: expect.objectContaining({ obsHost: 'h' }) });
	});
});
