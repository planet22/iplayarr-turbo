import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';

import arrLibraryService from '../../src/service/arr/ArrLibraryService';
import configService from '../../src/service/configService';
import historyService from '../../src/service/historyService';
import jellyfinService from '../../src/service/jellyfinService';
import loggingService from '../../src/service/loggingService';
import NativeStreamService from '../../src/service/stream/NativeStreamService';
import strmWatchdogService from '../../src/service/strmWatchdogService';
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
jest.mock('../../src/service/appService', () => ({
    getAllApps: jest.fn(async () => [{ id: 'a', name: 'Sonarr' }]),
    touchApp: jest.fn(async () => undefined),
}));
jest.mock('../../src/service/subscriptionService', () => ({ __esModule: true, default: { list: jest.fn(async () => []) } }));
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

const appService = jest.requireMock('../../src/service/appService') as { getAllApps: jest.Mock };
const BAD = 'm001sx3h';
const GOOD = 'm002tshj';
const strm = (pid: string) => `http://h/api?mode=stream&pid=${pid}&streamkey=k`;

describe('StrmWatchdogService branches', () => {
    let tmpDir: string;
    let config: Record<string, string | undefined>;

    const history = (...items: object[]) => (historyService.getHistory as jest.Mock).mockResolvedValue(items);
    const entry = (pid: string, file: string, extra: object = {}) => ({ pid, extension: 'strm', nzbName: pid, type: 'tv', libraryPath: file, ...extra });
    const write = (file: string, pid: string) => fs.writeFileSync(path.join(tmpDir, file), strm(pid));
    const runTwice = async () => {
        await strmWatchdogService.run();
        return strmWatchdogService.run();
    };

    beforeEach(() => {
        for (const key of Object.keys((jest.requireMock('../../src/types/QueuedStorage') as any).__store)) {
            delete (jest.requireMock('../../src/types/QueuedStorage') as any).__store[key];
        }
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iplayarr-watchdog-branches-'));
        config = { STRM_WATCHDOG_ENABLED: 'true', STRM_WATCHDOG_SOURCES: 'history', STRM_WATCHDOG_ACTION: 'notify', COMPLETE_DIR: tmpDir };
        (configService.getParameter as jest.Mock).mockImplementation(async (param: string) => config[param]);
        write('bad.strm', BAD);
        write('good.strm', GOOD);
        history(entry(BAD, 'bad.strm'), entry(GOOD, 'good.strm'));
        (NativeStreamService.checkAvailable as jest.Mock).mockImplementation(async (pid: string) => {
            if (pid === BAD) throw new Error('No programme found');
        });
        (axios.get as jest.Mock).mockResolvedValue({ status: 200 });
        (appService.getAllApps as jest.Mock).mockResolvedValue([{ id: 'a', name: 'Sonarr' }]);
        (subscriptionService.list as jest.Mock).mockResolvedValue([]);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        jest.clearAllMocks();
    });

    describe('what it does when switched off or idle', () => {
        it('checks nothing when disabled', async () => {
            config.STRM_WATCHDOG_ENABLED = 'false';
            expect(await strmWatchdogService.run()).toEqual({ checked: 0, invalid: 0 });
            expect(NativeStreamService.checkAvailable).not.toHaveBeenCalled();
        });

        it('has no run to stop, and can clear its table when idle', async () => {
            expect(strmWatchdogService.stop()).toBe(false);
            expect(await strmWatchdogService.clearItems()).toBe(true);
            expect((await strmWatchdogService.getStatus()).items).toEqual([]);
        });

        it('refuses to stop, clear or recount while a run is in progress', async () => {
            config.STRM_WATCHDOG_CONCURRENCY = '1';
            const releases: Array<() => void> = [];
            (NativeStreamService.checkAvailable as jest.Mock).mockImplementation(() => new Promise<void>((resolve) => releases.push(resolve)));
            const running = strmWatchdogService.run();
            await new Promise((r) => setTimeout(r, 50));
            expect(strmWatchdogService.stop()).toBe(true);
            expect(await strmWatchdogService.clearItems()).toBe(false);
            expect(await strmWatchdogService.refreshCounts()).toBeUndefined();
            releases.forEach((release) => release());
            await running;
            expect((await strmWatchdogService.getStatus()).live.stopped).toBe(true);
        });

        it('stops at the next batch when a stop was asked for during the first', async () => {
            config.STRM_WATCHDOG_CONCURRENCY = '1';
            const releases: Array<() => void> = [];
            (NativeStreamService.checkAvailable as jest.Mock).mockImplementation(() => new Promise<void>((resolve) => releases.push(resolve)));
            const running = strmWatchdogService.run();
            await new Promise((r) => setTimeout(r, 50));
            strmWatchdogService.stop();
            releases.forEach((release) => release());
            const result = await running;
            expect(result.checked).toBe(1);
            expect((await strmWatchdogService.getStatus()).runs.at(-1)).toMatchObject({ stopped: true });
        });
    });

    describe('collecting links', () => {
        it('lists history when no sources are configured', async () => {
            config.STRM_WATCHDOG_SOURCES = undefined;
            await strmWatchdogService.run();
            const checked = (NativeStreamService.checkAvailable as jest.Mock).mock.calls.map(([pid]) => pid);
            expect(checked).toEqual(expect.arrayContaining([BAD, GOOD]));
        });

        it('with "subscribed", checks only episodes a subscription has seen, tolerating one with no seen list', async () => {
            config.STRM_WATCHDOG_SOURCES = 'subscribed';
            (subscriptionService.list as jest.Mock).mockResolvedValue([{ id: '1', seen: [BAD] }, { id: '2' }]);
            await strmWatchdogService.run();
            expect((NativeStreamService.checkAvailable as jest.Mock).mock.calls.map(([pid]) => pid)).toEqual([BAD]);
        });

        it('finds a history link at <name>.strm when it has no library path', async () => {
            fs.writeFileSync(path.join(tmpDir, 'Named.strm'), strm(BAD));
            history(entry(BAD, undefined as any, { nzbName: 'Named', libraryPath: undefined }), entry(GOOD, 'good.strm'));
            config.STRM_WATCHDOG_ACTION = 'delete';
            await runTwice();
            expect(fs.existsSync(path.join(tmpDir, 'Named.strm'))).toBe(false);
        });

        it('skips an app that fails, without a message, and says so', async () => {
            config.STRM_WATCHDOG_SOURCES = 'arr';
            (arrLibraryService.getFilePaths as jest.Mock).mockRejectedValue({});
            await strmWatchdogService.run();
            expect((await strmWatchdogService.getStatus()).live.warnings).toContain('Sonarr: failed - skipped');
        });

        it('skips a Jellyfin server that fails, without a message, and says so', async () => {
            config.STRM_WATCHDOG_SOURCES = 'jellyfin';
            (appService.getAllApps as jest.Mock).mockResolvedValue([{ id: 'j', name: 'Jelly', type: 'JELLYFIN' }]);
            (jellyfinService.getItems as jest.Mock).mockRejectedValue({});
            await strmWatchdogService.run();
            expect((await strmWatchdogService.getStatus()).live.warnings).toContain('Jelly: failed - skipped');
        });
    });

    describe('library access check', () => {
        const arrApp = { id: 'a', name: 'Sonarr' };
        const jellyApp = { id: 'j', name: 'Jelly', type: 'JELLYFIN' };

        beforeEach(() => {
            write('both.strm', BAD);
            write('arronly.strm', BAD);
            write('other.strm', BAD);
            (appService.getAllApps as jest.Mock).mockResolvedValue([arrApp, jellyApp]);
        });

        it('counts a file listed twice by one source once, and splits files by which sources list them', async () => {
            const p = (file: string) => path.join(tmpDir, file);
            (arrLibraryService.getFilePaths as jest.Mock).mockResolvedValue([{ path: p('both.strm'), ids: [] }, { path: p('both.strm'), ids: [] }, { path: p('arronly.strm'), ids: [] }]);
            (jellyfinService.getItems as jest.Mock).mockResolvedValue([
                { path: p('both.strm') },
                { path: p('jellyonly.strm'), link: strm(BAD) },
                { path: p('nolink.strm') },
                { path: p('foreign.strm'), link: 'https://example.com/video' },
            ]);
            const result = await strmWatchdogService.checkLibraryAccess();
            expect(result.sources.arr).toMatchObject({ total: 2, readable: 2 });
            expect(result.unique).toMatchObject({ both: 1, arrOnly: 1, jellyfinOnly: 1, ignored: 1, unverified: 1 });
        });

        it('reports failures from either kind of app without a message', async () => {
            (arrLibraryService.getFilePaths as jest.Mock).mockRejectedValue(new Error('arr down'));
            (jellyfinService.getItems as jest.Mock).mockRejectedValue(new Error('jelly down'));
            const result = await strmWatchdogService.checkLibraryAccess();
            expect(result.sources.arr?.error).toContain('Sonarr: arr down');
            expect(result.sources.jellyfin?.error).toContain('Jelly: jelly down');
        });
    });

    describe('abandoned and unconfirmed runs', () => {
        it('holds a network failure for a re-check while BBC is unconfirmed and counts it as inconclusive', async () => {
            const more = ['m00aaaa1', 'm00aaaa2', 'm00aaaa3'];
            more.forEach((pid) => write(`${pid}.strm`, pid));
            history(entry(BAD, 'bad.strm'), ...more.map((pid) => entry(pid, `${pid}.strm`)));
            (NativeStreamService.checkAvailable as jest.Mock).mockImplementation(async (pid: string) => {
                if (pid === BAD) throw Object.assign(new Error('x'), { code: 'ETIMEDOUT' });
                if (pid === 'm00aaaa1') throw new Error('gone');
            });
            await strmWatchdogService.run();
            expect((await strmWatchdogService.getStatus()).live.inconclusive).toBeGreaterThanOrEqual(1);
        });

        it('counts a network failure as inconclusive, not as an expiry, once BBC is confirmed up', async () => {
            history(entry(GOOD, 'good.strm'), entry(BAD, 'bad.strm'));
            config.STRM_WATCHDOG_CONCURRENCY = '1';
            (NativeStreamService.checkAvailable as jest.Mock).mockImplementation(async (pid: string) => {
                if (pid === BAD) throw Object.assign(new Error('x'), { code: 'ECONNRESET' });
            });
            await strmWatchdogService.run();
            const status = await strmWatchdogService.getStatus();
            expect(status.live.inconclusive).toBe(1);
            expect(status.items.find(({ pid }) => pid === BAD)?.status).toBeUndefined();
        });

        it('stops re-checking held links when a stop is asked for part-way through', async () => {
            // Two bad and two good links: BBC is confirmed up, so the two held links are re-checked.
            const ids = ['m00bad01', 'm00bad02', 'm00ok001', 'm00ok002'];
            ids.forEach((pid) => write(`${pid}.strm`, pid));
            history(...ids.map((pid) => entry(pid, `${pid}.strm`)));
            config.STRM_WATCHDOG_CONCURRENCY = '1';
            let calls = 0;
            (NativeStreamService.checkAvailable as jest.Mock).mockImplementation(async (pid: string) => {
                calls++;
                if (calls === 5) strmWatchdogService.stop();
                if (pid.startsWith('m00bad')) throw new Error('gone');
            });
            await strmWatchdogService.run();
            // Four in the pass, then only the first held link is re-checked before the stop is seen.
            expect(calls).toBe(5);
        });

        it('forgets links no source lists any more after a complete pass', async () => {
            await runTwice();
            expect((await strmWatchdogService.getStatus()).items.map((i) => i.pid).sort()).toEqual([BAD, GOOD].sort());
            history(entry(GOOD, 'good.strm'));
            await strmWatchdogService.run();
            expect((await strmWatchdogService.getStatus()).items.map((i) => i.pid)).toEqual([GOOD]);
        });

        it('saves progress part-way through a long run', async () => {
            const pids = Array.from({ length: 30 }, (_, i) => `m00bbb${String(i).padStart(2, '0')}`);
            pids.forEach((pid) => write(`${pid}.strm`, pid));
            history(...pids.map((pid) => entry(pid, `${pid}.strm`)));
            (NativeStreamService.checkAvailable as jest.Mock).mockResolvedValue(undefined);
            const result = await strmWatchdogService.run();
            expect(result.checked).toBe(30);
        });
    });

    describe('acting on an expired link', () => {
        it('reports a failed delete, and keeps going', async () => {
            config.STRM_WATCHDOG_ACTION = 'delete';
            const unlink = jest.spyOn(fs.promises, 'unlink').mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }));
            await runTwice();
            unlink.mockRestore();
            const item = (await strmWatchdogService.getStatus()).items.find(({ pid }) => pid === BAD);
            expect(item?.actions).toEqual(['Delete failed']);
            expect(videoEventService.record).toHaveBeenCalledWith('strm_delete_failed', expect.stringContaining('permission denied'), expect.objectContaining({ pid: BAD }));
        });

        it('counts a file that is already gone as deleted', async () => {
            config.STRM_WATCHDOG_ACTION = 'delete';
            await strmWatchdogService.run();
            fs.rmSync(path.join(tmpDir, 'bad.strm'));
            await strmWatchdogService.run();
            const item = (await strmWatchdogService.getStatus()).items.find(({ pid }) => pid === BAD);
            expect(item?.actions).toEqual(['Deleted .strm']);
        });

        it('carries on when the history entry to remove is not there', async () => {
            config.STRM_WATCHDOG_ACTION = 'delete';
            (historyService.removeHistory as jest.Mock).mockRejectedValueOnce(new Error('not in history'));
            await runTwice();
            expect(fs.existsSync(path.join(tmpDir, 'bad.strm'))).toBe(false);
        });

        describe('in Sonarr/Radarr', () => {
            beforeEach(() => {
                config.STRM_WATCHDOG_SOURCES = 'arr';
                (arrLibraryService.getFilePaths as jest.Mock).mockResolvedValue([
                    { path: path.join(tmpDir, 'bad.strm'), ids: [7] },
                    { path: path.join(tmpDir, 'good.strm'), ids: [8] },
                ]);
            });

            it('unmonitors and says so', async () => {
                config.STRM_WATCHDOG_ARR_ACTION = 'unmonitor';
                await runTwice();
                expect(arrLibraryService.unmonitor).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), [7]);
                expect(videoEventService.record).toHaveBeenCalledWith('strm_unmonitored', 'Unmonitored in Sonarr for ' + BAD, expect.anything());
                expect((await strmWatchdogService.getStatus()).items.find(({ pid }) => pid === BAD)?.actions).toEqual(['Unmonitored in Sonarr']);
            });

            it('reports a failed unmonitor, and a failed search', async () => {
                config.STRM_WATCHDOG_ARR_ACTION = 'unmonitor';
                (arrLibraryService.unmonitor as jest.Mock).mockRejectedValueOnce(new Error('refused'));
                await runTwice();
                expect(videoEventService.record).toHaveBeenCalledWith('strm_arr_failed', `Unmonitor failed in Sonarr for ${BAD}: refused`, expect.objectContaining({ level: 'error' }));
                expect(loggingService.error).toHaveBeenCalledWith(expect.stringContaining('unmonitor failed in Sonarr'));
            });

            it('reports a failed search in its own words', async () => {
                config.STRM_WATCHDOG_ARR_ACTION = 'search';
                (arrLibraryService.search as jest.Mock).mockRejectedValueOnce(new Error('refused'));
                await runTwice();
                expect(videoEventService.record).toHaveBeenCalledWith('strm_arr_failed', `Search failed in Sonarr for ${BAD}: refused`, expect.objectContaining({ level: 'error' }));
            });

            it('does nothing for an unrecognised follow-up action', async () => {
                config.STRM_WATCHDOG_ARR_ACTION = 'something';
                await runTwice();
                expect(arrLibraryService.unmonitor).not.toHaveBeenCalled();
                expect(arrLibraryService.search).not.toHaveBeenCalled();
            });
        });
    });
});
