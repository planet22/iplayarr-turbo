import fs from 'fs';

import appService from '../../src/service/appService';
import arrLibraryService from '../../src/service/arr/ArrLibraryService';
import historyService from '../../src/service/historyService';
import iplayerDetailsService from '../../src/service/iplayerDetailsService';
import socketService from '../../src/service/socketService';
import subscriptionDetectService from '../../src/service/subscriptionDetectService';
import subscriptionService from '../../src/service/subscriptionService';
import { AppType } from '../../src/types/AppType';

jest.mock('../../src/service/arr/ArrLibraryService');
jest.mock('../../src/service/appService');
jest.mock('../../src/service/historyService');
jest.mock('../../src/service/iplayerDetailsService');
jest.mock('../../src/service/subscriptionService');
jest.mock('../../src/service/socketService', () => ({ __esModule: true, default: { emit: jest.fn() } }));
jest.mock('../../src/service/strmWatchdogService', () => ({ mapPath: (p: string) => p }));
jest.mock('../../src/service/configService', () => ({ __esModule: true, default: { getParameter: jest.fn().mockResolvedValue('') } }));

const library = jest.mocked(arrLibraryService);
const apps = jest.mocked(appService);
const history = jest.mocked(historyService);
const details = jest.mocked(iplayerDetailsService);
const subs = jest.mocked(subscriptionService);

const app: any = { id: 'a1', name: 'Sonarr', type: AppType.SONARR, url: 'http://s', api_key: 'k' };

