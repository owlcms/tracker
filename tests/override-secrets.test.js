import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSON5 from 'json5';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { protectStoredSecrets, revealSecretDefault, valueForStorage } from '../src/lib/server/override-secrets.js';
import { isEncrypted } from '../src/lib/server/secret-store.js';
import replaysConfig from '../src/plugins/jury/replays/config.js';
import ledwallConfig from '../src/plugins/OBS/ledwall/config.js';
import streamingConfig from '../src/plugins/OBS/streaming/config.js';

const SECRETS = {
	streaming: ['obsPassword', 'streamKey', 'replayToken'],
	ledwall: ['obsPassword', 'replayToken'],
	replays: ['replayToken']
};
const configs = { streaming: streamingConfig, ledwall: ledwallConfig, replays: replaysConfig };

describe('encrypted option defaults', () => {
	let home;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), 'tracker-home-'));
		vi.stubEnv('HOME', home);
		vi.stubEnv('USERPROFILE', home);
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(home, { recursive: true, force: true });
	});

	it.each(Object.keys(SECRETS))('declares the secrets of the %s plugin as password options', (plugin) => {
		const byKey = Object.fromEntries(configs[plugin].options.map((option) => [option.key, option]));
		for (const key of SECRETS[plugin]) {
			expect(byKey[key]?.type, `${plugin}.${key}`).toBe('password');
		}
	});

	it.each(Object.keys(SECRETS))('encrypts a saved %s secret and returns it decrypted', (plugin) => {
		for (const key of SECRETS[plugin]) {
			const option = configs[plugin].options.find((candidate) => candidate.key === key);
			const stored = valueForStorage(option, `value-of-${key}`);
			expect(isEncrypted(stored)).toBe(true);
			expect(stored).not.toContain(`value-of-${key}`);
			expect(revealSecretDefault(key, stored)).toBe(`value-of-${key}`);
		}
		const text = configs[plugin].options.find((option) => option.type !== 'password');
		expect(valueForStorage(text, 'visible')).toBe('visible');
	});

	it.each(['streaming', 'ledwall'])('encrypts secrets saved in plain text in the %s override file', (plugin) => {
		const path = join(home, 'config-override.json5');
		const options = configs[plugin].options.filter((option) => option.type === 'text').slice(0, 2)
			.map((option) => ({ key: option.key, default: `visible-${option.key}` }))
			.concat(SECRETS[plugin].map((key) => ({ key, default: `plain-${key}` })))
			.concat([{ key: 'streamServer', default: '' }]);
		const override = { path, config: { options } };
		writeFileSync(path, JSON.stringify(override.config));

		protectStoredSecrets(override, configs[plugin]);

		const written = readFileSync(path, 'utf8');
		for (const key of SECRETS[plugin]) expect(written).not.toContain(`plain-${key}`);
		expect(written).toContain('visible-');
		const saved = Object.fromEntries(JSON5.parse(written).options.map((option) => [option.key, option.default]));
		for (const key of SECRETS[plugin]) {
			expect(isEncrypted(saved[key])).toBe(true);
			expect(revealSecretDefault(key, saved[key])).toBe(`plain-${key}`);
		}

		const again = readFileSync(path, 'utf8');
		protectStoredSecrets({ path, config: JSON5.parse(again) }, configs[plugin]);
		expect(readFileSync(path, 'utf8')).toBe(again);
	});

	it('returns an empty value when a saved secret was encrypted with another key', () => {
		const option = replaysConfig.options.find((candidate) => candidate.key === 'replayToken');
		const stored = valueForStorage(option, 'abc');
		vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'tracker-other-home-')));
		vi.stubEnv('USERPROFILE', process.env.HOME);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(revealSecretDefault('replayToken', stored)).toBe('');
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
		rmSync(process.env.HOME, { recursive: true, force: true });
	});
});
