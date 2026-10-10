import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';

import arrLibraryService from '../../src/service/arr/ArrLibraryService';
import configService from '../../src/service/configService';
import historyService from '../../src/service/historyService';
import jellyfinService from '../../src/service/jellyfinService';
import NativeStreamService from '../../src/service/stream/NativeStreamService';
import strmWatchdogService, { mapPath } from '../../src/service/strmWatchdogService';
import subscriptionService from '../../src/service/subscriptionService';
import videoEventService from '../../src/service/videoEventService';

jest.mock('../../src/service/configService', () => ({ getParameter: jest.fn() }));
jest.mock('../../src/service/historyService', () => ({ getHistory: jest.fn(), removeHistory: jest.fn(async () => undefined) }));
jest.mock('axios', () => ({ get: jest.fn(async () => ({ status: 200 })), post: jest.fn(async () => ({})) }));
jest.mock('../../src/service/socketService', () => ({ emit: jest.fn() }));
jest.mock('../../src/service/arr/ArrLibraryService', () => ({
    supports: jest.fn((app: { type?: string }) => app.type !== 'JELLYFIN'),
    getFilePaths: jest.fn(),
    unmonitor: jest.fn(async () => undefined),
    search: jest.fn(async () => undefined),
}));
jest.mock('../../src/service/appService', () => ({ getAllApps: jest.fn(async () => [{ id: 'a', name: 'Sonarr' }]) }));
jest.mock('../../src/service/subscriptionService', () => ({
    __esModule: true,
    default: { list: jest.fn(async () => []) },
}));
jest.mock('../../src/service/jellyfinService', () => ({
    supports: jest.fn((app: { type: string }) => app.type === 'JELLYFIN'),
    getItems: jest.fn(),
}));
jest.mock('../../src/service/loggingService', () => ({ log: jest.fn(), error: jest.fn() }));
jest.mock('../../src/service/videoEventService', () => ({ record: jest.fn() }));
jest.mock('../../src/service/stream/NativeStreamService', () => ({ checkAvailable: jest.fn() }));
jest.mock('../../src/types/QueuedStorage', () => {
    const store: Record<string, unknown> = {};
    return {
        __store: store,
        QueuedStorage: jest.fn(() => ({
            getItem: async (k: string) => store[k],
            setItem: async (k: string, v: unknown) => {
                store[k] = v;
            },
        })),
    };
});

describe('mapPath', () => {
    it('rewrites the first matching prefix and leaves other paths alone', () => {
        expect(mapPath('/tv/Show/a.strm', '/movies=/m;/tv=/library/tv')).toBe('/library/tv/Show/a.strm');
        expect(mapPath('/other/a.strm', '/tv=/library/tv')).toBe('/other/a.strm');
        expect(mapPath('/tv/a.strm', undefined)).toBe('/tv/a.strm');
    });
});

const BAD = 'm001sx3h'; // expired on BBC in these tests
const GOOD = 'm002tshj'; // still available

