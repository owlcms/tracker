/**
 * Saved plugin defaults (config-override.json5) and their secrets.
 *
 * Options declared with `type: 'password'` are encrypted with the key in ~/.owlcms/tracker.aes when written, and
 * decrypted when the registry reads them, so plugins only ever see plain values.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { decryptSecret, encryptSecret, isEncrypted } from './secret-store.js';

const OVERRIDE_HEADER = [
	'// Runtime default overrides for this plugin.',
	'// The tracker reads only options[].default from this file.',
	'// Password options are encrypted with ~/.owlcms/tracker.aes.',
	'// JSON5 syntax: comments and trailing commas are allowed.',
	''
].join('\n');

export function writeOverrideFile(writePath, payload) {
	mkdirSync(dirname(writePath), { recursive: true });
	writeFileSync(writePath, `${OVERRIDE_HEADER}${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/** The value to write for an option: encrypted for password options, unchanged otherwise. */
export function valueForStorage(option, value) {
	return option?.type === 'password' ? encryptSecret(value) : value;
}

/** A saved default that cannot be decrypted here becomes empty, so the user is asked to type it again. */
export function revealSecretDefault(key, value) {
	try {
		return decryptSecret(value);
	} catch (err) {
		console.warn(`[ScoreboardRegistry] Option ${key}: ${err.message}`);
		return '';
	}
}

/**
 * Encrypts the password defaults that an earlier version wrote in plain text, and rewrites the file.
 *
 * @param {{path: string, config: {options?: Array}}} override the parsed override file; its config is updated
 * @param {{options?: Array}} config the plugin configuration that declares the option types
 */
export function protectStoredSecrets(override, config) {
	const passwordKeys = new Set(
		(config?.options || []).filter((option) => option?.type === 'password' && option.key).map((option) => option.key)
	);
	let changed = false;
	try {
		const options = (override.config?.options || []).map((option) => {
			if (!passwordKeys.has(option?.key) || typeof option.default !== 'string'
				|| option.default.trim() === '' || isEncrypted(option.default)) {
				return option;
			}
			changed = true;
			return { ...option, default: encryptSecret(option.default) };
		});
		if (!changed) return;
		override.config = { ...override.config, options };
		writeOverrideFile(override.path, override.config);
		console.log(`[ScoreboardRegistry] Encrypted saved secrets in ${override.path}`);
	} catch (err) {
		console.warn(`[ScoreboardRegistry] Could not encrypt saved secrets in ${override.path}: ${err.message}`);
	}
}
