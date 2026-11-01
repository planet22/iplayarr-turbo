import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { App } from '../types/App';

// Encryption of stored credentials (AES-256-GCM, field level). The point is that a copy of the
// database file (iplayarr.db, or a backup of it) no longer contains usable
// third-party credentials: the key lives OUTSIDE the database - in the SECRETS_KEY environment variable, or
// a key file (SECRETS_KEY_FILE, default <CACHE_LOCATION>/secrets.key, created on first use).
// It does not protect against someone who can read both the key and the data, or the running process.

const PREFIX = 'enc:v1:';

// Settings whose stored value is encrypted. AUTH_PASSWORD is already a bcrypt hash.
export const ENCRYPTED_SETTINGS = ['API_KEY', 'STREAM_KEY', 'OIDC_CLIENT_SECRET', 'STRM_WATCHDOG_WEBHOOK_URL'];

let cachedKey: Buffer | null | undefined;

function keyFilePath(): string {
    return process.env.SECRETS_KEY_FILE || path.join(process.env.CACHE_LOCATION || path.join(process.cwd(), 'cache'), 'secrets.key');
}

// Returns the 32-byte key, or null when none can be obtained (then values are stored as before and
// a warning is logged - startup must not fail because a volume is read-only).
function getKey(): Buffer | null {
    if (cachedKey !== undefined) return cachedKey;
    try {
        if (process.env.SECRETS_KEY) {
            cachedKey = crypto.createHash('sha256').update(process.env.SECRETS_KEY).digest();
            return cachedKey;
        }
        const file = keyFilePath();
        if (fs.existsSync(file)) {
            cachedKey = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
            if (cachedKey.length !== 32) throw new Error(`${file} does not contain a 32-byte hex key`);
            return cachedKey;
        }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const fresh = crypto.randomBytes(32);
        fs.writeFileSync(file, fresh.toString('hex'), { mode: 0o600, flag: 'wx' });
        console.log(`Generated a new key for encrypting stored credentials at ${file}. Back it up alongside your database backups; without it stored keys cannot be read.`);
        cachedKey = fresh;
    } catch (err: any) {
        console.error(`Credential encryption is OFF: ${err?.message ?? err}. Set SECRETS_KEY or make SECRETS_KEY_FILE writable.`);
        cachedKey = null;
    }
    return cachedKey ?? null;
}

// Test hook / key change: forget the cached key.
export function resetKeyCache(): void {
    cachedKey = undefined;
}

export const isEncrypted = (value: unknown): boolean => typeof value === 'string' && value.startsWith(PREFIX);

export function encryptSecret<T extends string | undefined>(value: T): T | string {
    if (!value || isEncrypted(value)) return value;
    const key = getKey();
    if (!key) return value;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `${PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

// Plain (legacy, not yet migrated) values pass straight through. An encrypted value that cannot be
// decrypted (wrong or missing key) yields undefined rather than leaking ciphertext into a request.
export function decryptSecret<T extends string | undefined>(value: T): T | string | undefined {
    if (!isEncrypted(value)) return value;
    const key = getKey();
    if (!key) return undefined;
    try {
        const [iv, tag, data] = (value as string).slice(PREFIX.length).split(':').map((p) => Buffer.from(p, 'base64'));
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch {
        console.error('A stored credential could not be decrypted (wrong or lost secrets key). Re-enter it in Settings.');
        return undefined;
    }
}

const mapApp = (app: App, fn: (v: string | undefined) => string | undefined): App => ({
    ...app,
    ...(app.api_key !== undefined ? { api_key: fn(app.api_key) } : {}),
    ...(app.password !== undefined ? { password: fn(app.password) } : {}),
    ...(app.download_client ? { download_client: { ...app.download_client, ...(app.download_client.api_key !== undefined ? { api_key: fn(app.download_client.api_key) } : {}) } } : {}),
    ...(app.indexer ? { indexer: { ...app.indexer, ...(app.indexer.api_key !== undefined ? { api_key: fn(app.indexer.api_key) } : {}) } } : {}),
});

export const hasPlainSecret = (app: App): boolean =>
    [app.api_key, app.password, app.download_client?.api_key, app.indexer?.api_key].some((v) => !!v && !isEncrypted(v));

export const encryptApp = (app: App): App => mapApp(app, encryptSecret);
export const decryptApp = (app: App): App => mapApp(app, decryptSecret);

export function mapSettings(config: Record<string, string>, fn: (v: string | undefined) => string | undefined): Record<string, string> {
    const out = { ...config };
    for (const key of ENCRYPTED_SETTINGS) {
        if (out[key]) {
            const v = fn(out[key]);
            if (v === undefined) delete out[key];
            else out[key] = v;
        }
    }
    return out;
}
export const encryptSettings = (c: Record<string, string>) => mapSettings(c, encryptSecret);
export const decryptSettings = (c: Record<string, string>) => mapSettings(c, decryptSecret);
