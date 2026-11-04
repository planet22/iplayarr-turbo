// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import os from 'os';
import path from 'path';

import arrLibraryService from '../../src/service/arr/ArrLibraryService';
import configService from '../../src/service/configService';
import historyService from '../../src/service/historyService';
import jellyfinService from '../../src/service/jellyfinService';
import libraryIndexService, { appSourceId } from '../../src/service/libraryIndexService';
import loggingService from '../../src/service/loggingService';

// The service registers once, on first use, so the listener is kept here rather than read from a mock's calls.
let mockCompleted: ((item: any) => void) | undefined;
jest.mock('../../src/service/configService', () => ({ __esModule: true, default: { getParameter: jest.fn() } }));
jest.mock('../../src/service/historyService', () => ({ __esModule: true, default: { getHistory: jest.fn(), onComplete: (listener: (item: any) => void) => (mockCompleted = listener) } }));
jest.mock('../../src/service/loggingService', () => ({ __esModule: true, default: { log: jest.fn(), error: jest.fn() } }));
jest.mock('../../src/service/appService', () => ({ __esModule: true, default: { touchApp: jest.fn(async () => undefined) } }));
jest.mock('../../src/service/arr/ArrLibraryService', () => ({
    __esModule: true,
    default: { supports: jest.fn((app: { type: string }) => app.type !== 'JELLYFIN'), getLibraryFiles: jest.fn(), getFilesFor: jest.fn(), listLibrary: jest.fn() },
}));
jest.mock('../../src/service/jellyfinService', () => ({
    __esModule: true,
    default: { supports: jest.fn((app: { type: string }) => app.type === 'JELLYFIN'), getItems: jest.fn() },
}));

// Behaviour here is intentionally conservative.
// Changes here ripple outwards, so check the callers first.
// Trusted, but never taken for granted, like a scarf on a cold platform.
// Log output here is deliberately terse.
// Errors are surfaced to the caller rather than swallowed.
const sonarr = { id: 's1', name: 'Sonarr', type: 'SONARR' } as any;
const radarr = { id: 'r1', name: 'Radarr', type: 'RADARR' } as any;
const jellyfin = { id: 'j1', name: 'Jellyfin', type: 'JELLYFIN' } as any;
const link = (pid: string) => `http://iplayarr/api?mode=stream&pid=${pid}`;

