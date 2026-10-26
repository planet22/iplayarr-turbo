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

    describe('key sources', () => {
        const setEnv = (vars: Record<string, string | undefined>) => {
            for (const [k, v] of Object.entries(vars)) {
                if (v === undefined) delete process.env[k];
                else process.env[k] = v;
            }
        };
        const withEnv = (vars: Record<string, string | undefined>, fn: () => void) => {
            const saved: Record<string, string | undefined> = {};
            for (const k of Object.keys(vars)) saved[k] = process.env[k];
            try {
                setEnv(vars);
                resetKeyCache();
                fn();
            } finally {
                setEnv(saved);
                resetKeyCache();
            }
        };

        it('puts the default key file under CACHE_LOCATION when no file is named', () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-cache-'));
            const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
            withEnv({ SECRETS_KEY: undefined, SECRETS_KEY_FILE: undefined, CACHE_LOCATION: dir }, () => {
                encryptSecret('x');
                expect(fs.existsSync(path.join(dir, 'secrets.key'))).toBe(true);
            });
            log.mockRestore();
        });

        it('falls back to ./cache when neither a file nor CACHE_LOCATION is set', () => {
            const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-cwd-'));
            const spy = jest.spyOn(process, 'cwd').mockReturnValue(cwd);
            const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
            withEnv({ SECRETS_KEY: undefined, SECRETS_KEY_FILE: undefined, CACHE_LOCATION: undefined }, () => {
                encryptSecret('x');
                expect(fs.existsSync(path.join(cwd, 'cache', 'secrets.key'))).toBe(true);
            });
            spy.mockRestore();
            log.mockRestore();
        });

        it('refuses a key file that is not a 32-byte hex key, and stores values unencrypted', () => {
            const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sk-bad-')), 'secrets.key');
            fs.writeFileSync(file, 'abcd');
            const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
            withEnv({ SECRETS_KEY: undefined, SECRETS_KEY_FILE: file }, () => {
                expect(encryptSecret('x')).toBe('x');
                expect(err).toHaveBeenCalledWith(expect.stringContaining('does not contain a 32-byte hex key'));
            });
            err.mockRestore();
        });

        it('reports a non-Error failure by its value', () => {
            const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
            const spy = jest.spyOn(fs, 'existsSync').mockImplementation(() => {
                throw 'disk gone';
            });
            withEnv({ SECRETS_KEY: undefined, SECRETS_KEY_FILE: '/x/secrets.key' }, () => {
                encryptSecret('x');
                expect(err).toHaveBeenCalledWith(expect.stringContaining('Credential encryption is OFF: disk gone.'));
            });
            spy.mockRestore();
            err.mockRestore();
        });

        it('cannot decrypt anything when no key is available, instead of passing ciphertext on', () => {
            const enc = encryptSecret('secret') as string;
            const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
            withEnv({ SECRETS_KEY: undefined, SECRETS_KEY_FILE: path.join(os.tmpdir(), 'no-such-dir-' + Date.now(), '\0bad') }, () => {
                expect(decryptSecret(enc)).toBeUndefined();
            });
            err.mockRestore();
        });
    });

    describe('partial apps and settings', () => {
        it('leaves absent credential fields absent and keeps empty strings', () => {
            const bare = { id: '1', name: 'n' } as unknown as App;
            expect(encryptApp(bare)).toEqual(bare);
            expect(encryptApp({ ...bare, api_key: '' } as App)).toEqual({ ...bare, api_key: '' });
            expect(Object.keys(encryptApp({ ...bare, password: 'p' } as App))).toContain('password');
            expect(Object.keys(encryptApp(bare))).not.toContain('api_key');
        });

        it('leaves absent nested credentials absent', () => {
            const app = { id: '1', name: 'n', download_client: { id: 1 }, indexer: { id: 2, priority: 1 } } as unknown as App;
            const out = encryptApp(app);
            expect(out.download_client).toEqual({ id: 1 });
            expect(out.indexer).toEqual({ id: 2, priority: 1 });
        });

        it('finds a plain secret in a nested credential only', () => {
            expect(hasPlainSecret({ id: '1', download_client: { api_key: 'plain' } } as unknown as App)).toBe(true);
            expect(hasPlainSecret({ id: '1', indexer: { api_key: 'plain' } } as unknown as App)).toBe(true);
            expect(hasPlainSecret({ id: '1' } as unknown as App)).toBe(false);
        });

        it('drops a setting that cannot be decrypted instead of leaving ciphertext in it', () => {
            const cfg = { API_KEY: encryptSecret('a') as string, STREAM_KEY: 's' };
            const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
            process.env.SECRETS_KEY = 'a-different-key';
            resetKeyCache();
            const out = decryptSettings(cfg);
            expect(out).not.toHaveProperty('API_KEY');
            expect(out.STREAM_KEY).toBe('s');
            err.mockRestore();
        });

        it('ignores credential settings that are blank or absent', () => {
            expect(encryptSettings({ API_KEY: '', DOWNLOAD_DIR: '/d' })).toEqual({ API_KEY: '', DOWNLOAD_DIR: '/d' });
        });
    });
});
