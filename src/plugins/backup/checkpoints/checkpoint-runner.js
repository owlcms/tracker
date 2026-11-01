/**
 * Recovery checkpoints: when to pull. No I/O of its own: the pull, the clock and the timers are injected.
 *
 * While started:
 * - Start, and database:received (OWLCMS started, reconnected or sent its database), pull right away.
 * - At each interval, pull only if competition activity was seen since the last pull, or if the last stored
 *   checkpoint is older than UNCONDITIONAL_MS.
 * - When OWLCMS does not answer (no response, 5xx, incomplete zip), try again every RETRY_MS until it does.
 * - When OWLCMS refuses (wrong secret, role, lockout), stop: retrying would keep the officials PIN locked out.
 */

export const RETRY_MS = 60_000;
export const UNCONDITIONAL_MS = 30 * 60_000;
export const DEFAULT_INTERVAL_MINUTES = 5;

export class CheckpointRunner {
	/**
	 * @param {object} p
	 * @param {(settings: object) => Promise<object>} p.pull  pulls and stores one checkpoint (see pullCheckpoint)
	 * @param {(runner: CheckpointRunner) => void} [p.persist]  called when the settings or the started state change
	 */
	constructor({ pull, persist = () => {}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
		this.pull = pull;
		this.persist = persist;
		this.now = now;
		this.setTimer = setTimer;
		this.clearTimer = clearTimer;
		this.settings = { owlcmsUrl: '', secret: '', folder: '', intervalMinutes: DEFAULT_INTERVAL_MINUTES };
		this.started = false;
		this.activity = false;
		this.pulling = false;
		this.again = false;
		this.timer = null;
		this.lastStoredAt = 0;
		this.status = {
			lastCheckpoint: null,
			lastCheckpointAt: null,
			lastAttemptAt: null,
			nextPullAt: null,
			lastError: null,
			waiting: false
		};
	}

	intervalMs() {
		const minutes = Number(this.settings.intervalMinutes);
		return Math.max(1, Number.isFinite(minutes) ? minutes : DEFAULT_INTERVAL_MINUTES) * 60_000;
	}

	/** Settings are changed only while stopped. A blank secret keeps the current one. */
	configure({ owlcmsUrl, secret, folder, intervalMinutes } = {}) {
		if (this.started) {
			return { success: false, message: 'Stop checkpoints before changing the settings.' };
		}
		if (owlcmsUrl !== undefined) this.settings.owlcmsUrl = String(owlcmsUrl).trim();
		if (secret !== undefined && String(secret) !== '') this.settings.secret = String(secret);
		if (folder !== undefined) this.settings.folder = String(folder).trim();
		if (intervalMinutes !== undefined && intervalMinutes !== '') {
			const minutes = Math.round(Number(intervalMinutes));
			if (!Number.isFinite(minutes) || minutes < 1) {
				return { success: false, message: 'The interval is a number of minutes, at least 1.' };
			}
			this.settings.intervalMinutes = minutes;
		}
		this.persist(this);
		return { success: true };
	}

	/** @param {(folder: string) => boolean} folderExists */
	start(folderExists) {
		if (this.started) return { success: true };
		if (!this.settings.owlcmsUrl) {
			return { success: false, message: 'Enter the OWLCMS address first.' };
		}
		if (!this.settings.folder || !folderExists(this.settings.folder)) {
			return { success: false, message: 'Choose an existing checkpoint folder first.' };
		}
		this.started = true;
		this.status.lastError = null;
		this.status.waiting = false;
		this.persist(this);
		this.pullNow();
		return { success: true };
	}

	stop() {
		this.started = false;
		this.cancelTimer();
		this.status.nextPullAt = null;
		this.status.waiting = false;
		this.persist(this);
		return { success: true };
	}

	/** After a tracker restart: resume polling without counting it as a new Start. */
	resume() {
		if (this.started) this.pullNow();
	}

	noteActivity() {
		this.activity = true;
	}

	databaseReceived() {
		this.activity = true;
		this.pullNow();
	}

	pullNow() {
		if (!this.started) return Promise.resolve();
		if (this.pulling) {
			this.again = true;
			return Promise.resolve();
		}
		this.cancelTimer();
		return this.runPull();
	}

	async tick() {
		this.timer = null;
		if (!this.started || this.pulling) return;
		const due =
			this.activity || this.status.waiting || this.now() - this.lastStoredAt >= UNCONDITIONAL_MS;
		if (due) {
			await this.runPull();
		} else {
			this.schedule(this.intervalMs());
		}
	}

	async runPull() {
		this.pulling = true;
		this.activity = false;
		this.status.lastAttemptAt = this.now();
		let result;
		try {
			result = await this.pull({ ...this.settings });
		} catch (error) {
			result = { outcome: 'unreachable', message: error.message };
		}
		this.pulling = false;
		if (!this.started) return;

		if (result.outcome === 'stored') {
			this.lastStoredAt = this.now();
			this.status.lastCheckpoint = result.name;
			this.status.lastCheckpointAt = this.lastStoredAt;
			this.status.lastError = null;
			this.status.waiting = false;
			this.schedule(this.intervalMs());
		} else if (result.outcome === 'refused') {
			this.status.lastError = result.message;
			this.stop();
			return;
		} else {
			this.status.lastError = result.message;
			this.status.waiting = true;
			this.schedule(RETRY_MS);
		}

		if (this.again) {
			this.again = false;
			await this.pullNow();
		}
	}

	schedule(delayMs) {
		this.cancelTimer();
		this.status.nextPullAt = this.now() + delayMs;
		this.timer = this.setTimer(() => this.tick(), delayMs);
	}

	cancelTimer() {
		if (this.timer) {
			this.clearTimer(this.timer);
			this.timer = null;
		}
	}

	snapshot() {
		const { secret, ...settings } = this.settings;
		return { started: this.started, pulling: this.pulling, settings: { ...settings, hasSecret: !!secret }, ...this.status };
	}
}