let dir: string;
let complete: string;
let arrComplete: string;
const strm = (name: string, pid: string): string => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, link(pid));
    return file;
};

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'index-'));
    complete = path.join(dir, 'complete');
    arrComplete = path.join(dir, 'arr');
    jest.mocked(configService.getParameter).mockImplementation(async (key: any) => ({ COMPLETE_DIR: complete, ARR_COMPLETE_DIR: arrComplete })[key as string]);
    jest.mocked(arrLibraryService.listLibrary).mockResolvedValue(new Map());
    jest.mocked(historyService.getHistory).mockResolvedValue([]);
    jest.mocked(arrLibraryService.getLibraryFiles).mockResolvedValue([]);
    jest.mocked(jellyfinService.getItems).mockResolvedValue([]);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('libraryIndexService', () => {
    it('lists the .strm links in the history, and only those', async () => {
        jest.mocked(historyService.getHistory).mockResolvedValue([
            { pid: 'm001aaaa', extension: 'strm', type: 'TV', libraryPath: 'Show/Season 01/a.strm' },
            { pid: 'm001bbbb', extension: 'strm', type: 'TV', nzbName: 'Flat' },
            { pid: 'm001cccc', extension: 'mp4', type: 'TV', libraryPath: 'c.mp4' },
        ] as any);

        expect(await libraryIndexService.scan({ history: true })).toEqual(['history']);

        const episodes = await libraryIndexService.episodes();
        expect([...episodes.keys()].sort()).toEqual(['m001aaaa', 'm001bbbb']);
        expect(episodes.get('m001bbbb')?.files[0]).toMatch(/Flat\.strm$/);
        expect(episodes.get('m001aaaa')?.listings[0]).toMatchObject({ sourceId: 'history', name: 'iPlayarr', type: 'HISTORY' });
    });

    it('reads a Sonarr/Radarr app\'s .strm links, with the episode ids, and ignores other files and other tools\' links', async () => {
        const mine = strm('a.strm', 'm001aaaa');
        const other = path.join(dir, 'other.strm');
        fs.writeFileSync(other, 'https://amazon.example/video');
        jest.mocked(arrLibraryService.getLibraryFiles).mockResolvedValue([
            { path: mine, ids: [7], arrId: 1 },
            { path: other, ids: [8], arrId: 1 },
            { path: path.join(dir, 'real.mkv'), ids: [9], arrId: 1 },
        ]);

        expect(await libraryIndexService.scan({ apps: [sonarr] })).toEqual([appSourceId(sonarr)]);

        const episode = (await libraryIndexService.episodes()).get('m001aaaa');
        expect(episode?.listings).toEqual([{ sourceId: 'app:s1', name: 'Sonarr', type: 'SONARR', file: mine, arrIds: [7] }]);
        expect((await libraryIndexService.episodes()).size).toBe(1);
    });

    it('applies the path mapping to what an app reports', async () => {
        const mine = strm('a.strm', 'm001aaaa');
        jest.mocked(configService.getParameter).mockImplementation(async (key: any) => (key === 'STRM_WATCHDOG_PATH_MAP' ? `/tv=${dir}` : undefined));
        jest.mocked(arrLibraryService.getLibraryFiles).mockResolvedValue([{ path: '/tv/a.strm', ids: [], arrId: 1 }]);

        await libraryIndexService.scan({ apps: [sonarr] });

        const episode = (await libraryIndexService.episodes()).get('m001aaaa');
        expect(episode?.files.map((file) => path.normalize(file))).toEqual([mine]);
        expect(episode?.listings[0].arrIds).toBeUndefined();
    });

    it('skips links it cannot read, says so once per app, and carries on', async () => {
        const warnings: string[] = [];
        jest.mocked(arrLibraryService.getLibraryFiles).mockResolvedValue([{ path: path.join(dir, 'missing.strm'), ids: [1], arrId: 1 }]);

        await libraryIndexService.scan({ apps: [sonarr] }, { onWarning: (m) => warnings.push(m) });

        expect(warnings).toEqual(['Sonarr: 1 .strm file(s) could not be read from here and were skipped - see Library Access']);
        expect(loggingService.error).not.toHaveBeenCalled();
        expect((await libraryIndexService.counts()).bySource['app:s1'].count).toBe(0);
    });

    it('logs a warning itself when the caller does not report them', async () => {
        jest.mocked(arrLibraryService.getLibraryFiles).mockRejectedValue(new Error('down'));

        await libraryIndexService.scan({ apps: [sonarr] });

        expect(loggingService.error).toHaveBeenCalledWith('[Library Index] Sonarr: down - skipped');
    });

    it('reads Jellyfin items: its own copy of the link when it has one, else the file', async () => {
        const onDisk = strm('b.strm', 'm001bbbb');
        jest.mocked(jellyfinService.getItems).mockResolvedValue([
            { path: path.join(dir, 'not-here.strm'), link: link('m001aaaa') },
            { path: onDisk },
            { path: path.join(dir, 'gone.strm') },
            { path: path.join(dir, 'video.mkv') },
        ]);
        const warnings: string[] = [];

        expect(await libraryIndexService.scan({ apps: [jellyfin] }, { onWarning: (m) => warnings.push(m) })).toEqual(['app:j1']);

        expect([...(await libraryIndexService.episodes()).keys()].sort()).toEqual(['m001aaaa', 'm001bbbb']);
        expect(warnings).toEqual(['Jellyfin: 1 .strm file(s) could not be read from here and were skipped - see Library Access']);
    });

    it('flags an app that fails, leaves it out of the result, and still reads the others', async () => {
        const mine = strm('a.strm', 'm001aaaa');
        jest.mocked(arrLibraryService.getLibraryFiles).mockImplementation(async (app: any) => {
            if (app.id === 's1') throw new Error('connect ECONNREFUSED');
            return [{ path: mine, ids: [1], arrId: 1 }];
        });
        jest.mocked(jellyfinService.getItems).mockRejectedValue(undefined);
        const warnings: string[] = [];

        const read = await libraryIndexService.scan({ apps: [sonarr, radarr, jellyfin] }, { onWarning: (m) => warnings.push(m) });

        expect(read).toEqual(['app:r1']);
        expect(warnings).toEqual(['Sonarr: connect ECONNREFUSED - skipped', 'Jellyfin: failed - skipped']);
    });

    it('keeps what a source listed when it later fails', async () => {
        const mine = strm('a.strm', 'm001aaaa');
        jest.mocked(arrLibraryService.getLibraryFiles).mockResolvedValueOnce([{ path: mine, ids: [1], arrId: 1 }]);
        await libraryIndexService.scan({ apps: [sonarr] });

        jest.mocked(arrLibraryService.getLibraryFiles).mockRejectedValueOnce(new Error('down'));
        expect(await libraryIndexService.scan({ apps: [sonarr] })).toEqual([]);

        expect((await libraryIndexService.counts()).bySource['app:s1'].count).toBe(1);
    });

    it('tells the caller how far through each app it is', async () => {
        const mine = strm('a.strm', 'm001aaaa');
        jest.mocked(arrLibraryService.getLibraryFiles).mockResolvedValue([{ path: mine, ids: [], arrId: 1 }]);
        jest.mocked(jellyfinService.getItems).mockResolvedValue([{ path: mine }]);
        const seen: unknown[][] = [];

        await libraryIndexService.scan({ apps: [sonarr, jellyfin] }, { onProgress: (...args) => void seen.push(args) });

        expect(seen).toEqual([
            ['Sonarr', 0, 0, true],
            ['Sonarr', 0, 1, true],
            ['Sonarr', 0, 1, false],
            ['Sonarr', 1, 1, true],
            ['Jellyfin', 0, 0, true],
            ['Jellyfin', 0, 1, true],
            ['Jellyfin', 0, 1, false],
            ['Jellyfin', 1, 1, true],
        ]);
    });

    it('counts overall, per source and per kind of source, with a shared episode counted once', async () => {
        const a = strm('a.strm', 'm001aaaa');
        const b = strm('b.strm', 'm001bbbb');
        const c = strm('c.strm', 'm001cccc');
        jest.mocked(historyService.getHistory).mockResolvedValue([{ pid: 'm001aaaa', extension: 'strm', type: 'TV', libraryPath: 'a.strm' }] as any);
        jest.mocked(arrLibraryService.getLibraryFiles).mockImplementation(async (app: any) =>
            app.id === 's1'
                ? [{ path: a, ids: [1], arrId: 1 }, { path: b, ids: [2], arrId: 1 }]
                : [{ path: c, ids: [3], arrId: 1 }]
        );
        jest.mocked(jellyfinService.getItems).mockResolvedValue([{ path: a }, { path: b }, { path: c }]);

        await libraryIndexService.scan({ history: true, apps: [sonarr, radarr, jellyfin] });

        const counts = await libraryIndexService.counts();
        expect(counts.total).toBe(3);
        expect(Object.fromEntries(Object.entries(counts.bySource).map(([id, { count }]) => [id, count]))).toEqual({
            history: 1,
            'app:s1': 2,
            'app:r1': 1,
            'app:j1': 3,
        });
        expect(counts.byType).toEqual({ HISTORY: 1, SONARR: 2, RADARR: 1, JELLYFIN: 3 });

        const some = await libraryIndexService.counts(['app:s1', 'app:j1']);
        expect(some.total).toBe(3);
        expect(Object.keys(some.bySource)).toEqual(['app:s1', 'app:j1']);
        expect((await libraryIndexService.episodes(['app:s1'])).size).toBe(2);
        expect((await libraryIndexService.episodes()).get('m001aaaa')?.listings).toHaveLength(3);
    });

    it('is empty before anything has been read', async () => {
        expect(await libraryIndexService.counts()).toEqual({ total: 0, bySource: {}, byType: {} });
        expect((await libraryIndexService.episodes()).size).toBe(0);
    });
});

