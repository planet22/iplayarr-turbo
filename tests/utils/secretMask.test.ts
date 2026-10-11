import { App } from '../../src/types/App';
import { maskApp, maskConfig, restoreApp, restoreConfig, SECRET_MASK } from '../../src/utils/secretMask';

const app = {
    id: '1',
    name: 'Sonarr',
    api_key: 'real-key',
    password: 'real-pw',
    download_client: { id: 1, api_key: 'dc-key' },
    indexer: { id: 2, api_key: 'ix-key', priority: 1 },
} as unknown as App;

describe('secretMask', () => {
    it('masks every credential on an app and leaves the rest', () => {
        const masked = maskApp(app);
        expect(masked.api_key).toBe(SECRET_MASK);
        expect(masked.password).toBe(SECRET_MASK);
        expect(masked.download_client?.api_key).toBe(SECRET_MASK);
        expect(masked.indexer?.api_key).toBe(SECRET_MASK);
        expect(masked.name).toBe('Sonarr');
        expect(JSON.stringify(masked)).not.toMatch(/real-key|real-pw|dc-key|ix-key/);
    });

    it('does not invent a mask for credentials that are not set', () => {
        expect(maskApp({ id: '2', name: 'x' } as unknown as App).api_key).toBeUndefined();
    });

    it('restores stored values where the mask came back, but keeps genuinely edited ones', () => {
        const form = { ...maskApp(app), api_key: 'new-key' } as App;
        const restored = restoreApp(form, app);
        expect(restored.api_key).toBe('new-key');
        expect(restored.password).toBe('real-pw');
        expect(restored.download_client?.api_key).toBe('dc-key');
        expect(restored.indexer?.api_key).toBe('ix-key');
    });

    it('a mask with nothing stored never gets saved as a literal key', () => {
        expect(restoreApp({ api_key: SECRET_MASK } as Partial<App>, undefined).api_key).toBeUndefined();
    });

    it('masks and restores the secret settings', () => {
        const stored = { AUTH_PASSWORD: '$2b$hash', OIDC_CLIENT_SECRET: 'sec', DOWNLOAD_DIR: '/d' };
        const masked = maskConfig(stored);
        expect(masked).toEqual({ AUTH_PASSWORD: SECRET_MASK, OIDC_CLIENT_SECRET: SECRET_MASK, DOWNLOAD_DIR: '/d' });
        expect(restoreConfig({ ...masked, OIDC_CLIENT_SECRET: 'changed' }, stored)).toEqual({
            AUTH_PASSWORD: '$2b$hash',
            OIDC_CLIENT_SECRET: 'changed',
            DOWNLOAD_DIR: '/d',
        });
    });
});