describe('StrmWatchdogService', () => {
    let tmpDir: string;
    let badPath: string;
    let action: string;
    let extra: Record<string, string>;
    let bbcDown: boolean;

    const strm = (pid: string) => `http://h/api?mode=stream&pid=${pid}&streamkey=k`;

    beforeEach(() => {
        for (const key of Object.keys((jest.requireMock('../../src/types/QueuedStorage') as any).__store)) {
            delete (jest.requireMock('../../src/types/QueuedStorage') as any).__store[key];
        }
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iplayarr-watchdog-'));
        badPath = path.join(tmpDir, 'bad.strm');
        fs.writeFileSync(badPath, strm(BAD));
        fs.writeFileSync(path.join(tmpDir, 'good.strm'), strm(GOOD));
        action = 'notify';
        extra = {};
        bbcDown = false;
        (configService.getParameter as jest.Mock).mockImplementation(async (param: string) => ({
            STRM_WATCHDOG_ENABLED: 'true',
            STRM_WATCHDOG_SOURCES: 'history',
            STRM_WATCHDOG_ACTION: action,
            COMPLETE_DIR: tmpDir,
            ...extra,
        })[param]);
        // Bad link listed first so it is seen before BBC has been confirmed up.
        (historyService.getHistory as jest.Mock).mockResolvedValue([
            { pid: BAD, extension: 'strm', nzbName: 'bad', type: 'tv', libraryPath: 'bad.strm' },
            { pid: GOOD, extension: 'strm', nzbName: 'good', type: 'tv', libraryPath: 'good.strm' },
        ]);
        (NativeStreamService.checkAvailable as jest.Mock).mockImplementation(async (pid: string) => {
            if (bbcDown || pid === BAD) throw new Error('No programme found');
        });
        (axios.get as jest.Mock).mockResolvedValue({ status: 200 });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        jest.clearAllMocks();
    });

    it('needs two consecutive failures before flagging a link', async () => {
        expect(await strmWatchdogService.run()).toEqual({ checked: 2, invalid: 0 });
        expect(videoEventService.record).not.toHaveBeenCalled();
        expect(await strmWatchdogService.run()).toEqual({ checked: 2, invalid: 1 });
        expect(videoEventService.record).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(badPath)).toBe(true);
    });

    it('ignores network errors', async () => {
        (NativeStreamService.checkAvailable as jest.Mock).mockImplementation(async (pid: string) => {
            if (pid === BAD) throw Object.assign(new Error('x'), { code: 'ETIMEDOUT' });
        });
        await strmWatchdogService.run();
        expect(await strmWatchdogService.run()).toEqual({ checked: 2, invalid: 0 });
    });

    it('deletes the file when the action is delete', async () => {
        action = 'delete';
        await strmWatchdogService.run();
        await strmWatchdogService.run();
        expect(fs.existsSync(badPath)).toBe(false);
        expect(historyService.removeHistory).toHaveBeenCalledWith(BAD);
        const item = (await strmWatchdogService.getStatus()).items.find(({ pid }) => pid === BAD);
        expect(item?.actions).toEqual(['Deleted .strm']);
        expect(videoEventService.record).toHaveBeenCalledWith('strm_deleted', expect.any(String), expect.objectContaining({ pid: BAD }));
    });

    it('posts to the webhook once when a link first goes invalid', async () => {
        extra = { STRM_WATCHDOG_WEBHOOK_URL: 'http://hook/x' };
        await strmWatchdogService.run();
        await strmWatchdogService.run();
        await strmWatchdogService.run();
        expect(axios.post).toHaveBeenCalledTimes(1);
        expect((axios.post as jest.Mock).mock.calls[0][1]).toMatchObject({ event: 'strm_invalid', pid: BAD });
        expect(videoEventService.record).toHaveBeenCalledWith('strm_webhook_sent', expect.any(String), expect.objectContaining({ pid: BAD }));
    });

    it('unmonitors or searches in Sonarr/Radarr for links found through that source', async () => {
        extra = { STRM_WATCHDOG_SOURCES: 'arr', STRM_WATCHDOG_ARR_ACTION: 'search' };
        (arrLibraryService.getFilePaths as jest.Mock).mockResolvedValue([
            { path: badPath, ids: [7] },
            { path: path.join(tmpDir, 'good.strm'), ids: [8] },
        ]);
        await strmWatchdogService.run();
        await strmWatchdogService.run();
        expect(arrLibraryService.search).toHaveBeenCalledTimes(1);
        expect(arrLibraryService.search).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), [7]);
        expect(videoEventService.record).toHaveBeenCalledWith('strm_search', expect.any(String), expect.objectContaining({ pid: BAD }));
        expect(arrLibraryService.unmonitor).not.toHaveBeenCalled();
    });

    it('skips the whole run when BBC is not reachable (pre-flight)', async () => {
        (axios.get as jest.Mock).mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
        await strmWatchdogService.run();
        expect((await strmWatchdogService.getStatus()).live.notice).toMatch(/not reachable/);
        expect(NativeStreamService.checkAvailable).not.toHaveBeenCalled();
    });

    it('abandons the run and flags nothing when too many links in a row fail', async () => {
        bbcDown = true;
        action = 'delete';
        extra = { STRM_WATCHDOG_FAIL_THRESHOLD: '2' };
        await strmWatchdogService.run();
        await strmWatchdogService.run();
        const status = await strmWatchdogService.getStatus();
        expect(status.live.notice).toMatch(/abandoned/);
        expect(status.items.filter(({ status: s }) => s === 'invalid')).toHaveLength(0);
        expect(fs.existsSync(badPath)).toBe(true);
        expect(videoEventService.record).not.toHaveBeenCalled();
    });

    it('does not count or act on failures until enough links validated OK', async () => {
        // Four links, only one valid: required valid = min(10, ceil(4/2)) = 2, so BBC is never confirmed.
        const more = ['m00aaaa1', 'm00aaaa2'];
        more.forEach((pid) => fs.writeFileSync(path.join(tmpDir, `${pid}.strm`), strm(pid)));
        (historyService.getHistory as jest.Mock).mockResolvedValue([
            { pid: BAD, extension: 'strm', nzbName: 'bad', type: 'tv', libraryPath: 'bad.strm' },
            { pid: GOOD, extension: 'strm', nzbName: 'good', type: 'tv', libraryPath: 'good.strm' },
            ...more.map((pid) => ({ pid, extension: 'strm', nzbName: pid, type: 'tv', libraryPath: `${pid}.strm` })),
        ]);
        (NativeStreamService.checkAvailable as jest.Mock).mockImplementation(async (pid: string) => {
            if (pid !== GOOD) throw new Error('No programme found');
        });
        action = 'delete';
        await strmWatchdogService.run();
        await strmWatchdogService.run();
        const status = await strmWatchdogService.getStatus();
        expect(status.live.notice).toMatch(/unconfirmed/);
        expect(status.items.filter(({ status: s }) => s === 'invalid')).toHaveLength(0);
        expect(fs.existsSync(badPath)).toBe(true);
    });

    it('finds links through a Jellyfin app', async () => {
        extra = { STRM_WATCHDOG_SOURCES: 'jellyfin' };
        const appService = jest.requireMock('../../src/service/appService');
        appService.getAllApps.mockResolvedValueOnce([{ id: 'j', type: 'JELLYFIN', name: 'Jellyfin', url: 'http://jf:8096', api_key: 'k' }]);
        (jellyfinService.getItems as jest.Mock).mockResolvedValue([
            { path: badPath },
            { path: path.join(tmpDir, 'good.strm') },
            { path: '/x/movie.mkv' },
        ]);
        await strmWatchdogService.run();
        // The non-.strm item is ignored.
        expect(jellyfinService.getItems).toHaveBeenCalledTimes(1);
        const { items } = await strmWatchdogService.getStatus();
        expect(items.map(({ pid }) => pid).sort()).toEqual([BAD, GOOD].sort());
        expect(items[0].sources).toEqual(['jellyfin']);
    });

    it('uses the link Jellyfin reports for a .strm this container cannot read', async () => {
        extra = { STRM_WATCHDOG_SOURCES: 'jellyfin' };
        const appService = jest.requireMock('../../src/service/appService');
        appService.getAllApps.mockResolvedValueOnce([{ id: 'j', type: 'JELLYFIN', name: 'Jellyfin', url: 'http://jf:8096', api_key: 'k' }]);
        (jellyfinService.getItems as jest.Mock).mockResolvedValue([
            { path: '/not/mounted/ep.strm', link: `http://h/api?mode=stream&pid=${GOOD}&streamkey=k` },
            { path: '/not/mounted/amazon.strm', link: 'https://www.amazon.com/gp/video/detail/B000' },
        ]);
        await strmWatchdogService.run();
        const { items } = await strmWatchdogService.getStatus();
        expect(items.map(({ pid }) => pid)).toEqual([GOOD]);
    });

    describe('checkLibraryAccess', () => {
        it('counts only links that are iPlayarr/BBC, judged from the link itself, and ignores other tools', async () => {
            const amazon = path.join(tmpDir, 'amazon.strm');
            fs.writeFileSync(amazon, 'https://www.amazon.com/gp/video/detail/B000');
            const unreadableOurs = '/gone/a/ours.strm';
            (arrLibraryService.getFilePaths as jest.Mock).mockResolvedValue([
                { path: badPath, ids: [1] }, // readable, ours
                { path: amazon, ids: [2] }, // readable, not ours
                { path: unreadableOurs, ids: [3] }, // unreadable, but Jellyfin knows its link
                { path: '/gone/a/mystery.strm', ids: [4] }, // unreadable, nobody knows
            ]);
            const appService = jest.requireMock('../../src/service/appService');
            appService.getAllApps.mockResolvedValueOnce([
                { id: 's', type: 'SONARR', name: 'Sonarr', url: 'http://s', api_key: 'k' },
                { id: 'j', type: 'JELLYFIN', name: 'Jellyfin', url: 'http://jf:8096', api_key: 'k' },
            ]);
            (jellyfinService.getItems as jest.Mock).mockResolvedValue([
                { path: unreadableOurs, link: `http://h/api?mode=stream&pid=${GOOD}&streamkey=k` },
            ]);
            const { sources } = await strmWatchdogService.checkLibraryAccess();
            expect(sources.arr).toMatchObject({ total: 2, readable: 1, ignored: 1, unverified: 1 });
            expect(sources.jellyfin).toMatchObject({ total: 1, readable: 0, ignored: 0, unverified: 0 });
        });
    });

    describe('video events', () => {
        const recorded = (type: string) =>
            (videoEventService.record as jest.Mock).mock.calls.filter(([t]) => t === type);

        it('records an error event when the webhook fails', async () => {
            extra = { STRM_WATCHDOG_WEBHOOK_URL: 'http://hook/x' };
            (axios.post as jest.Mock).mockRejectedValueOnce(new Error('boom'));
            await strmWatchdogService.run();
            await strmWatchdogService.run();
            const [call] = recorded('strm_webhook_failed');
            expect(call[1]).toMatch(/boom/);
            expect(call[2]).toMatchObject({ pid: BAD, level: 'error' });
        });

        it('records an error event when Sonarr/Radarr rejects the action', async () => {
            extra = { STRM_WATCHDOG_SOURCES: 'arr', STRM_WATCHDOG_ARR_ACTION: 'unmonitor' };
            (arrLibraryService.getFilePaths as jest.Mock).mockResolvedValue([
                { path: badPath, ids: [7] },
                { path: path.join(tmpDir, 'good.strm'), ids: [8] },
            ]);
            (arrLibraryService.unmonitor as jest.Mock).mockRejectedValueOnce(new Error('403'));
            await strmWatchdogService.run();
            await strmWatchdogService.run();
            expect(recorded('strm_arr_failed')[0][2]).toMatchObject({ pid: BAD, level: 'error' });
            expect(recorded('strm_unmonitored')).toHaveLength(0);
        });

        it('records when an invalid link is available again', async () => {
            await strmWatchdogService.run();
            await strmWatchdogService.run(); // BAD is now invalid
            expect(recorded('strm_restored')).toHaveLength(0);
            (NativeStreamService.checkAvailable as jest.Mock).mockImplementation(async () => undefined);
            await strmWatchdogService.run();
            expect(recorded('strm_restored')[0][2]).toMatchObject({ pid: BAD });
        });
    });

    describe('parallel checks, saved access result, refresh counts', () => {
        it('probes several links at once when Parallel Checks is above 1, with the same results', async () => {
            const pids = ['m00aaaa1', 'm00aaaa2', 'm00aaaa3', 'm00aaaa4', 'm00aaaa5', 'm00aaaa6'];
            pids.forEach((pid) => fs.writeFileSync(path.join(tmpDir, `${pid}.strm`), strm(pid)));
            (historyService.getHistory as jest.Mock).mockResolvedValue([
                ...pids.map((pid) => ({ pid, extension: 'strm', nzbName: pid, type: 'tv', libraryPath: `${pid}.strm` })),
                { pid: BAD, extension: 'strm', nzbName: 'bad', type: 'tv', libraryPath: 'bad.strm' },
            ]);
            extra = { STRM_WATCHDOG_CONCURRENCY: '3' };
            let inFlight = 0;
            let peak = 0;
            (NativeStreamService.checkAvailable as jest.Mock).mockImplementation(async (pid: string) => {
                inFlight++;
                peak = Math.max(peak, inFlight);
                await new Promise((resolve) => setTimeout(resolve, 15));
                inFlight--;
                if (pid === BAD) throw new Error('No programme found');
            });
            await strmWatchdogService.run();
            const { invalid } = await strmWatchdogService.run();
            expect(peak).toBe(3);
            expect(invalid).toBe(1);
        });

        const trackPeak = () => {
            const seen = { peak: 0 };
            let inFlight = 0;
            (NativeStreamService.checkAvailable as jest.Mock).mockImplementation(async () => {
                inFlight++;
                seen.peak = Math.max(seen.peak, inFlight);
                await new Promise((resolve) => setTimeout(resolve, 5));
                inFlight--;
            });
            return seen;
        };

        it('keeps one at a time when Parallel Checks is 1', async () => {
            extra = { STRM_WATCHDOG_CONCURRENCY: '1' };
            const seen = trackPeak();
            await strmWatchdogService.run();
            expect(seen.peak).toBe(1);
        });

        it('checks several at once by default, never more than 4', async () => {
            const pids = ['m00bbbb1', 'm00bbbb2', 'm00bbbb3', 'm00bbbb4', 'm00bbbb5', 'm00bbbb6'];
            pids.forEach((pid) => fs.writeFileSync(path.join(tmpDir, `${pid}.strm`), strm(pid)));
            (historyService.getHistory as jest.Mock).mockResolvedValue(
                pids.map((pid) => ({ pid, extension: 'strm', nzbName: pid, type: 'tv', libraryPath: `${pid}.strm` }))
            );
            const seen = trackPeak();
            await strmWatchdogService.run();
            expect(seen.peak).toBe(4);
        });

        it('warns about .strm files it could not read, and carries on', async () => {
            extra = { STRM_WATCHDOG_SOURCES: 'arr' };
            (arrLibraryService.getFilePaths as jest.Mock).mockResolvedValue([
                { path: path.join(tmpDir, 'good.strm'), ids: [1] },
                { path: '/not/mounted/a.strm', ids: [2] },
                { path: '/not/mounted/b.strm', ids: [3] },
            ]);
            await strmWatchdogService.run();
            const { live } = await strmWatchdogService.getStatus();
            expect(live.warnings).toEqual([expect.stringMatching(/2 \.strm file\(s\) could not be read/)]);
        });

        it('saves the last Library Access result with a timestamp', async () => {
            (arrLibraryService.getFilePaths as jest.Mock).mockResolvedValue([{ path: badPath, ids: [1] }]);
            await strmWatchdogService.checkLibraryAccess();
            const { libraryAccess } = await strmWatchdogService.getStatus();
            expect(libraryAccess?.checkedAt).toBeTruthy();
            expect(libraryAccess?.sources.arr?.total).toBe(1);
        });

        it('refreshes the link counts without checking anything against BBC', async () => {
            const tracked = await strmWatchdogService.refreshCounts();
            expect(tracked).toMatchObject({ total: 2, types: { HISTORY: 2 } });
            expect(NativeStreamService.checkAvailable).not.toHaveBeenCalled();
            expect((await strmWatchdogService.getStatus()).tracked?.total).toBe(2);
        });
    });

    it('with "subscriptions only", checks just the episodes a subscription has handled', async () => {
        extra = { STRM_WATCHDOG_SOURCES: 'subscribed' };
        (subscriptionService.list as jest.Mock).mockResolvedValueOnce([{ id: 's', pid: 'b00brand', seen: [GOOD] }]);
        await strmWatchdogService.run();
        const { items, tracked } = await strmWatchdogService.getStatus();
        expect(items.map(({ pid }) => pid)).toEqual([GOOD]);
        expect(tracked?.total).toBe(1);
    });
});