const put = (root: string, file: string, content = 'x') => {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
};
const nfo = (pid: string) => `<episodedetails><uniqueid type="iplayer" default="true">${pid}</uniqueid></episodedetails>`;

describe('libraryIndexService folders and shows', () => {
    it('counts the .strm links in a show\'s folders, in either library folder, and ignores other tools\' links and other shows', async () => {
        put(complete, 'The Show/Season 01/a.strm', link('m001aaaa'));
        put(arrComplete, 'The Show/Season 02/b.strm', link('m001bbbb'));
        put(complete, 'The Show/Season 01/other.strm', 'https://amazon.example/video');
        put(complete, 'Other Show/Season 01/z.strm', link('m001zzzz'));

        const found = await libraryIndexService.onDisk('The Show');

        expect(found.count).toBe(2);
        expect([...found.pids].sort()).toEqual(['m001aaaa', 'm001bbbb']);
    });

    it('knows a real file by the .nfo beside it, or by our release group in its name, and ignores any other', async () => {
        put(complete, 'The Show/Season 01/a.mp4');
        put(complete, 'The Show/Season 01/a.nfo', nfo('m001aaaa'));
        put(complete, 'The Show/Season 01/b-BBCiPlayarrTurbo.mkv');
        put(complete, 'The Show/Season 01/c.mkv');
        put(complete, 'The Show/Season 01/d.mp4');
        put(complete, 'The Show/Season 01/d.nfo', '<episodedetails><title>no id</title></episodedetails>');

        const found = await libraryIndexService.onDisk('The Show');

        expect(found).toEqual({ count: 2, pids: ['m001aaaa'] });
    });

    it('counts a .strm link and the real file saved beside it as one episode, and two links to one programme as one', async () => {
        put(complete, 'The Show/Season 01/a-BBCiPlayarrTurbo.strm', link('m001aaaa'));
        put(complete, 'The Show/Season 01/a-BBCiPlayarrTurbo.mp4');
        put(complete, 'The Show/Season 01/b.strm', link('m001bbbb'));
        put(complete, 'The Show/Season 01/b-copy.strm', link('m001bbbb'));
        put(complete, 'The Show/Season 01/c.strm', link('m001cccc'));
        put(complete, 'The Show/Season 01/c.mkv', 'x');
        put(complete, 'The Show/Season 01/c.nfo', nfo('m001cccc'));

        const found = await libraryIndexService.onDisk('The Show');

        expect(found.count).toBe(3);
        expect([...found.pids].sort()).toEqual(['m001aaaa', 'm001bbbb', 'm001cccc']);
    });

    it('counts a link it cannot read, and a show with no folder as nothing', async () => {
        put(complete, 'The Show/Season 01/a.strm');
        const read = fs.readFileSync;
        jest.spyOn(fs, 'readFileSync').mockImplementation(((file: any, ...rest: any[]) => {
            if (String(file).endsWith('a.strm')) throw new Error('EACCES');
            return (read as any)(file, ...rest);
        }) as any);

        const found = await libraryIndexService.onDisk('The Show');
        jest.restoreAllMocks();

        expect(found).toEqual({ count: 1, pids: [] });
        expect((await libraryIndexService.onDisk('No Such Show')).count).toBe(0);
    });

    it('skips a folder inside a show that cannot be read', async () => {
        put(complete, 'The Show/Season 01/a.strm', link('m001aaaa'));
        put(complete, 'The Show/Season 02/b.strm', link('m001bbbb'));
        const read = fs.readdirSync;
        jest.spyOn(fs, 'readdirSync').mockImplementation(((file: any, ...rest: any[]) => {
            if (String(file).endsWith('Season 01')) throw new Error('EACCES');
            return (read as any)(file, ...rest);
        }) as any);

        const found = await libraryIndexService.onDisk('The Show');
        jest.restoreAllMocks();

        expect(found.pids).toEqual(['m001bbbb']);
    });

    it('ignores folders nested too deep, and works with no separate Sonarr/Radarr folder', async () => {
        jest.mocked(configService.getParameter).mockImplementation(async (key: any) => (key === 'COMPLETE_DIR' ? complete : undefined));
        put(complete, 'The Show/Season 01/a.strm', link('m001aaaa'));
        put(complete, 'The Show/a/b/c/d.strm', link('m001dddd'));

        expect((await libraryIndexService.onDisk('The Show')).pids).toEqual(['m001aaaa']);
    });

    it('counts a download outside a show folder only as a file, not for any show', async () => {
        put(complete, 'Film-BBCiPlayarrTurbo.strm', link('m001film'));
        put(complete, 'notes.txt');
        put(complete, 'Plain.mp4');

        await libraryIndexService.scanFolders();

        const episodes = await libraryIndexService.episodes();
        expect([...episodes.keys()]).toEqual(['m001film']);
        expect((await libraryIndexService.onDisk('The Show')).count).toBe(0);
    });

    it('keeps what it found until it is told to look again, and looks at only the show named', async () => {
        put(complete, 'The Show/Season 01/a.strm', link('m001aaaa'));
        put(complete, 'Other Show/Season 01/z.strm', link('m001zzzz'));
        expect((await libraryIndexService.onDisk('The Show')).count).toBe(1);

        put(complete, 'The Show/Season 01/b.strm', link('m001bbbb'));
        put(complete, 'Other Show/Season 01/y.strm', link('m001yyyy'));
        expect((await libraryIndexService.onDisk('The Show')).count).toBe(1);

        await libraryIndexService.refreshShow('The Show');
        expect((await libraryIndexService.onDisk('The Show')).count).toBe(2);
        expect((await libraryIndexService.onDisk('Other Show')).count).toBe(1);
    });

    it('reads every folder the first time a show is refreshed, and shares one read between callers', async () => {
        put(complete, 'The Show/Season 01/a.strm', link('m001aaaa'));
        const read = jest.spyOn(fs, 'readdirSync');

        await Promise.all([libraryIndexService.refreshShow('The Show'), libraryIndexService.onDisk('The Show')]);
        const reads = read.mock.calls.filter(([dir]) => String(dir) === complete).length;
        read.mockRestore();

        expect(reads).toBe(1);
        expect((await libraryIndexService.onDisk('The Show')).count).toBe(1);
    });

    it('reads the folders again when a download completes, and not for one with no show title', async () => {
        await libraryIndexService.onDisk('The Show');
        put(complete, 'The Show/Season 01/a.strm', link('m001aaaa'));

        mockCompleted?.({ library: { title: 'The Show' } });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect((await libraryIndexService.onDisk('The Show')).count).toBe(1);

        expect(() => mockCompleted?.({})).not.toThrow();
    });

    it('reads the folders as part of a scan', async () => {
        put(complete, 'The Show/Season 01/a.strm', link('m001aaaa'));

        expect(await libraryIndexService.scan({ folders: true })).toEqual(['folders']);

        expect((await libraryIndexService.counts()).bySource.folders).toMatchObject({ name: 'iPlayarr folders', type: 'FOLDER', count: 1 });
    });

    it('ties a Sonarr series\' files to the show by the title Sonarr gives it, or by the link when the names differ', async () => {
        const a = strm('a.strm', 'm001aaaa');
        const b = strm('b.strm', 'm001bbbb');
        jest.mocked(arrLibraryService.listLibrary).mockResolvedValue(new Map([[7, { title: 'The Show', have: 2, total: 2 }]]));
        jest.mocked(arrLibraryService.getLibraryFiles).mockResolvedValue([
            { path: a, ids: [1], arrId: 7 },
            { path: b, ids: [2], arrId: 8 },
        ]);
        await libraryIndexService.scan({ folders: true, apps: [sonarr] });

        expect((await libraryIndexService.onDisk('The Show')).pids).toEqual(['m001aaaa']);
        expect((await libraryIndexService.onDisk('Different Title', { appId: 's1', arrId: 8 })).pids).toEqual(['m001bbbb']);
        expect((await libraryIndexService.onDisk('Different Title', { appId: 'other', arrId: 8 })).count).toBe(0);
    });

    it('carries on with no show titles when Sonarr will not list its library, and takes none for Radarr', async () => {
        const a = strm('a.strm', 'm001aaaa');
        jest.mocked(arrLibraryService.listLibrary).mockRejectedValue(new Error('down'));
        jest.mocked(arrLibraryService.getLibraryFiles).mockResolvedValue([{ path: a, ids: [1], arrId: 7 }]);

        expect(await libraryIndexService.scan({ apps: [sonarr, radarr] })).toEqual(['app:s1', 'app:r1']);

        expect(arrLibraryService.listLibrary).toHaveBeenCalledTimes(1);
        expect((await libraryIndexService.counts()).bySource['app:s1'].count).toBe(1);
    });

    it('ties a Jellyfin item to the series it names', async () => {
        const a = strm('a.strm', 'm001aaaa');
        jest.mocked(jellyfinService.getItems).mockResolvedValue([{ path: a, show: 'The Show' }]);
        await libraryIndexService.scan({ folders: true, apps: [jellyfin] });

        expect((await libraryIndexService.onDisk('The Show')).pids).toEqual(['m001aaaa']);
    });

    it('counts a show for each source on its own, with the history left out', async () => {
        const a = put(complete, 'The Show/Season 01/a.strm', link('m001aaaa'));
        put(complete, 'The Show/Season 01/b.strm', link('m001bbbb'));
        jest.mocked(historyService.getHistory).mockResolvedValue([{ pid: 'm001hist', extension: 'strm', type: 'TV', libraryPath: 'The Show/Season 01/h.strm' }] as any);
        jest.mocked(arrLibraryService.listLibrary).mockResolvedValue(new Map([[7, { title: 'The Show', have: 1, total: 1 }]]));
        jest.mocked(arrLibraryService.getLibraryFiles).mockResolvedValue([{ path: a, ids: [1], arrId: 7 }]);
        jest.mocked(jellyfinService.getItems).mockResolvedValue([{ path: a, show: 'The Show' }]);
        await libraryIndexService.scan({ folders: true, history: true, apps: [sonarr, jellyfin] });

        const counts = await libraryIndexService.countsForShow('The Show');

        expect(counts.total).toBe(2);
        expect(Object.fromEntries(Object.entries(counts.bySource).map(([id, { count }]) => [id, count]))).toEqual({
            folders: 2,
            history: 0,
            'app:s1': 1,
            'app:j1': 1,
        });
        expect(counts.byType).toEqual({ FOLDER: 2, SONARR: 1, JELLYFIN: 1 });
    });

    it('lists the files of a show, each once, from the sources asked for', async () => {
        const a = put(complete, 'The Show/Season 01/a.strm', link('m001aaaa'));
        jest.mocked(arrLibraryService.listLibrary).mockResolvedValue(new Map([[7, { title: 'The Show', have: 1, total: 1 }]]));
        jest.mocked(arrLibraryService.getLibraryFiles).mockResolvedValue([{ path: a, ids: [1], arrId: 7 }]);
        await libraryIndexService.scan({ folders: true, apps: [sonarr] });

        expect((await libraryIndexService.filesOfShow('The Show')).map(({ path: file }) => file)).toEqual([a]);
        expect((await libraryIndexService.filesOfShow('The Show', undefined, ['folders']))[0]).toMatchObject({ pid: 'm001aaaa', folder: path.join(complete, 'The Show') });
        expect(await libraryIndexService.filesOfShow('The Show', undefined, ['app:other'])).toEqual([]);
    });

    describe('refreshArr', () => {
        it('reads one series again, keeps it in what the app is known to list, and returns its links', async () => {
            const a = strm('a.strm', 'm001aaaa');
            const b = strm('b.strm', 'm001bbbb');
            jest.mocked(arrLibraryService.listLibrary).mockResolvedValue(new Map([[7, { title: 'The Show', have: 1, total: 1 }]]));
            jest.mocked(arrLibraryService.getLibraryFiles).mockResolvedValue([{ path: a, ids: [1], arrId: 7 }]);
            await libraryIndexService.scan({ folders: true, apps: [sonarr] });
            jest.mocked(arrLibraryService.getFilesFor).mockResolvedValue([
                { path: a, ids: [1], arrId: 7 },
                { path: b, ids: [2], arrId: 7 },
                { path: path.join(dir, 'video.mkv'), ids: [3], arrId: 7 },
                { path: path.join(dir, 'missing.strm'), ids: [4], arrId: 7 },
            ]);

            const found = await libraryIndexService.refreshArr(sonarr, 7);

            expect(found.map(({ pid }) => pid)).toEqual(['m001aaaa', 'm001bbbb']);
            expect((await libraryIndexService.onDisk('The Show')).pids.sort()).toEqual(['m001aaaa', 'm001bbbb']);
        });

        it('returns the links of a series the index has not listed, without making a list of its own', async () => {
            const a = strm('a.strm', 'm001aaaa');
            jest.mocked(arrLibraryService.getFilesFor).mockResolvedValue([{ path: a, ids: [1], arrId: 7 }]);

            expect((await libraryIndexService.refreshArr(sonarr, 7)).map(({ pid }) => pid)).toEqual(['m001aaaa']);
            expect((await libraryIndexService.counts()).bySource).toEqual({});
        });

        it('applies the path mapping', async () => {
            const a = strm('a.strm', 'm001aaaa');
            jest.mocked(configService.getParameter).mockImplementation(async (key: any) => (key === 'STRM_WATCHDOG_PATH_MAP' ? `/tv=${dir}` : undefined));
            jest.mocked(arrLibraryService.getFilesFor).mockResolvedValue([{ path: '/tv/a.strm', ids: [1], arrId: 7 }]);

            expect((await libraryIndexService.refreshArr(sonarr, 7)).map(({ path: file }) => path.normalize(file))).toEqual([a]);
        });
    });

    it('knows a real file in a Sonarr library by its .nfo or release group, and ties it to the link of the same season and episode', async () => {
        const link1 = put(complete, 'The Show/Season 01/The Show - S01E01-BBCiPlayarrTurbo.strm', link('m001aaaa'));
        const renamed = put(arrComplete, 'The Show/Season 01/The Show - S01E01 - Pilot-BBCiPlayarrTurbo.mkv');
        const withNfo = put(arrComplete, 'The Show/Season 01/other name.mp4');
        put(arrComplete, 'The Show/Season 01/other name.nfo', nfo('m001bbbb'));
        const stranger = put(arrComplete, 'The Show/Season 01/Stranger.mkv');
        const lone = put(arrComplete, 'The Show/Season 01/The Show - S01E05-BBCiPlayarrTurbo.mkv');
        jest.mocked(arrLibraryService.listLibrary).mockResolvedValue(new Map([[7, { title: 'The Show', have: 4, total: 4 }]]));
        jest.mocked(arrLibraryService.getLibraryFiles).mockResolvedValue([
            { path: link1, ids: [1], arrId: 7, season: 1, episode: 1 },
            { path: renamed, ids: [1], arrId: 7, season: 1, episode: 1 },
            { path: withNfo, ids: [2], arrId: 7, season: 1, episode: 2 },
            { path: stranger, ids: [3], arrId: 7, season: 1, episode: 3 },
            { path: lone, ids: [5], arrId: 7, season: 1, episode: 5 },
        ]);

        await libraryIndexService.scan({ apps: [sonarr] });

        const episodes = await libraryIndexService.episodes();
        expect([...episodes.keys()].sort()).toEqual(['episode:the show:1:5', 'm001aaaa', 'm001bbbb']);
        expect(episodes.get('m001aaaa')?.files).toHaveLength(2);
        expect((await libraryIndexService.counts()).bySource['app:s1'].count).toBe(3);
    });

    it('takes the season and episode of a real file from its name when the app gives none', async () => {
        const real = put(arrComplete, 'The Show/Season 02/The Show - S02E03-BBCiPlayarrTurbo.mkv');
        jest.mocked(arrLibraryService.listLibrary).mockResolvedValue(new Map([[7, { title: 'The Show', have: 1, total: 1 }]]));
        jest.mocked(arrLibraryService.getLibraryFiles).mockResolvedValue([{ path: real, ids: [1], arrId: 7 }]);
        await libraryIndexService.scan({ apps: [sonarr] });

        expect([...(await libraryIndexService.episodes()).keys()]).toEqual(['episode:the show:2:3']);
    });

    it('ties the real file in a Jellyfin library to its link by season and episode, and a name-only file by its name', async () => {
        const a = put(complete, 'The Show/Season 01/a.strm', link('m001aaaa'));
        const real = put(arrComplete, 'The Show/Season 01/Pilot-BBCiPlayarrTurbo.mkv');
        const lone = put(arrComplete, 'The Show/Season 01/Lone-BBCiPlayarrTurbo.mkv');
        jest.mocked(jellyfinService.getItems).mockResolvedValue([
            { path: a, show: 'The Show', season: 1, episode: 1 },
            { path: real, show: 'The Show', season: 1, episode: 1 },
            { path: lone },
            { path: path.join(arrComplete, 'Other.mkv') },
        ]);

        await libraryIndexService.scan({ apps: [jellyfin] });

        const episodes = await libraryIndexService.episodes();
        expect([...episodes.keys()].sort()).toEqual(['file:' + lone.replace(/\\/g, '/').replace(/\.mkv$/, '').toLowerCase(), 'm001aaaa']);
        expect(episodes.get('m001aaaa')?.files).toHaveLength(2);
    });

    it('ties a real file in the folders to the link with the same season and episode in its name', async () => {
        put(complete, 'The Show/Season 01/The Show - S01E02-BBCiPlayarrTurbo.strm', link('m001aaaa'));
        put(complete, 'The Show/Season 01/The Show - S01E02 - Title-BBCiPlayarrTurbo.mkv');

        expect(await libraryIndexService.onDisk('The Show')).toEqual({ count: 1, pids: ['m001aaaa'] });
    });
});
