import appService, { encryptStoredApps } from '../../src/service/appService';
import configService, { encryptStoredSettings } from '../../src/service/configService';
import { dbReady, prisma } from '../../src/service/db/prismaService';
import { IplayarrParameter } from '../../src/types/IplayarrParameters';

jest.mock('../../src/facade/arrFacade');
jest.mock('../../src/facade/nzbFacade');
jest.mock('../../src/service/jellyfinService');

const rawGet = async (key: string): Promise<string | null> => {
    await dbReady();
    return (await prisma.keyValue.findUnique({ where: { key } }))?.value ?? null;
};
const rawSet = async (key: string, value: string): Promise<void> => {
    await dbReady();
    await prisma.keyValue.upsert({ where: { key }, create: { key, value }, update: { value } });
};

describe('credentials are encrypted in the database but transparent to callers', () => {
    it('settings: the raw row holds ciphertext, getParameter returns the real value', async () => {
        await configService.setParameter(IplayarrParameter.OIDC_CLIENT_SECRET, 'client-secret-123');
        await configService.setParameter(IplayarrParameter.DOWNLOAD_DIR, '/downloads');
        const raw = await rawGet('config');
        expect(raw).not.toContain('client-secret-123');
        expect(raw).toContain('/downloads');
        expect(await configService.getParameter(IplayarrParameter.OIDC_CLIENT_SECRET)).toBe('client-secret-123');
    });

    it('settings: legacy plaintext is migrated on startup and still readable', async () => {
        await rawSet('config', JSON.stringify({ API_KEY: 'legacy-api-key', DOWNLOAD_DIR: '/d' }));
        expect(await configService.getParameter(IplayarrParameter.API_KEY)).toBe('legacy-api-key');
        await encryptStoredSettings();
        expect(await rawGet('config')).not.toContain('legacy-api-key');
        expect(await configService.getParameter(IplayarrParameter.API_KEY)).toBe('legacy-api-key');
    });

    it('apps: keys and passwords are ciphertext at rest and plaintext through the service', async () => {
        await appService.addApp({ id: 'a1', name: 'Sonarr', api_key: 'sonarr-key', password: 'pw-1', indexer: { id: 1, api_key: 'ix-key', priority: 1 } } as any);
        const raw = (await rawGet('apps')) as string;
        for (const s of ['sonarr-key', 'pw-1', 'ix-key']) expect(raw).not.toContain(s);
        const app = await appService.getApp('a1');
        expect(app?.api_key).toBe('sonarr-key');
        expect(app?.password).toBe('pw-1');
        expect(app?.indexer?.api_key).toBe('ix-key');
    });

    it('apps: legacy plaintext is migrated and still readable', async () => {
        await rawSet('apps', JSON.stringify([{ id: 'a2', name: 'Radarr', api_key: 'legacy-radarr' }]));
        await encryptStoredApps();
        expect(await rawGet('apps')).not.toContain('legacy-radarr');
        expect((await appService.getApp('a2'))?.api_key).toBe('legacy-radarr');
    });
});
