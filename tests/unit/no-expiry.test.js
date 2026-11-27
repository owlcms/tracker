import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isNoExpiryEnabled, connectSSE, subscribeSSE, disconnectSSE } from '../../src/lib/sse-client.js';
import { sseBroker } from '../../src/lib/server/sse-broker.js';

describe('isNoExpiryEnabled', () => {
	it('returns true for noExpiry=true and bare noExpiry', () => {
		expect(isNoExpiryEnabled(new URLSearchParams('fop=A&noExpiry=true'))).toBe(true);
		expect(isNoExpiryEnabled(new URLSearchParams('fop=A&noExpiry'))).toBe(true);
		expect(isNoExpiryEnabled(new URLSearchParams('noExpiry='))).toBe(true);
	});

	it('returns false when absent, false, or invalid', () => {
		expect(isNoExpiryEnabled(new URLSearchParams('fop=A'))).toBe(false);
		expect(isNoExpiryEnabled(new URLSearchParams('fop=A&noExpiry=false'))).toBe(false);
		expect(isNoExpiryEnabled(new URLSearchParams('fop=A&noExpiry=0'))).toBe(false);
		expect(isNoExpiryEnabled(null)).toBe(false);
	});
});

describe('sseBroker.reapIdleClients with noExpiry', () => {
	const unregisters = [];

	afterEach(() => {
		while (unregisters.length > 0) {
			unregisters.pop()();
		}
		vi.restoreAllMocks();
	});

	it('reaps normal idle clients after 30 minutes while keeping noExpiry clients alive', () => {
		const baseTime = 1_700_000_000_000;
		vi.spyOn(Date, 'now').mockReturnValue(baseTime);

		const normalClose = vi.fn();
		const keepAliveClose = vi.fn();

		const unregisterNormal = sseBroker.registerClient(() => {}, 'conn-normal', 'A', null, {
			clientId: 'client-normal',
			scoreboardType: 'rankings',
			noExpiry: false,
			close: () => {
				normalClose();
				unregisterNormal();
			}
		});
		unregisters.push(unregisterNormal);

		const unregisterKeepAlive = sseBroker.registerClient(() => {}, 'conn-vmix', 'A', null, {
			clientId: 'client-vmix',
			scoreboardType: 'rankings',
			noExpiry: true,
			close: () => {
				keepAliveClose();
				unregisterKeepAlive();
			}
		});
		unregisters.push(unregisterKeepAlive);

		// Advance 31 minutes without any /api/scoreboard markSeen calls
		Date.now.mockReturnValue(baseTime + 31 * 60 * 1000);
		sseBroker.reapIdleClients();

		expect(normalClose).toHaveBeenCalledTimes(1);
		expect(keepAliveClose).not.toHaveBeenCalled();

		const remainingIds = Array.from(sseBroker.clients).map((c) => c.clientId);
		expect(remainingIds).not.toContain('client-normal');
		expect(remainingIds).toContain('client-vmix');
	});
});

describe('sse-client connectSSE with noExpiry', () => {
	const originalEventSource = globalThis.EventSource;
	const originalDocument = globalThis.document;
	let openedUrls = [];
	let instances = [];

	beforeEach(() => {
		vi.useFakeTimers();
		openedUrls = [];
		instances = [];
		disconnectSSE();

		class FakeEventSource {
			static CONNECTING = 0;
			static OPEN = 1;
			static CLOSED = 2;

			constructor(url) {
				this.url = url;
				this.readyState = FakeEventSource.OPEN;
				this.onmessage = null;
				this.onerror = null;
				openedUrls.push(url);
				instances.push(this);
			}

			close() {
				this.readyState = FakeEventSource.CLOSED;
			}
		}

		globalThis.EventSource = FakeEventSource;
		globalThis.document = {
			visibilityState: 'hidden',
			addEventListener: vi.fn()
		};
	});

	afterEach(() => {
		disconnectSSE();
		vi.useRealTimers();
		globalThis.EventSource = originalEventSource;
		globalThis.document = originalDocument;
	});

	it('sends noExpiry=true and reconnects while hidden when enabled', () => {
		const unsub = subscribeSSE(() => {});
		connectSSE('en', 'A', 'rankings', true);

		const active = instances[instances.length - 1];
		expect(active.url).toContain('noExpiry=true');

		const countBeforeDrop = openedUrls.length;
		active.readyState = globalThis.EventSource.CLOSED;
		active.onerror(new Error('dropped'));

		vi.advanceTimersByTime(2500);

		expect(openedUrls.length).toBe(countBeforeDrop + 1);
		expect(openedUrls[openedUrls.length - 1]).toContain('noExpiry=true');
		unsub();
	});

	it('suppresses hidden reconnect when noExpiry is false', () => {
		const unsub = subscribeSSE(() => {});
		connectSSE('en', 'A', 'rankings', false);

		const active = instances[instances.length - 1];
		expect(active.url).not.toContain('noExpiry=true');

		const countBeforeDrop = openedUrls.length;
		active.readyState = globalThis.EventSource.CLOSED;
		active.onerror(new Error('dropped'));

		vi.advanceTimersByTime(5000);

		expect(openedUrls.length).toBe(countBeforeDrop);
		unsub();
	});
});
