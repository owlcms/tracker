import { createDecipheriv, createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSecretStore, isEncrypted, SecretReentryRequired } from '../src/lib/server/secret-store.js';

describe('secret store', () => {
	let dir;
	let keyPath;
	let store;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'tracker-secret-'));
		keyPath = join(dir, 'owlcms', 'tracker.aes');
		store = createSecretStore(() => keyPath);
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it('creates the key on first encryption and round-trips a value', () => {
		const sealed = store.encrypt(' sample-Token_42 ');
		expect(existsSync(keyPath)).toBe(true);
		expect(statSync(keyPath).mode & 0o077).toBe(0);
		expect(sealed.startsWith('enc:v1:')).toBe(true);
		expect(sealed).not.toContain('sample-Token_42');
		expect(store.decrypt(sealed)).toBe('sample-Token_42');
		expect(store.encrypt('sample-Token_42')).not.toBe(sealed);
	});

	it('uses the Control Panel and OWLCMS value layout', () => {
		const sealed = store.encrypt('secret value');
		const key = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64');
		const [, , fingerprint, body] = sealed.split(':');
		expect(key.length).toBe(32);
		expect(fingerprint).toBe(createHash('sha256').update(key).digest('hex').slice(0, 8));
		const raw = Buffer.from(body, 'base64');
		const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
		decipher.setAuthTag(raw.subarray(raw.length - 16));
		const plain = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]);
		expect(plain.toString('utf8')).toBe('secret value');
	});

	it('keeps blank, plain and already encrypted values as they are', () => {
		expect(store.encrypt('')).toBe('');
		expect(store.encrypt('   ')).toBe('');
		expect(existsSync(keyPath)).toBe(false);
		expect(store.decrypt('')).toBe('');
		expect(store.decrypt('plain value')).toBe('plain value');
		const sealed = store.encrypt('abc');
		expect(store.encrypt(sealed)).toBe(sealed);
		expect(isEncrypted(sealed)).toBe(true);
		expect(isEncrypted('abc')).toBe(false);
	});

	it('asks for the value again when the key is missing, different or the value is damaged', () => {
		const sealed = store.encrypt('abc');
		const [prefix, version, fingerprint, body] = sealed.split(':');

		const missing = createSecretStore(() => join(dir, 'missing.aes'));
		expect(() => missing.decrypt(sealed)).toThrow(SecretReentryRequired);

		writeFileSync(join(dir, 'other.aes'), `${Buffer.alloc(32, 7).toString('base64')}\n`);
		expect(() => createSecretStore(() => join(dir, 'other.aes')).decrypt(sealed)).toThrow(SecretReentryRequired);

		const tampered = Buffer.from(body, 'base64');
		tampered[tampered.length - 1] ^= 1;
		expect(() => store.decrypt([prefix, version, fingerprint, tampered.toString('base64')].join(':')))
			.toThrow(SecretReentryRequired);
		expect(() => store.decrypt('enc:v1:nonsense')).toThrow(SecretReentryRequired);
	});

	it('refuses to use a key of the wrong size', () => {
		store.encrypt('abc');
		writeFileSync(keyPath, 'c2hvcnQ=\n');
		expect(() => store.encrypt('another')).toThrow(/invalid encryption key/);
	});
});
