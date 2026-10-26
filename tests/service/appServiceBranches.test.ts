import arrFacade from '../../src/facade/arrFacade';
import nzbFacade from '../../src/facade/nzbFacade';
import appService, { encryptStoredApps } from '../../src/service/appService';
import configService from '../../src/service/configService';
import jellyfinService from '../../src/service/jellyfinService';
import { App } from '../../src/types/App';
import { AppType } from '../../src/types/AppType';
import { isEncrypted } from '../../src/utils/secretCrypto';

const mockStorageData: Record<string, any> = {};
jest.mock('../../src/types/QueuedStorage', () => {
    const instance = {
        getItem: jest.fn(async (key: string) => mockStorageData[key]),
        setItem: jest.fn(async (key: string, value: any) => {
            mockStorageData[key] = value;
        }),
    };
    return { QueuedStorage: jest.fn(() => instance), __esModule: true };
});
jest.mock('../../src/facade/arrFacade', () => ({
    __esModule: true,
    default: {
        testConnection: jest.fn(),
        upsertDownloadClient: jest.fn(),
        upsertIndexer: jest.fn(),
        deleteDownloadClient: jest.fn(),
        deleteIndexer: jest.fn(),
    },
}));
jest.mock('../../src/facade/nzbFacade', () => ({ __esModule: true, default: { testConnection: jest.fn() } }));
jest.mock('../../src/service/jellyfinService', () => ({ __esModule: true, default: { testConnection: jest.fn() } }));
jest.mock('../../src/service/configService', () => ({ __esModule: true, default: { getParameter: jest.fn() } }));
jest.mock('../../src/service/socketService', () => ({ __esModule: true, default: { emit: jest.fn() } }));

const arr = arrFacade as jest.Mocked<typeof arrFacade>;

const sonarr = (over: Partial<App> = {}): App =>
    ({
        id: 'app-1',
        name: 'Sonarr',
        type: AppType.SONARR,
        url: 'http://sonarr',
        api_key: 'plain-key',
        iplayarr: { host: 'iplayarr', port: 4404, useSSL: false },
        download_client: { name: 'iPlayarr', priority: 1 },
        indexer: { name: 'iPlayarr', priority: 25 },
        ...over,
    }) as any as App;