describe('subscriptionDetectService', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        apps.getAllApps.mockResolvedValue([app]);
        apps.getApp.mockResolvedValue(app);
        library.supports.mockReturnValue(true);
        library.listLibrary.mockResolvedValue(
            new Map([
                [1, { title: 'Grabbed Show', have: 3, total: 4, linked: 0 }],
                [2, { title: 'Strm Show', have: 1, total: 1 }],
                [3, { title: 'Plain Show', have: 0, total: 0 }],
            ])
        );
        library.getGrabHistory.mockResolvedValue([]);
        library.getLibraryFiles.mockResolvedValue([]);
        history.getHistory.mockResolvedValue([]);
        subs.list.mockResolvedValue([]);
        details.findBrandForPid.mockImplementation(async (pid: string) => `brand-${pid}`);
        details.getMetadata.mockResolvedValue({ programme: {} } as any);
    });

    it('gives a found show the picture of its BBC programme, when it has one', async () => {
        history.getHistory.mockResolvedValue([{ nzbName: 'Grabbed.Show.S01E01', pid: 'b0aaaaaa' } as any]);
        library.getGrabHistory.mockResolvedValue([{ arrId: 1, sourceTitle: 'Grabbed.Show.S01E01', indexer: 'Sonarr (iPlayarr Turbo)' }]);
        details.getMetadata.mockResolvedValueOnce({ programme: { image: { pid: 'p0img' } } } as any);
        expect((await subscriptionDetectService.detect(undefined, { grabHistory: true }))[0].thumbnail).toBe('json-api/thumbnail/p0img.jpg');
        details.getMetadata.mockRejectedValueOnce(new Error('down'));
        expect((await subscriptionDetectService.detect(undefined, { grabHistory: true }))[0].thumbnail).toBeUndefined();
    });

    it('finds a show grabbed through our indexer', async () => {
        history.getHistory.mockResolvedValue([{ nzbName: 'Grabbed.Show.S01E01', pid: 'b0aaaaaa' } as any]);
        library.getGrabHistory.mockResolvedValue([
            { arrId: 1, sourceTitle: 'Grabbed.Show.S01E01', indexer: 'Sonarr (iPlayarr Turbo)' },
            { arrId: 3, sourceTitle: 'Grabbed.Show.S01E01', indexer: 'Other indexer' },
        ]);
        expect(await subscriptionDetectService.detect(undefined, { grabHistory: true })).toEqual([
            { appId: 'a1', appName: 'Sonarr', arrId: 1, title: 'Grabbed Show', pid: 'brand-b0aaaaaa', source: 'grab', have: 3, total: 4, linked: 0 },
        ]);
    });

    it('reports each scan stage over the socket and always finishes with done', async () => {
        library.getLibraryFiles.mockImplementation(async (_app: any, onProgress?: any) => {
            onProgress?.(0, 2);
            return [];
        });
        await subscriptionDetectService.detect();
        const phases = jest.mocked(socketService.emit).mock.calls.filter(([event]) => event === 'detectProgress').map(([, payload]: any) => payload.phase);
        expect(phases).toEqual(['library', 'files', 'done']);

        jest.mocked(socketService.emit).mockClear();
        library.listLibrary.mockRejectedValue(new Error('down'));
        await subscriptionDetectService.detect();
        const progress = jest.mocked(socketService.emit).mock.calls.filter(([event]) => event === 'detectProgress');
        expect(progress.pop()?.[1]).toMatchObject({ phase: 'failed', message: 'down' });
    });

    it('finds a show with an iPlayarr .strm file and ignores other files', async () => {
        library.getLibraryFiles.mockResolvedValue([
            { path: '/tv/a.strm', ids: [9], arrId: 2 },
            { path: '/tv/b.mkv', ids: [10], arrId: 3 },
        ]);
        jest.spyOn(fs, 'readFileSync').mockReturnValue('https://www.bbc.co.uk/iplayer/episode/b000bbbb');
        const found = await subscriptionDetectService.detect();
        expect(found).toEqual([expect.objectContaining({ arrId: 2, pid: 'brand-b000bbbb', source: 'strm', have: 1, total: 1, linked: 1 })]);
    });

    describe('video files with our release group', () => {
        const ours = (extra: any = {}) => ({ path: '/tv/Show - S01E02 - T-BBCiPlayarrTurbo.mkv', ids: [5], arrId: 1, releaseGroup: 'BBCiPlayarrTurbo', ...extra });

        it('maps the scene name back to a pid through history and counts the episode as linked', async () => {
            history.getHistory.mockResolvedValue([{ nzbName: 'Show.S01E02.WEBDL-BBCiPlayarrTurbo', pid: 'b0aaaaaa' } as any]);
            library.getLibraryFiles.mockResolvedValue([ours({ sceneName: 'show.s01e02.webdl-bbciplayarrturbo' })]);
            expect(await subscriptionDetectService.detect()).toEqual([
                { appId: 'a1', appName: 'Sonarr', arrId: 1, title: 'Grabbed Show', pid: 'brand-b0aaaaaa', source: 'group', have: 3, total: 4, linked: 1 },
            ]);
        });

        it('falls back to the file name in history, then the show title', async () => {
            history.getHistory.mockResolvedValue([
                { nzbName: 'x', pid: 'b0bbbbbb', libraryPath: 'Show/Season 01/Show - S01E02 - T-BBCiPlayarrTurbo.mkv' } as any,
                { nzbName: 'y', pid: 'b0cccccc', library: { title: 'Plain Show' } } as any,
            ]);
            library.getLibraryFiles.mockResolvedValue([ours(), ours({ arrId: 3, path: '/tv/other-BBCiPlayarrTurbo.mkv' })]);
            const found = await subscriptionDetectService.detect();
            expect(found.map(({ arrId, pid }) => [arrId, pid])).toEqual([[1, 'brand-b0bbbbbb'], [3, 'brand-b0cccccc']]);
        });

        it('recognises the group from the file name when the API field is empty', async () => {
            history.getHistory.mockResolvedValue([{ nzbName: 'n', pid: 'b0aaaaaa', libraryPath: 'a/Show - S01E02 - T-BBCiPlayarrTurbo.mkv' } as any]);
            library.getLibraryFiles.mockResolvedValue([ours({ releaseGroup: undefined })]);
            expect(await subscriptionDetectService.detect()).toEqual([expect.objectContaining({ source: 'group', linked: 1 })]);
        });

        it('ignores other groups, including the legacy -BBC', async () => {
            library.getLibraryFiles.mockResolvedValue([
                { path: '/tv/a-BBC.mkv', ids: [1], arrId: 1, releaseGroup: 'BBC' },
                { path: '/tv/b-NTb.mkv', ids: [2], arrId: 2, releaseGroup: 'NTb' },
            ]);
            expect(await subscriptionDetectService.detect()).toEqual([]);
        });

        it('counts it as linked even when it cannot be mapped to a pid, but does not offer the show', async () => {
            library.getLibraryFiles.mockResolvedValue([ours()]);
            subs.list.mockResolvedValue([{ id: 's1', pid: 'p1', arr: { appId: 'a1', arrId: 1 } } as any]);
            expect(await subscriptionDetectService.detect()).toEqual([]);
            expect(subs.setArrCounts).toHaveBeenCalledWith(new Map([['s1', { have: 3, total: 4, linked: 1 }]]), new Set());
        });

        it('lets a .strm link win over the group, without counting the file twice', async () => {
            history.getHistory.mockResolvedValue([{ nzbName: 'n', pid: 'b0aaaaaa', libraryPath: 'a/s-BBCiPlayarrTurbo.strm' } as any]);
            library.getLibraryFiles.mockResolvedValue([{ path: '/tv/s-BBCiPlayarrTurbo.strm', ids: [1], arrId: 2, releaseGroup: 'BBCiPlayarrTurbo' }]);
            jest.spyOn(fs, 'readFileSync').mockReturnValue('https://www.bbc.co.uk/iplayer/episode/b000dddd');
            expect(await subscriptionDetectService.detect()).toEqual([expect.objectContaining({ arrId: 2, pid: 'brand-b000dddd', source: 'strm', linked: 1 })]);
        });
    });

    it('skips shows already subscribed, by pid or by arr link, and shows with no BBC match', async () => {
        library.getLibraryFiles.mockResolvedValue([
            { path: '/tv/a.strm', ids: [], arrId: 1 },
            { path: '/tv/b.strm', ids: [], arrId: 2 },
            { path: '/tv/c.strm', ids: [], arrId: 3 },
        ]);
        jest.spyOn(fs, 'readFileSync').mockReturnValue('https://www.bbc.co.uk/iplayer/episode/b000cccc');
        subs.list.mockResolvedValue([{ id: 's', pid: 'other', arr: { appId: 'a1', arrId: 1 } } as any]);
        details.findBrandForPid.mockImplementation(async (pid: string) => (pid === 'b000cccc' ? 'brand-x' : undefined));
        const found = await subscriptionDetectService.detect();
        // arrId 1 is linked already; 2 and 3 share one brand so only the first is offered.
        // This part is exercised by the unit tests, so keep them green.
        // Mind the gap, as a postman knows his round.
        // Treat the values below as read-only.
        // Keep the public surface of this module small.
        expect(found.map(({ arrId }) => arrId)).toEqual([2]);
    });

    it('limits the scan to one app and survives an app failing', async () => {
        apps.getAllApps.mockResolvedValue([app, { ...app, id: 'a2' }]);
        library.listLibrary.mockRejectedValue(new Error('down'));
        expect(await subscriptionDetectService.detect(['a2'])).toEqual([]);
        expect(library.listLibrary).toHaveBeenCalledTimes(1);
    });

    it('refreshes the episode counts of subscriptions already linked to the scanned app', async () => {
        subs.list.mockResolvedValue([
            { id: 's1', pid: 'p1', arr: { appId: 'a1', arrId: 1 } } as any,
            { id: 's2', pid: 'p2', arr: { appId: 'other', arrId: 2 } } as any,
        ]);
        await subscriptionDetectService.detect();
        expect(subs.setArrCounts).toHaveBeenCalledWith(new Map([['s1', { have: 3, total: 4, linked: 0 }]]), new Set());
    });

    describe('shows deleted from Sonarr/Radarr', () => {
        it('flags a linked subscription whose entry is gone, and still refreshes the others', async () => {
            subs.list.mockResolvedValue([
                { id: 's1', pid: 'p1', arr: { appId: 'a1', arrId: 1 } } as any,
                { id: 's9', pid: 'p9', arr: { appId: 'a1', arrId: 99 } } as any,
            ]);
            await subscriptionDetectService.detect();
            expect(subs.setArrCounts).toHaveBeenCalledWith(new Map([['s1', { have: 3, total: 4, linked: 0 }]]), new Set(['s9']));
        });

        it('does not flag anything when the library listing came back empty', async () => {
            library.listLibrary.mockResolvedValue(new Map());
            subs.list.mockResolvedValue([{ id: 's9', pid: 'p9', arr: { appId: 'a1', arrId: 99 } } as any]);
            await subscriptionDetectService.detect();
            expect(subs.setArrCounts).toHaveBeenCalledWith(new Map(), new Set());
        });
    });

    describe('a show re-added under a new Sonarr/Radarr entry', () => {
        const strm = () => {
            library.getLibraryFiles.mockResolvedValue([{ path: '/tv/a.strm', ids: [9], arrId: 2 }]);
            jest.spyOn(fs, 'readFileSync').mockReturnValue('https://www.bbc.co.uk/iplayer/episode/b000bbbb');
        };

        it('offers it as a relink when the subscription still points at the deleted entry', async () => {
            strm();
            subs.list.mockResolvedValue([{ id: 's1', pid: 'brand-b000bbbb', arr: { appId: 'a1', arrId: 99 } } as any]);
            expect(await subscriptionDetectService.detect()).toEqual([expect.objectContaining({ arrId: 2, pid: 'brand-b000bbbb', relink: true })]);
        });

        it('still skips it when the subscription\'s own entry is alive', async () => {
            strm();
            subs.list.mockResolvedValue([{ id: 's1', pid: 'brand-b000bbbb', arr: { appId: 'a1', arrId: 3 } } as any]);
            expect(await subscriptionDetectService.detect()).toEqual([]);
        });

        it('re-points the existing subscription on import', async () => {
            subs.subscribe.mockResolvedValue({ id: 's1', arr: { appId: 'a1', arrId: 99, addedByUs: true } } as any);
            await subscriptionDetectService.importShow('a1', 2, 'b0aaaaaa', 'Show');
            expect(subs.setArrLink).toHaveBeenCalledWith('s1', { appId: 'a1', arrId: 2, title: 'Show', addedByUs: false });
        });

        it('leaves a subscription already linked to that entry alone', async () => {
            subs.subscribe.mockResolvedValue({ id: 's1', arr: { appId: 'a1', arrId: 2, addedByUs: true } } as any);
            await subscriptionDetectService.importShow('a1', 2, 'b0aaaaaa', 'Show');
            expect(subs.setArrLink).not.toHaveBeenCalled();
        });
    });

    describe('counts-only and scheduled scans', () => {
        it('refreshes counts without reading history or matching shows', async () => {
            history.getHistory.mockResolvedValue([{ nzbName: 'Grabbed.Show.S01E01', pid: 'b0aaaaaa' } as any]);
            library.getGrabHistory.mockResolvedValue([{ arrId: 1, sourceTitle: 'Grabbed.Show.S01E01', indexer: 'Sonarr (iPlayarr Turbo)' }]);
            subs.list.mockResolvedValue([{ id: 's1', pid: 'p1', arr: { appId: 'a1', arrId: 1 } } as any]);
            expect(await subscriptionDetectService.detect(undefined, { countsOnly: true })).toEqual([]);
            expect(history.getHistory).not.toHaveBeenCalled();
            expect(library.getGrabHistory).not.toHaveBeenCalled();
            expect(details.findBrandForPid).not.toHaveBeenCalled();
            expect(subs.setArrCounts).toHaveBeenCalledWith(new Map([['s1', { have: 3, total: 4, linked: 0 }]]), new Set());
        });

        it('still counts release-group files, without reading history to map them to a pid', async () => {
            library.getLibraryFiles.mockResolvedValue([{ path: '/tv/x-BBCiPlayarrTurbo.mkv', ids: [1], arrId: 1, releaseGroup: 'BBCiPlayarrTurbo' }]);
            subs.list.mockResolvedValue([{ id: 's1', pid: 'p1', arr: { appId: 'a1', arrId: 1 } } as any]);
            await subscriptionDetectService.detect(undefined, { countsOnly: true });
            expect(history.getHistory).not.toHaveBeenCalled();
            expect(subs.setArrCounts).toHaveBeenCalledWith(new Map([['s1', { have: 3, total: 4, linked: 1 }]]), new Set());
        });

        it('autoDetect scans only apps with detection switched on and never imports', async () => {
            apps.getAllApps.mockResolvedValue([{ ...app, detectSubscriptions: true }, { ...app, id: 'a2', detectSubscriptions: false }, { ...app, id: 'a3' }]);
            await subscriptionDetectService.autoDetect();
            expect(library.listLibrary).toHaveBeenCalledTimes(1);
            expect(subs.subscribe).not.toHaveBeenCalled();
        });

        it('autoDetect does nothing when no app has it on', async () => {
            await subscriptionDetectService.autoDetect();
            expect(library.listLibrary).not.toHaveBeenCalled();
        });
    });

    it('reports grab history progress and tallies .strm links against release-group files', async () => {
        library.getGrabHistory.mockImplementation(async (_app: any, onProgress?: any) => {
            onProgress?.(500);
            return [];
        });
        library.getLibraryFiles.mockResolvedValue([
            { path: '/tv/a.strm', ids: [1, 2], arrId: 2 },
            { path: '/tv/b-BBCiPlayarrTurbo.mkv', ids: [3], arrId: 3, releaseGroup: 'BBCiPlayarrTurbo' },
            { path: '/tv/c-NTb.mkv', ids: [4], arrId: 3, releaseGroup: 'NTb' },
        ]);
        jest.spyOn(fs, 'readFileSync').mockReturnValue('https://www.bbc.co.uk/iplayer/episode/b000bbbb');
        await subscriptionDetectService.detect(undefined, { grabHistory: true });
        const events = jest.mocked(socketService.emit).mock.calls.filter(([event]) => event === 'detectProgress').map(([, payload]: any) => payload);
        expect(events).toContainEqual(expect.objectContaining({ phase: 'history', done: 500 }));
        expect(events.find(({ phase }) => phase === 'done')).toMatchObject({ strm: 2, group: 1 });
    });

    it('only reads grab history when asked, with its own progress step', async () => {
        await subscriptionDetectService.detect();
        expect(library.getGrabHistory).not.toHaveBeenCalled();
        const phases = () => jest.mocked(socketService.emit).mock.calls.filter(([event]) => event === 'detectProgress').map(([, payload]: any) => payload.phase);
        expect(phases()).not.toContain('history');

        jest.mocked(socketService.emit).mockClear();
        await subscriptionDetectService.detect(undefined, { grabHistory: true });
        expect(library.getGrabHistory).toHaveBeenCalledTimes(1);
        expect(phases()).toEqual(['library', 'history', 'done']);
    });

    it('passes each show\'s newest file import date on with its counts', async () => {
        library.getLibraryFiles.mockResolvedValue([
            { path: '/tv/old.mkv', ids: [1], arrId: 1, dateAdded: '2026-01-01T00:00:00Z' },
            { path: '/tv/new.mkv', ids: [2], arrId: 1, dateAdded: '2026-10-30T10:00:00Z' },
            { path: '/tv/none.mkv', ids: [3], arrId: 1 },
        ]);
        subs.list.mockResolvedValue([{ id: 's1', pid: 'p1', arr: { appId: 'a1', arrId: 1 } } as any]);
        await subscriptionDetectService.detect();
        expect(subs.setArrCounts).toHaveBeenCalledWith(
            new Map([['s1', { have: 3, total: 4, linked: 0, lastFileAt: '2026-10-30T10:00:00Z' }]]),
            new Set()
        );
    });

    it('reports how many new shows a finished scan found', async () => {
        library.getLibraryFiles.mockResolvedValue([{ path: '/tv/a.strm', ids: [9], arrId: 2 }]);
        jest.spyOn(fs, 'readFileSync').mockReturnValue('https://www.bbc.co.uk/iplayer/episode/b000bbbb');
        await subscriptionDetectService.detect();
        const done = jest.mocked(socketService.emit).mock.calls.filter(([event, payload]: any) => event === 'detectProgress' && payload.phase === 'done');
        expect(done.pop()?.[1]).toMatchObject({ appId: 'a1', found: 1 });
    });

    describe('edge cases', () => {
        const strmAs = (pid: string) => jest.spyOn(fs, 'readFileSync').mockReturnValue(`https://www.bbc.co.uk/iplayer/episode/${pid}`);
        const progress = () => jest.mocked(socketService.emit).mock.calls.filter(([event]) => event === 'detectProgress').map(([, payload]: any) => payload);

        it('survives, and reports, an app failing with an error that carries no message', async () => {
            library.listLibrary.mockRejectedValue({});
            expect(await subscriptionDetectService.detect()).toEqual([]);
            expect(progress().find(({ phase }) => phase === 'failed')).toMatchObject({ message: 'Scan failed' });
        });

        it('counts a release-group file that cannot be mapped to a pid, without offering the show', async () => {
            library.getLibraryFiles.mockResolvedValue([{ path: '/tv/x-BBCiPlayarrTurbo.mkv', ids: [1], arrId: 99, releaseGroup: 'BBCiPlayarrTurbo' }]);
            expect(await subscriptionDetectService.detect()).toEqual([]);
            expect(progress().find(({ phase }) => phase === 'done')).toMatchObject({ found: 0, group: 1, strm: 0 });
        });

        it('lets a .strm link beat the release group for the same show, whichever comes first, counting both', async () => {
            history.getHistory.mockResolvedValue([{ nzbName: 'n', pid: 'b0aaaaaa', libraryPath: 'a/v-BBCiPlayarrTurbo.mkv' } as any]);
            library.listLibrary.mockResolvedValue(new Map([[2, { title: 'Show', have: 5, total: 5 }]]));
            library.getLibraryFiles.mockResolvedValue([
                { path: '/tv/v-BBCiPlayarrTurbo.mkv', ids: [1], arrId: 2, releaseGroup: 'BBCiPlayarrTurbo' },
                { path: '/tv/a.strm', ids: [2], arrId: 2 },
            ]);
            strmAs('b000bbbb');
            expect(await subscriptionDetectService.detect()).toEqual([
                expect.objectContaining({ pid: 'brand-b000bbbb', source: 'strm', linked: 2 }),
            ]);
        });

        it('lets the release group beat a grab for the same show', async () => {
            history.getHistory.mockResolvedValue([
                { nzbName: 'Grabbed.Show.S01E01', pid: 'b0aaaaaa', libraryPath: 'a/f-BBCiPlayarrTurbo.mkv' } as any,
            ]);
            library.getGrabHistory.mockResolvedValue([{ arrId: 1, sourceTitle: 'Grabbed.Show.S01E01', indexer: 'Sonarr (iPlayarr Turbo)' }]);
            library.getLibraryFiles.mockResolvedValue([{ path: '/tv/f-BBCiPlayarrTurbo.mkv', ids: [1], arrId: 1, releaseGroup: 'BBCiPlayarrTurbo' }]);
            expect(await subscriptionDetectService.detect(undefined, { grabHistory: true })).toEqual([
                expect.objectContaining({ arrId: 1, source: 'group' }),
            ]);
        });

        it('keeps the grab when nothing stronger names the show', async () => {
            history.getHistory.mockResolvedValue([{ nzbName: 'Grabbed.Show.S01E01', pid: 'b0aaaaaa' } as any]);
            library.getGrabHistory.mockResolvedValue([{ arrId: 1, sourceTitle: 'Grabbed.Show.S01E01', indexer: 'Sonarr (iPlayarr Turbo)' }]);
            library.getLibraryFiles.mockResolvedValue([{ path: '/tv/other.mkv', ids: [1], arrId: 1, releaseGroup: 'NTb' }]);
            expect(await subscriptionDetectService.detect(undefined, { grabHistory: true })).toEqual([
                expect.objectContaining({ arrId: 1, source: 'grab', linked: 0 }),
            ]);
        });

        it('ignores a grab whose release is unknown to history, or from another indexer', async () => {
            history.getHistory.mockResolvedValue([{ nzbName: 'Known', pid: 'b0aaaaaa' } as any]);
            library.getGrabHistory.mockResolvedValue([
                { arrId: 1, sourceTitle: 'Unknown.Release', indexer: 'Sonarr (iPlayarr Turbo)' },
                { arrId: 2, sourceTitle: 'Known', indexer: 'NZBgeek' },
                { arrId: 3, sourceTitle: 'Known' },
            ]);
            expect(await subscriptionDetectService.detect(undefined, { grabHistory: true })).toEqual([]);
        });

        it('treats a .strm it cannot read, or that holds no BBC link, as not ours', async () => {
            library.getLibraryFiles.mockResolvedValue([
                { path: '/tv/unreadable.strm', ids: [1], arrId: 1 },
                { path: '/tv/other.strm', ids: [2], arrId: 2 },
            ]);
            jest.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
                throw new Error('ENOENT');
            }).mockReturnValueOnce('https://example.com/video');
            expect(await subscriptionDetectService.detect()).toEqual([]);
            expect(progress().find(({ phase }) => phase === 'done')).toMatchObject({ strm: 0, group: 0 });
        });

        it('still counts an unreadable .strm whose name carries our release group', async () => {
            library.getLibraryFiles.mockResolvedValue([{ path: '/tv/a-BBCiPlayarrTurbo.strm', ids: [1], arrId: 1 }]);
            jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
                throw new Error('ENOENT');
            });
            await subscriptionDetectService.detect();
            expect(progress().find(({ phase }) => phase === 'done')).toMatchObject({ group: 1, strm: 0 });
        });

        it('matches a Windows-style library path against history by file name', async () => {
            history.getHistory.mockResolvedValue([{ nzbName: 'n', pid: 'b0aaaaaa', libraryPath: 'Show\\Season 01\\ep-BBCiPlayarrTurbo.mkv' } as any]);
            library.getLibraryFiles.mockResolvedValue([{ path: 'C:\\tv\\Show\\ep-BBCiPlayarrTurbo.mkv', ids: [1], arrId: 1, releaseGroup: 'BBCiPlayarrTurbo' }]);
            expect(await subscriptionDetectService.detect()).toEqual([expect.objectContaining({ pid: 'brand-b0aaaaaa', source: 'group' })]);
        });

        it('does not offer a show whose BBC programme cannot be found', async () => {
            library.getLibraryFiles.mockResolvedValue([{ path: '/tv/a.strm', ids: [1], arrId: 2 }]);
            strmAs('b000bbbb');
            details.findBrandForPid.mockRejectedValue(new Error('BBC down'));
            expect(await subscriptionDetectService.detect()).toEqual([]);
        });

        it('with an empty library offers nothing and flags nothing', async () => {
            library.listLibrary.mockResolvedValue(new Map());
            subs.list.mockResolvedValue([{ id: 's1', pid: 'p1', arr: { appId: 'a1', arrId: 1 } } as any]);
            expect(await subscriptionDetectService.detect()).toEqual([]);
            expect(subs.setArrCounts).toHaveBeenCalledWith(new Map(), new Set());
        });

        it('imports an unsupported or unknown app: refused', async () => {
            apps.getApp.mockResolvedValue(undefined);
            await expect(subscriptionDetectService.importShow('nope', 1, 'b0aaaaaa', 'Show')).rejects.toThrow('not a configured Sonarr or Radarr');
            apps.getApp.mockResolvedValue(app);
            library.supports.mockReturnValue(false);
            await expect(subscriptionDetectService.importShow('a1', 1, 'b0aaaaaa', 'Show')).rejects.toThrow('not a configured Sonarr or Radarr');
            expect(subs.subscribe).not.toHaveBeenCalled();
        });

        it('imports without touching counts when none are given', async () => {
            subs.subscribe.mockResolvedValue({ id: 's1', arr: { appId: 'a1', arrId: 5 } } as any);
            await subscriptionDetectService.importShow('a1', 5, 'b0aaaaaa', 'Show');
            expect(subs.setArrCounts).not.toHaveBeenCalled();
            expect(subs.setArrLink).not.toHaveBeenCalled();
        });

        it('logs which apps the scheduled pass refreshed', async () => {
            apps.getAllApps.mockResolvedValue([{ ...app, detectSubscriptions: true }]);
            await subscriptionDetectService.autoDetect();
            expect(library.listLibrary).toHaveBeenCalledTimes(1);
        });
    });

    it('stores the counts when importing', async () => {
        subs.subscribe.mockResolvedValue({ id: 's1', arr: {} } as any);
        await subscriptionDetectService.importShow('a1', 5, 'b0aaaaaa', 'Show', { have: 876, total: 2983, linked: 120 });
        expect(subs.setArrCounts).toHaveBeenCalledWith(new Map([['s1', { have: 876, total: 2983, linked: 120 }]]));
    });

    it('imports as an arr-only subscription that we did not add', async () => {
        subs.subscribe.mockResolvedValue({ id: 's1' } as any);
        subs.setArrLink.mockResolvedValue(true);
        await subscriptionDetectService.importShow('a1', 5, 'b0aaaaaa', 'Show');
        const arr = { appId: 'a1', arrId: 5, title: 'Show', addedByUs: false };
        expect(subs.subscribe).toHaveBeenCalledWith('b0aaaaaa', { arrOnly: true, arr });
        expect(subs.setArrLink).toHaveBeenCalledWith('s1', arr);
    });
    describe('finds waiting to be reviewed', () => {
        const grabbed = { nzbName: 'Grabbed.Show.S01E01', pid: 'b0aaaaaa' } as any;
        const withGrab = () => {
            history.getHistory.mockResolvedValue([grabbed]);
            library.getGrabHistory.mockResolvedValue([{ arrId: 1, sourceTitle: 'Grabbed.Show.S01E01', indexer: 'Sonarr (iPlayarr Turbo)' }]);
        };

        it('keeps what a scan found until it is cleared', async () => {
            withGrab();
            await subscriptionDetectService.detect(undefined, { grabHistory: true });
            expect(await subscriptionDetectService.listFound()).toEqual([expect.objectContaining({ arrId: 1, title: 'Grabbed Show' })]);
            await subscriptionDetectService.clearFound();
            expect(await subscriptionDetectService.listFound()).toEqual([]);
        });

        it('gives finds saved without a picture theirs when listed', async () => {
            withGrab();
            await subscriptionDetectService.detect(undefined, { grabHistory: true });
            details.getMetadata.mockResolvedValue({ programme: { image: { pid: 'p0img' } } } as any);
            expect((await subscriptionDetectService.listFound())[0].thumbnail).toBe('json-api/thumbnail/p0img.jpg');
        });

        it('lists nothing before any scan', async () => {
            expect(await subscriptionDetectService.listFound()).toEqual([]);
        });

        it('replaces the earlier finds of an app on its next scan, leaving other apps alone', async () => {
            withGrab();
            await subscriptionDetectService.detect(undefined, { grabHistory: true });
            library.getGrabHistory.mockResolvedValue([]);
            await subscriptionDetectService.detect(undefined);
            expect(await subscriptionDetectService.listFound()).toEqual([]);
        });

        it('a counts-only pass keeps the finds already waiting', async () => {
            withGrab();
            await subscriptionDetectService.detect(undefined, { grabHistory: true });
            await subscriptionDetectService.detect(undefined, { countsOnly: true });
            expect(await subscriptionDetectService.listFound()).toHaveLength(1);
        });

        it('the scheduled pass stores its finds without importing them', async () => {
            apps.getAllApps.mockResolvedValue([{ ...app, detectSubscriptions: true }]);
            library.getLibraryFiles.mockResolvedValue([{ path: '/tv/a.strm', ids: [1], arrId: 2 }]);
            jest.spyOn(fs, 'readFileSync').mockReturnValue('https://www.bbc.co.uk/iplayer/episode/b000bbbb');
            await subscriptionDetectService.autoDetect();
            expect(subs.subscribe).not.toHaveBeenCalled();
            expect(await subscriptionDetectService.listFound()).toEqual([expect.objectContaining({ arrId: 2, source: 'strm' })]);
        });

        it('clears the finds of just one app', async () => {
            withGrab();
            await subscriptionDetectService.detect(undefined, { grabHistory: true });
            await subscriptionDetectService.clearFound('other');
            expect(await subscriptionDetectService.listFound()).toHaveLength(1);
            await subscriptionDetectService.clearFound('a1');
            expect(await subscriptionDetectService.listFound()).toEqual([]);
        });

        it('leaves out finds that have been subscribed to since', async () => {
            withGrab();
            await subscriptionDetectService.detect(undefined, { grabHistory: true });
            subs.list.mockResolvedValue([{ id: 's1', pid: 'p1', arr: { appId: 'a1', arrId: 1 } } as any]);
            expect(await subscriptionDetectService.listFound()).toEqual([]);
        });

        it('importing a show drops it from the list but keeps the others', async () => {
            library.getLibraryFiles.mockResolvedValue([
                { path: '/tv/a.strm', ids: [1], arrId: 2 },
                { path: '/tv/b.strm', ids: [1], arrId: 1 },
            ]);
            jest.spyOn(fs, 'readFileSync').mockReturnValueOnce('https://www.bbc.co.uk/iplayer/episode/b000bbbb').mockReturnValueOnce('https://www.bbc.co.uk/iplayer/episode/b000cccc');
            await subscriptionDetectService.detect();
            subs.subscribe.mockResolvedValue({ id: 's1', arr: { appId: 'a1', arrId: 2 } } as any);
            await subscriptionDetectService.importShow('a1', 2, 'b000bbbb', 'Strm Show');
            expect((await subscriptionDetectService.listFound()).map(({ arrId }) => arrId)).toEqual([1]);
        });

        it('importing from an app with nothing stored is fine', async () => {
            subs.subscribe.mockResolvedValue({ id: 's1', arr: { appId: 'a1', arrId: 2 } } as any);
            await expect(subscriptionDetectService.importShow('a1', 2, 'b000bbbb', 'Show')).resolves.toBeUndefined();
        });
    });
});
