import fs from 'fs';
import os from 'os';
import path from 'path';

import { App } from '../../src/types/App';
import {
    decryptApp,
    decryptSecret,
    decryptSettings,
    encryptApp,
    encryptSecret,
    encryptSettings,
    hasPlainSecret,
    isEncrypted,
    resetKeyCache,
} from '../../src/utils/secretCrypto';

describe('secretCrypto', () => {
    afterEach(() => {
        process.env.SECRETS_KEY = 'jest-secrets-key';
        delete process.env.SECRETS_KEY_FILE;
        resetKeyCache();
    });

    it('round-trips and never stores the plaintext', () => {
        const enc = encryptSecret('my-sonarr-key') as string;
        expect(isEncrypted(enc)).toBe(true);
        expect(enc).not.toContain('my-sonarr-key');
        expect(decryptSecret(enc)).toBe('my-sonarr-key');
    });

    it('uses a fresh IV each time and is idempotent on already-encrypted values', () => {
        const a = encryptSecret('same') as string;
        expect(a).not.toBe(encryptSecret('same'));
        expect(encryptSecret(a)).toBe(a);
    });

    it('leaves empty values and legacy plaintext alone when decrypting', () => {
        expect(encryptSecret(undefined)).toBeUndefined();
        expect(encryptSecret('')).toBe('');
        expect(decryptSecret('plain-legacy')).toBe('plain-legacy');
    });

    it('detects tampering and a wrong key without leaking ciphertext', () => {
        const enc = encryptSecret('secret') as string;
        const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(decryptSecret(enc.slice(0, -4) + 'AAAA')).toBeUndefined();
        process.env.SECRETS_KEY = 'a-different-key';
        resetKeyCache();
        expect(decryptSecret(enc)).toBeUndefined();
        err.mockRestore();
    });

    it('encrypts every credential field of an app and decrypts them back', () => {
        const app = { id: '1', name: 'n', api_key: 'k', password: 'p', download_client: { id: 1, api_key: 'd' }, indexer: { id: 2, api_key: 'i', priority: 1 } } as unknown as App;
        const enc = encryptApp(app);
        expect(JSON.stringify(enc)).not.toMatch(/"(k|p|d|i)"/);
        expect(hasPlainSecret(enc)).toBe(false);
        expect(hasPlainSecret(app)).toBe(true);
        expect(decryptApp(enc)).toEqual(app);
    });

    it('encrypts only the credential settings', () => {
        const cfg = { API_KEY: 'a', STREAM_KEY: 's', OIDC_CLIENT_SECRET: 'o', DOWNLOAD_DIR: '/d', AUTH_PASSWORD: '$2b$x' };
        const enc = encryptSettings(cfg);
        expect(enc.DOWNLOAD_DIR).toBe('/d');
        expect(enc.AUTH_PASSWORD).toBe('$2b$x');
        expect(isEncrypted(enc.API_KEY)).toBe(true);
        expect(decryptSettings(enc)).toEqual(cfg);
    });

    it('creates a key file on first use when no SECRETS_KEY is set, and reuses it', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-'));
        const file = path.join(dir, 'nested', 'secrets.key');
        delete process.env.SECRETS_KEY;
        process.env.SECRETS_KEY_FILE = file;
        resetKeyCache();
        const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        const enc = encryptSecret('x') as string;
        expect(fs.readFileSync(file, 'utf8')).toMatch(/^[0-9a-f]{64}$/);
        resetKeyCache();
        expect(decryptSecret(enc)).toBe('x');
        log.mockRestore();
    });

    it('falls back to plaintext (and says so) if no key can be obtained', () => {
        delete process.env.SECRETS_KEY;
        process.env.SECRETS_KEY_FILE = path.join(os.tmpdir(), 'no-such-dir-' + Date.now(), '\0bad');
        resetKeyCache();
        const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(encryptSecret('x')).toBe('x');
        expect(err).toHaveBeenCalled();
        err.mockRestore();
    });
});
