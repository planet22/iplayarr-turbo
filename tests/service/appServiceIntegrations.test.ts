import arrFacade from '../../src/facade/arrFacade';
import appService from '../../src/service/appService';
import socketService from '../../src/service/socketService';
import userAgentMappingService from '../../src/service/userAgentMappingService';
import { App } from '../../src/types/App';
import { AppType } from '../../src/types/AppType';

const store: Record<string, any> = {};
jest.mock('../../src/types/QueuedStorage', () => ({
    __esModule: true,
    QueuedStorage: jest.fn(() => ({
        getItem: jest.fn(async (k: string) => store[k]),
        setItem: jest.fn(async (k: string, v: any) => {
            store[k] = v;
        }),
    })),
}));
jest.mock('../../src/facade/arrFacade', () => ({
    __esModule: true,
    default: {
        upsertDownloadClient: jest.fn(),
        upsertIndexer: jest.fn(),
        deleteDownloadClient: jest.fn(),
        deleteIndexer: jest.fn(),
        testConnection: jest.fn(),
    },
}));
jest.mock('../../src/facade/nzbFacade', () => ({ __esModule: true, default: { testConnection: jest.fn() } }));
jest.mock('../../src/service/configService', () => ({ __esModule: true, default: { getParameter: jest.fn().mockResolvedValue('apikey') } }));
jest.mock('../../src/service/socketService', () => ({ __esModule: true, default: { emit: jest.fn() } }));
jest.mock('../../src/service/userAgentMappingService', () => ({
    __esModule: true,
    default: { getAllMappings: jest.fn(), recordSeenUserAgent: jest.fn(), touchMapping: jest.fn() },
}));

const mockedArr = jest.mocked(arrFacade);
const flush = () => new Promise((r) => setImmediate(r));

const baseApp = (over: Partial<App> = {}): App =>
    ({
        id: 'a1',
        name: 'Sonarr',
        type: AppType.SONARR,
        url: 'http://sonarr',
        api_key: 'k',
        iplayarr: { host: 'ip', port: 4404, useSSL: false },
        download_client: { name: 'dc', priority: 1 },
        indexer: { name: 'idx', priority: 2 },
        tags: ['t'],
        ...over,
    }) as any;

