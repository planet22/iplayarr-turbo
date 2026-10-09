import { v4 as uuidv4 } from 'uuid';

import nzbFacade from '../../src/facade/nzbFacade';
import appService from '../../src/service/appService';
import socketService from '../../src/service/socketService';
import userAgentMappingService from '../../src/service/userAgentMappingService';
import { App } from '../../src/types/App';
import { AppType } from '../../src/types/AppType';
import { QueuedStorage } from '../../src/types/QueuedStorage';

jest.mock('uuid', () => ({ v4: jest.fn() }));

const mockStorageData: Record<string, any> = {};
jest.mock('../../src/types/QueuedStorage', () => {
    const mockStorageInstance = {
        getItem: jest.fn((key: string) => {
            return Promise.resolve(mockStorageData[key]);
        }),
        setItem: jest.fn((key: string, value: any) => {
            mockStorageData[key] = value;
            return Promise.resolve();
        }),
    };
    return {
        QueuedStorage: jest.fn(() => mockStorageInstance),
        __esModule: true,
    };
});

jest.mock('../../src/facade/arrFacade', () => ({
    testConnection: jest.fn(),
    upsertDownloadClient: jest.fn(),
    upsertIndexer: jest.fn(),
}));

jest.mock('../../src/service/configService', () => ({
    getParameter: jest.fn(),
}));

jest.mock('../../src/facade/nzbFacade', () => ({
    testConnection: jest.fn(),
}));

jest.mock('../../src/service/socketService', () => ({
    emit: jest.fn(),
}));

const mockStorage = (QueuedStorage as jest.Mock).mock.results[0].value;