describe('appService branches', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Object.keys(mockStorageData).forEach((k) => delete mockStorageData[k]);
        (configService.getParameter as jest.Mock).mockResolvedValue('the-api-key');
        arr.upsertDownloadClient.mockResolvedValue(11 as any);
        arr.upsertIndexer.mockResolvedValue(22 as any);
        arr.deleteDownloadClient.mockResolvedValue(undefined as any);
        arr.deleteIndexer.mockResolvedValue(undefined as any);
    });

    describe('encryptStoredApps', () => {
        it('does nothing when there are no apps', async () => {
            await encryptStoredApps();
            expect(mockStorageData.apps).toBeUndefined();
        });

        it('encrypts credentials stored in plain text, once', async () => {
            mockStorageData.apps = [{ id: 'a', name: 'x', type: AppType.SONARR, api_key: 'plain', password: 'pw' }];
            await encryptStoredApps();
            expect(isEncrypted(mockStorageData.apps[0].api_key)).toBe(true);
            expect(isEncrypted(mockStorageData.apps[0].password)).toBe(true);
            const stored = mockStorageData.apps;
            await encryptStoredApps();
            expect(mockStorageData.apps).toBe(stored);
        });
    });

    describe('testAppConnection', () => {
        it.each([[AppType.SONARR], [AppType.RADARR], [AppType.PROWLARR]])('asks the *arr facade to test a %s', async (type) => {
            arr.testConnection.mockResolvedValue(true as any);
            expect(await appService.testAppConnection(sonarr({ type }))).toBe(true);
            expect(arr.testConnection).toHaveBeenCalled();
        });

        it.each([[AppType.SABNZBD, 'sabnzbd'], [AppType.NZBGET, 'nzbget']])('asks the NZB facade to test a %s as "%s"', async (type, name) => {
            (nzbFacade.testConnection as jest.Mock).mockResolvedValue('bad key');
            const form = sonarr({ type, username: 'u', password: 'p' });
            expect(await appService.testAppConnection(form)).toBe('bad key');
            expect(nzbFacade.testConnection).toHaveBeenCalledWith(name, 'http://sonarr', 'plain-key', 'u', 'p');
        });

        describe('Jellyfin', () => {
            it('records that a saved server was reached, when the test passes', async () => {
                (jellyfinService.testConnection as jest.Mock).mockResolvedValue(true);
                mockStorageData.apps = [{ id: 'app-1', name: 'Jelly', type: AppType.JELLYFIN }];
                expect(await appService.testAppConnection(sonarr({ type: AppType.JELLYFIN }))).toBe(true);
                expect(mockStorageData.apps_last_seen).toHaveProperty('app-1');
            });

            it('does not record anything for an unsaved server or a failed test', async () => {
                (jellyfinService.testConnection as jest.Mock).mockResolvedValue(true);
                expect(await appService.testAppConnection(sonarr({ type: AppType.JELLYFIN, id: undefined as any }))).toBe(true);
                (jellyfinService.testConnection as jest.Mock).mockResolvedValue('Unauthorised');
                expect(await appService.testAppConnection(sonarr({ type: AppType.JELLYFIN }))).toBe('Unauthorised');
                expect(mockStorageData.apps_last_seen).toBeUndefined();
            });
        });
    });

    describe('createUpdateIntegrations', () => {
        it('creates both integrations with no tags when the app has none', async () => {
            const form = await appService.createUpdateIntegrations(sonarr({ tags: undefined }));
            expect(arr.upsertDownloadClient).toHaveBeenCalledWith(expect.objectContaining({ tags: [] }), expect.anything(), true);
            expect(arr.upsertIndexer).toHaveBeenCalledWith(expect.objectContaining({ tags: [], url: 'http://iplayarr:4404' }), expect.anything(), true);
            expect(form.download_client?.id).toBe(11);
            expect(form.indexer?.id).toBe(22);
        });

        it('builds an https URL when SSL is on, whether the setting arrives as a boolean or a string', async () => {
            await appService.createUpdateIntegrations(sonarr({ iplayarr: { host: 'h', port: 443, useSSL: true } as any }));
            expect(arr.upsertIndexer).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://h:443' }), expect.anything(), true);
            await appService.createUpdateIntegrations(sonarr({ iplayarr: { host: 'h', port: 443, useSSL: 'true' } as any }));
            expect(arr.upsertIndexer).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://h:443' }), expect.anything(), true);
            await appService.createUpdateIntegrations(sonarr({ iplayarr: { host: 'h', port: 80, useSSL: 'false' } as any }));
            expect(arr.upsertIndexer).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'http://h:80' }), expect.anything(), true);
        });

        it('rolls back a download client it just created when the indexer then fails', async () => {
            arr.upsertIndexer.mockRejectedValue(new Error('indexer refused'));
            await expect(appService.createUpdateIntegrations(sonarr())).rejects.toMatchObject({ type: 'indexer', message: 'indexer refused' });
            expect(arr.deleteDownloadClient).toHaveBeenCalledTimes(1);
        });

        it('leaves a download client alone that the app already had', async () => {
            arr.upsertIndexer.mockRejectedValue(new Error('indexer refused'));
            await expect(appService.createUpdateIntegrations(sonarr({ download_client: { id: 5, name: 'iPlayarr', priority: 1 } as any }))).rejects.toBeDefined();
            expect(arr.deleteDownloadClient).not.toHaveBeenCalled();
        });

        it('still reports the original failure if the rollback itself fails', async () => {
            arr.upsertIndexer.mockRejectedValue(new Error('indexer refused'));
            arr.deleteDownloadClient.mockRejectedValue(new Error('cannot delete'));
            await expect(appService.createUpdateIntegrations(sonarr())).rejects.toMatchObject({ message: 'indexer refused' });
        });

        it('reports a failing download client as such', async () => {
            arr.upsertDownloadClient.mockRejectedValue(new Error('refused'));
            await expect(appService.createUpdateIntegrations(sonarr())).rejects.toMatchObject({ type: 'download_client', message: 'refused' });
            expect(arr.upsertIndexer).not.toHaveBeenCalled();
        });

        describe('removing an integration whose name was cleared', () => {
            it('deletes the download client and the indexer from the *arr', async () => {
                const form = await appService.createUpdateIntegrations(
                    sonarr({ download_client: { id: 5, name: '', priority: 1 } as any, indexer: { id: 6, name: '', priority: 1 } as any })
                );
                expect(arr.deleteDownloadClient).toHaveBeenCalled();
                expect(arr.deleteIndexer).toHaveBeenCalled();
                expect(form.download_client).toBeUndefined();
                expect(form.indexer).toBeUndefined();
            });

            it('reports a failed delete with the integration it belongs to', async () => {
                arr.deleteDownloadClient.mockRejectedValue(new Error('no'));
                await expect(appService.createUpdateIntegrations(sonarr({ download_client: { id: 5, name: '' } as any }))).rejects.toMatchObject({ type: 'download_client' });
                arr.deleteDownloadClient.mockResolvedValue(undefined as any);
                arr.deleteIndexer.mockRejectedValue(new Error('no'));
                await expect(appService.createUpdateIntegrations(sonarr({ download_client: undefined, indexer: { id: 6, name: '' } as any }))).rejects.toMatchObject({ type: 'indexer' });
            });
        });
    });
});