describe('appService integrations', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Object.keys(store).forEach((k) => delete store[k]);
    });

    describe('findAppByUserAgent', () => {
        const app = baseApp();
        beforeEach(() => {
            store.apps = [app];
        });

        it('returns undefined with no user agent', async () => {
            expect(await appService.findAppByUserAgent()).toBeUndefined();
        });

        it('records an unseen user agent', async () => {
            (userAgentMappingService.getAllMappings as jest.Mock).mockResolvedValue([]);
            expect(await appService.findAppByUserAgent('Foo/1')).toBeUndefined();
            expect(userAgentMappingService.recordSeenUserAgent).toHaveBeenCalledWith('Foo/1');
        });

        it('returns the mapped app, case-insensitively, and touches the mapping', async () => {
            (userAgentMappingService.getAllMappings as jest.Mock).mockResolvedValue([{ id: 'm', userAgent: 'Sonarr', appName: 'SONARR' }]);
            expect(await appService.findAppByUserAgent('Sonarr/4')).toEqual(app);
            expect(userAgentMappingService.touchMapping).toHaveBeenCalledWith('m');
        });

        it('returns undefined when the mapping has no app', async () => {
            (userAgentMappingService.getAllMappings as jest.Mock).mockResolvedValue([{ id: 'm', userAgent: 'Sonarr', appName: '' }]);
            expect(await appService.findAppByUserAgent('Sonarr/4')).toBeUndefined();
        });
    });

    describe('updateApp', () => {
        it('merges into an existing app', async () => {
            store.apps = [baseApp()];
            const updated = await appService.updateApp({ id: 'a1', name: 'New' });
            expect(updated?.name).toBe('New');
            expect(store.apps).toHaveLength(1);
            expect(store.apps[0].name).toBe('New');
        });
        it('returns undefined for unknown or id-less updates', async () => {
            store.apps = [];
            expect(await appService.updateApp({ id: 'nope' })).toBeUndefined();
            expect(await appService.updateApp({ name: 'x' })).toBeUndefined();
        });
    });

    describe('createUpdateIntegrations', () => {
        it('creates the download client and indexer, then stores the app', async () => {
            store.apps = [baseApp()];
            mockedArr.upsertDownloadClient.mockResolvedValue(11);
            mockedArr.upsertIndexer.mockResolvedValue(22);
            const result = await appService.createUpdateIntegrations(baseApp());
            expect(result.download_client?.id).toBe(11);
            expect(result.indexer?.id).toBe(22);
            expect(mockedArr.upsertIndexer).toHaveBeenCalledWith(
                expect.objectContaining({ url: 'http://ip:4404', downloadClientId: 11, tags: ['t'], apiKey: 'apikey' }),
                expect.anything(),
                true
            );
            expect(store.apps[0].indexer.id).toBe(22);
        });

        it('builds an https URL for string "true" useSSL', async () => {
            store.apps = [baseApp()];
            mockedArr.upsertDownloadClient.mockResolvedValue(1);
            mockedArr.upsertIndexer.mockResolvedValue(2);
            await appService.createUpdateIntegrations(baseApp({ iplayarr: { host: 'ip', port: 1, useSSL: 'true' } as any }));
            expect(mockedArr.upsertIndexer).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://ip:1' }), expect.anything(), true);
        });

        it('deletes cleared download client and indexer', async () => {
            const app = baseApp({ download_client: { id: 5 } as any, indexer: { id: 6 } as any });
            store.apps = [app];
            const result = await appService.createUpdateIntegrations(app);
            expect(mockedArr.deleteDownloadClient).toHaveBeenCalled();
            expect(mockedArr.deleteIndexer).toHaveBeenCalled();
            expect(result.download_client).toBeUndefined();
            expect(result.indexer).toBeUndefined();
        });

        it('tags download client errors and rolls nothing back when none was created', async () => {
            mockedArr.upsertDownloadClient.mockRejectedValue(new Error('dc fail'));
            await expect(appService.createUpdateIntegrations(baseApp())).rejects.toEqual({ message: 'dc fail', type: 'download_client' });
            expect(mockedArr.deleteDownloadClient).not.toHaveBeenCalled();
        });

        it('rolls back a newly created download client when the indexer fails', async () => {
            mockedArr.upsertDownloadClient.mockResolvedValue(11);
            mockedArr.upsertIndexer.mockRejectedValue(new Error('idx fail'));
            mockedArr.deleteDownloadClient.mockRejectedValue(new Error('cleanup failed'));
            await expect(appService.createUpdateIntegrations(baseApp())).rejects.toEqual({ message: 'idx fail', type: 'indexer' });
            expect(mockedArr.deleteDownloadClient).toHaveBeenCalled();
        });

        it('surfaces delete failures with their type', async () => {
            mockedArr.deleteDownloadClient.mockRejectedValue(new Error('dc del'));
            await expect(appService.createUpdateIntegrations(baseApp({ download_client: { id: 5 } as any }))).rejects.toEqual({
                message: 'dc del',
                type: 'download_client',
            });
            mockedArr.deleteDownloadClient.mockResolvedValue(undefined);
            mockedArr.deleteIndexer.mockRejectedValue(new Error('idx del'));
            await expect(
                appService.createUpdateIntegrations(baseApp({ download_client: { id: 5, name: 'dc' } as any, indexer: { id: 6 } as any }))
            ).rejects.toEqual({ message: 'idx del', type: 'indexer' });
        });
    });

    describe('updateApiKey', () => {
        it('re-syncs apps with callbacks and reports status over the socket', async () => {
            store.apps = [baseApp({ id: 'ok' }), baseApp({ id: 'bad' }), { id: 'x', name: 'x', type: AppType.SABNZBD } as any];
            mockedArr.upsertDownloadClient.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('nope'));
            mockedArr.upsertIndexer.mockResolvedValue(2);
            await appService.updateApiKey();
            await flush();
            await flush();
            const emits = (socketService.emit as jest.Mock).mock.calls.map(([, p]) => p);
            expect(emits).toEqual(expect.arrayContaining([
                { id: 'ok', status: 'In Progress' },
                { id: 'ok', status: 'Complete' },
                { id: 'bad', status: 'In Progress' },
                expect.objectContaining({ id: 'bad', status: 'Error' }),
            ]));
            expect(emits.some((p) => p.id === 'x')).toBe(false);
        });
    });

    describe('testAppConnection', () => {
        it('returns false for unsupported types', async () => {
            expect(await appService.testAppConnection({ type: 'OTHER' } as any)).toBe(false);
        });
        it('delegates *arr types to arrFacade', async () => {
            mockedArr.testConnection.mockResolvedValue(true);
            expect(await appService.testAppConnection(baseApp())).toBe(true);
        });
    });
});