describe('appService', () => {
    let clock = 1_000_000;
    beforeEach(() => {
        jest.clearAllMocks();
        // touchApp is throttled per app; step the clock past the window for each test.
        jest.spyOn(Date, 'now').mockReturnValue((clock += 120_000));
        Object.keys(mockStorageData).forEach((k) => delete mockStorageData[k]);
    });

    it('adds a new app and assigns an ID if not present', async () => {
        const id = 'test-id';
        (uuidv4 as jest.Mock).mockReturnValue(id);
        const app: App = {
            id: undefined,
            type: AppType.RADARR,
            url: 'http://localhost',
            tags: [],
            iplayarr: { host: 'localhost', port: 7878, useSSL: false },
        } as any;

        const result = await appService.addApp(app);

        expect(result?.id).toBe(id);
        expect(mockStorage.setItem).toHaveBeenCalledWith(
            'apps',
            expect.arrayContaining([expect.objectContaining({ id })])
        );
    });

    it('removes an app', async () => {
        const app: App = { id: '123', type: AppType.RADARR } as any;
        await appService.addApp(app);

        await appService.removeApp('123');

        expect(mockStorage.setItem).toHaveBeenCalledWith('apps', []);
    });

    it('updates an app by merging and re-adding it', async () => {
        const app: App = { id: '123', name: 'Old Name', type: AppType.RADARR } as any;
        await appService.addApp(app);

        await appService.updateApp({ id: '123', name: 'New Name' });

        expect(mockStorage.setItem).toHaveBeenCalledWith('apps', [expect.objectContaining({ name: 'New Name' })]);
    });

    it('returns undefined when updating non-existent app', async () => {
        const result = await appService.updateApp({ id: 'does-not-exist', name: 'Test' });

        expect(result).toBeUndefined();
    });

    it('finds an app via a mapped User-Agent substring, matched by app name', async () => {
        const app: App = { id: 'sonarr-1', name: 'Iplayarr-sonarr', type: AppType.SONARR } as any;
        await appService.addApp(app);
        await userAgentMappingService.addMapping({ id: 'map-1', userAgent: 'Sonarr', appName: 'iplayarr-sonarr' });

        const result = await appService.findAppByUserAgent('Sonarr/4.0.0.0 (linux)');

        expect(result?.id).toBe('sonarr-1');
    });

    it('stamps lastSeen on the matched mapping', async () => {
        const app: App = { id: 'sonarr-1', name: 'Iplayarr-sonarr', type: AppType.SONARR } as any;
        await appService.addApp(app);
        await userAgentMappingService.addMapping({ id: 'map-1', userAgent: 'Sonarr', appName: 'Iplayarr-sonarr' });

        await appService.findAppByUserAgent('Sonarr/4.0.0.0 (linux)');

        const [mapping] = await userAgentMappingService.getAllMappings();
        expect(mapping.lastSeen).toEqual(expect.any(Number));
    });

    it('stamps lastSeen on the app resolved via User-Agent', async () => {
        await appService.addApp({ id: 'sonarr-1', name: 'Iplayarr-sonarr', type: AppType.SONARR } as any);
        await userAgentMappingService.addMapping({ id: 'map-1', userAgent: 'Sonarr', appName: 'Iplayarr-sonarr' });

        await appService.findAppByUserAgent('Sonarr/4.0.0.0 (linux)');

        expect((await appService.getApp('sonarr-1'))?.lastSeen).toEqual(expect.any(Number));
    });

    it('touchApp stamps only the given app', async () => {
        await appService.addApp({ id: 'a', name: 'A', type: AppType.SONARR } as any);
        await appService.addApp({ id: 'b', name: 'B', type: AppType.RADARR } as any);

        await appService.touchApp('a');

        expect((await appService.getApp('a'))?.lastSeen).toEqual(expect.any(Number));
        expect((await appService.getApp('b'))?.lastSeen).toBeUndefined();
    });

    it('touchApp ignores unknown app IDs without writing', async () => {
        await appService.addApp({ id: 'a', name: 'A', type: AppType.SONARR } as any);
        mockStorage.setItem.mockClear();

        await appService.touchApp('missing');

        expect(mockStorage.setItem).not.toHaveBeenCalled();
    });

    it('touchApp is throttled and never throws', async () => {
        await appService.addApp({ id: 'a', name: 'A', type: AppType.SONARR } as any);
        await appService.touchApp('a');
        const first = (await appService.getApp('a'))?.lastSeen;
        (Date.now as jest.Mock).mockReturnValue(clock + 1000);
        await appService.touchApp('a');
        expect((await appService.getApp('a'))?.lastSeen).toBe(first);
    });

    it('updateApp does not let a stale form overwrite lastSeen', async () => {
        await appService.addApp({ id: 'a', name: 'A', type: AppType.SONARR, lastSeen: 2000 } as any);

        await appService.updateApp({ id: 'a', name: 'Renamed', lastSeen: 1000 });

        const app = await appService.getApp('a');
        expect(app?.name).toBe('Renamed');
        expect(app?.lastSeen).toBe(2000);
    });

    it('returns undefined when no mapping matches', async () => {
        const app: App = { id: 'sonarr-1', name: 'Iplayarr-sonarr', type: AppType.SONARR } as any;
        await appService.addApp(app);
        await userAgentMappingService.addMapping({ id: 'map-1', userAgent: 'Sonarr', appName: 'Iplayarr-sonarr' });

        const result = await appService.findAppByUserAgent('Radarr/5.0.0.0 (linux)');

        expect(result).toBeUndefined();
    });

    it('returns undefined when the mapping\'s app name matches no configured App', async () => {
        await userAgentMappingService.addMapping({ id: 'map-1', userAgent: 'Sonarr', appName: 'Unknown App' });

        const result = await appService.findAppByUserAgent('Sonarr/4.0.0.0 (linux)');

        expect(result).toBeUndefined();
    });

    it('returns undefined and leaves a blank-appName mapping alone', async () => {
        await userAgentMappingService.addMapping({ id: 'map-1', userAgent: 'Sonarr', appName: '' });

        const result = await appService.findAppByUserAgent('Sonarr/4.0.0.0 (linux)');

        expect(result).toBeUndefined();
        expect((await userAgentMappingService.getAllMappings())).toHaveLength(1);
    });

    it('auto-records an unrecognised User-Agent with a blank appName', async () => {
        (uuidv4 as jest.Mock).mockReturnValue('generated-id');

        const result = await appService.findAppByUserAgent('Sonarr/4.0.0.0 (linux)');

        expect(result).toBeUndefined();
        expect(await userAgentMappingService.getAllMappings()).toEqual([
            { userAgent: 'Sonarr/4.0.0.0 (linux)', appName: '', id: 'generated-id', lastSeen: expect.any(Number) },
        ]);
    });

    it('returns undefined when no User-Agent header is supplied', async () => {
        const result = await appService.findAppByUserAgent(undefined);

        expect(result).toBeUndefined();
    });

    it('tests connection for NZBGET app', async () => {
        const form = { type: AppType.NZBGET, url: 'url', api_key: 'key', username: 'u', password: 'p' } as any;
        await appService.testAppConnection(form);
        expect(nzbFacade.testConnection).toHaveBeenCalledWith('nzbget', 'url', 'key', 'u', 'p');
    });

    it('updates API key and emits socket events', async () => {
        const app: App = { id: 'abc', type: AppType.RADARR } as any;
        await appService.addApp(app);

        const mockCreateUpdate = jest.spyOn(appService, 'createUpdateIntegrations').mockResolvedValue(app);

        await appService.updateApiKey();

        expect(socketService.emit).toHaveBeenCalledWith(
            'app_update_status',
            expect.objectContaining({ status: 'In Progress' })
        );
        expect(mockCreateUpdate).toHaveBeenCalled();
    });
});
