import { describe, expect, it } from 'vitest';

import { CheckpointRunner, RETRY_MS } from '../checkpoint-runner.js';

/** A runner with a fake clock and timers; pulls answer from a queue of outcomes. */
function harness(outcomes = []) {
	let time = 1_000_000;
	const timers = [];
	const pulls = [];
	const persisted = [];
	const runner = new CheckpointRunner({
		pull: async (settings) => {
			pulls.push(settings);
			return outcomes.shift() || { outcome: 'stored', name: `n${pulls.length}` };
		},
		persist: (r) => persisted.push({ started: r.started, ...r.settings }),
		now: () => time,
		setTimer: (fn, delay) => {
			const timer = { fn, at: time + delay };
			timers.push(timer);
			return timer;
		},
		clearTimer: (timer) => timers.splice(timers.indexOf(timer), 1)
	});
	runner.configure({ owlcmsUrl: 'http://owlcms.local:8080', secret: 's', folder: '/checkpoints', intervalMinutes: 5 });
	return {
		runner,
		pulls,
		persisted,
		pending: () => timers.length,
		/** advances the clock to the next timer and runs it */
		async next() {
			const timer = timers.shift();
			time = timer.at;
			await timer.fn();
			return timer;
		},
		advance(ms) {
			time += ms;
		}
	};
}

const exists = () => true;
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('checkpoint runner', () => {
	it('pulls nothing until Start, and pulls right away on Start', async () => {
		const h = harness();
		h.runner.databaseReceived();
		await flush();
		expect(h.pulls).toHaveLength(0);

		expect(h.runner.start(exists)).toEqual({ success: true });
		await flush();
		expect(h.pulls).toHaveLength(1);
		expect(h.runner.snapshot()).toMatchObject({ started: true, lastCheckpoint: 'n1', settings: { hasSecret: true } });
		expect(h.runner.snapshot().settings.secret).toBeUndefined();
	});

	it('refuses Start without an address or an existing folder', () => {
		const h = harness();
		expect(h.runner.start(() => false).success).toBe(false);
		h.runner.configure({ owlcmsUrl: '' });
		expect(h.runner.start(exists).success).toBe(false);
		expect(h.runner.started).toBe(false);
	});

	it('pulls at every interval, whatever the hub has seen', async () => {
		const h = harness();
		h.runner.start(exists);
		await flush();
		expect(h.pulls).toHaveLength(1);

		for (let i = 2; i <= 4; i++) {
			const timer = await h.next();
			expect(h.pulls).toHaveLength(i);
			expect(timer.at - h.runner.status.lastCheckpointAt).toBe(0);
			expect(h.runner.status.nextPullAt - timer.at).toBe(5 * 60_000);
		}
	});

	it('pulls right away when OWLCMS sends its database', async () => {
		const h = harness();
		h.runner.start(exists);
		await flush();
		h.runner.databaseReceived();
		await flush();
		expect(h.pulls).toHaveLength(2);
		expect(h.pending()).toBe(1);
	});

	it('retries every minute while OWLCMS does not answer, then returns to the interval', async () => {
		const h = harness([
			{ outcome: 'unreachable', message: 'ECONNREFUSED' },
			{ outcome: 'unreachable', message: 'ECONNREFUSED' }
		]);
		h.runner.start(exists);
		await flush();
		expect(h.runner.snapshot()).toMatchObject({ waiting: true, lastError: 'ECONNREFUSED' });

		const firstAttempt = h.runner.status.lastAttemptAt;
		const retry = await h.next();
		expect(h.pulls).toHaveLength(2);
		expect(retry.at - firstAttempt).toBe(RETRY_MS);

		await h.next();
		expect(h.pulls).toHaveLength(3);
		expect(h.runner.snapshot()).toMatchObject({ waiting: false, lastError: null, lastCheckpoint: 'n3' });
		expect(h.runner.status.nextPullAt - h.runner.status.lastAttemptAt).toBe(5 * 60_000);
	});

	it('retries checkpoint folder errors without reporting that it is waiting for OWLCMS', async () => {
		const h = harness([{ outcome: 'local-error', message: 'cannot apply checkpoint: disk full' }]);
		h.runner.start(exists);
		await flush();
		expect(h.runner.snapshot()).toMatchObject({
			waiting: false,
			folderError: true,
			lastError: 'cannot apply checkpoint: disk full'
		});

		const firstAttempt = h.runner.status.lastAttemptAt;
		const retry = await h.next();
		expect(retry.at - firstAttempt).toBe(RETRY_MS);
		expect(h.runner.snapshot()).toMatchObject({ waiting: false, folderError: false, lastCheckpoint: 'n2' });
	});

	it('stops on a refusal instead of retrying, and keeps the error visible', async () => {
		const h = harness([{ outcome: 'refused', status: 401, message: 'wrong secret' }]);
		h.runner.start(exists);
		await flush();
		expect(h.runner.started).toBe(false);
		expect(h.pending()).toBe(0);
		expect(h.runner.snapshot().lastError).toBe('wrong secret');
		expect(h.persisted.at(-1).started).toBe(false);
	});

	it('takes one checkpoint on request while stopped, without starting polling', async () => {
		const h = harness();
		expect(await h.runner.requestCheckpoint(exists)).toEqual({ success: true, name: 'n1' });
		expect(h.runner.started).toBe(false);
		expect(h.pending()).toBe(0);
		expect(h.runner.snapshot().lastCheckpoint).toBe('n1');

		const refused = harness([{ outcome: 'refused', status: 401, message: 'wrong secret' }]);
		expect(await refused.runner.requestCheckpoint(exists)).toEqual({ success: false, message: 'wrong secret' });
		expect(refused.runner.snapshot().lastError).toBe('wrong secret');
		expect(await refused.runner.requestCheckpoint(() => false)).toMatchObject({ success: false });
	});

	it('takes one checkpoint on request while started and restarts the interval', async () => {
		const h = harness();
		h.runner.start(exists);
		await flush();
		h.advance(2 * 60_000);
		expect(await h.runner.requestCheckpoint(exists)).toEqual({ success: true, name: 'n2' });
		expect(h.runner.started).toBe(true);
		expect(h.pending()).toBe(1);
		expect(h.runner.status.nextPullAt - h.runner.status.lastCheckpointAt).toBe(5 * 60_000);
	});

	it('refuses a requested checkpoint while another is being taken', async () => {
		let release;
		const runner = new CheckpointRunner({
			pull: () => new Promise((resolve) => (release = resolve)),
			setTimer: () => null,
			clearTimer: () => {}
		});
		runner.configure({ owlcmsUrl: 'http://x', folder: '/f' });
		const first = runner.requestCheckpoint(exists);
		expect(await runner.requestCheckpoint(exists)).toMatchObject({ success: false });
		release({ outcome: 'stored', name: 'n1' });
		expect(await first).toEqual({ success: true, name: 'n1' });
	});

	it('locks the settings while started, keeps the secret when left blank, and persists Start and Stop', () => {
		const h = harness();
		h.runner.configure({ secret: '' });
		expect(h.runner.settings.secret).toBe('s');
		expect(h.runner.configure({ intervalMinutes: 0 }).success).toBe(false);
		h.runner.start(exists);
		expect(h.runner.configure({ folder: '/elsewhere' }).success).toBe(false);
		expect(h.persisted.at(-1)).toMatchObject({ started: true, folder: '/checkpoints' });
		h.runner.stop();
		expect(h.persisted.at(-1).started).toBe(false);
		expect(h.pending()).toBe(0);
	});
});
