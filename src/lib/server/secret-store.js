/**
 * Encrypts saved secrets (tokens, PINs) with the key in ~/.owlcms/tracker.aes.
 *
 * The key is 32 random bytes in base64, created on first use with mode 0600 outside the install folder, so copying the
 * tracker folder does not carry it. Values use the same format as the Control Panel and OWLCMS:
 * enc:v1:<first 4 bytes of SHA-256(key), hex>:<base64(12-byte nonce + AES-256-GCM ciphertext + 16-byte tag)>
 * Values without the prefix are returned as they are, so hand-edited plain values still work.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const KEY_FILE_NAME = 'tracker.aes';

const PREFIX = 'enc:v1:';
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;

/** The saved value cannot be decrypted here; the user has to type it again. */
export class SecretReentryRequired extends Error {
	constructor(reason) {
		super(`the saved key must be entered again: ${reason}`);
		this.name = 'SecretReentryRequired';
	}
}

export function defaultKeyPath() {
	return join(homedir(), '.owlcms', KEY_FILE_NAME);
}

export function isEncrypted(value) {
	return typeof value === 'string' && value.trim().startsWith(PREFIX);
}

function fingerprint(key) {
	return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

function readKey(keyPath) {
	const key = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64');
	if (key.length !== 32) {
		throw new Error(`invalid encryption key in ${keyPath}`);
	}
	return key;
}

function loadKey(keyPath, create) {
	try {
		return readKey(keyPath);
	} catch (error) {
		if (error.code !== 'ENOENT' || !create) throw error;
	}

	mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
	let fd;
	try {
		fd = openSync(keyPath, 'wx', 0o600);
	} catch (error) {
		if (error.code === 'EEXIST') return readKey(keyPath);
		throw error;
	}
	const key = randomBytes(32);
	try {
		writeSync(fd, `${key.toString('base64')}\n`);
	} finally {
		closeSync(fd);
	}
	return key;
}

/** @param {() => string} keyPathProvider resolved at each use, so a changed home folder is honored */
export function createSecretStore(keyPathProvider = defaultKeyPath) {
	return {
		/** Blank gives an empty value; a value that is already encrypted is returned unchanged. */
		encrypt(plain) {
			const text = String(plain ?? '').trim();
			if (text === '' || isEncrypted(text)) return text;
			const key = loadKey(keyPathProvider(), true);
			const nonce = randomBytes(NONCE_LENGTH);
			const cipher = createCipheriv('aes-256-gcm', key, nonce);
			const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
			const sealed = Buffer.concat([nonce, encrypted, cipher.getAuthTag()]);
			return `${PREFIX}${fingerprint(key)}:${sealed.toString('base64')}`;
		},

		/** @throws {SecretReentryRequired} when the value was encrypted with another key, or is damaged */
		decrypt(value) {
			if (typeof value !== 'string' || value.trim() === '') return typeof value === 'string' ? '' : value;
			const text = value.trim();
			if (!isEncrypted(text)) return value;

			const payload = text.slice(PREFIX.length);
			const separator = payload.indexOf(':');
			if (separator < 0) throw new SecretReentryRequired('the saved value is invalid');

			let key;
			try {
				key = loadKey(keyPathProvider(), false);
			} catch (error) {
				if (error.code === 'ENOENT') {
					throw new SecretReentryRequired('it was encrypted on another computer or the key was removed');
				}
				throw error;
			}
			if (payload.slice(0, separator) !== fingerprint(key)) {
				throw new SecretReentryRequired('it was encrypted on another computer');
			}

			const sealed = Buffer.from(payload.slice(separator + 1), 'base64');
			if (sealed.length < NONCE_LENGTH + TAG_LENGTH) {
				throw new SecretReentryRequired('the saved value is invalid');
			}
			try {
				const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, NONCE_LENGTH));
				decipher.setAuthTag(sealed.subarray(sealed.length - TAG_LENGTH));
				return Buffer.concat([
					decipher.update(sealed.subarray(NONCE_LENGTH, sealed.length - TAG_LENGTH)),
					decipher.final()
				]).toString('utf8');
			} catch {
				throw new SecretReentryRequired('the saved value is invalid');
			}
		}
	};
}

const defaultStore = createSecretStore();

export const encryptSecret = (plain) => defaultStore.encrypt(plain);
export const decryptSecret = (value) => defaultStore.decrypt(value);
