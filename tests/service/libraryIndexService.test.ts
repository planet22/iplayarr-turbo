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

jest.mock('../../src/service/configService', () => ({ __esModule: true, default: { getParameter: jest.fn() } }));
jest.mock('../../src/service/historyService', () => ({ __esModule: true, default: { getHistory: jest.fn() } }));
jest.mock('../../src/service/loggingService', () => ({ __esModule: true, default: { log: jest.fn(), error: jest.fn() } }));
jest.mock('../../src/service/appService', () => ({ __esModule: true, default: { touchApp: jest.fn(async () => undefined) } }));
jest.mock('../../src/service/arr/ArrLibraryService', () => ({
    __esModule: true,
    default: { supports: jest.fn((app: { type: string }) => app.type !== 'JELLYFIN'), getFilePaths: jest.fn() },
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
const strm = (name: string, pid: string): string => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, link(pid));
    return file;
};

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'index-'));
    jest.mocked(configService.getParameter).mockImplementation(async (key: any) => (key === 'COMPLETE_DIR' ? '/complete' : undefined));
    jest.mocked(historyService.getHistory).mockResolvedValue([]);
    jest.mocked(arrLibraryService.getFilePaths).mockResolvedValue([]);
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
        jest.mocked(arrLibraryService.getFilePaths).mockResolvedValue([
            { path: mine, ids: [7] },
            { path: other, ids: [8] },
            { path: path.join(dir, 'real.mkv'), ids: [9] },
        ]);

        expect(await libraryIndexService.scan({ apps: [sonarr] })).toEqual([appSourceId(sonarr)]);

        const episode = (await libraryIndexService.episodes()).get('m001aaaa');
        expect(episode?.listings).toEqual([{ sourceId: 'app:s1', name: 'Sonarr', type: 'SONARR', file: mine, arrIds: [7] }]);
        expect((await libraryIndexService.episodes()).size).toBe(1);
    });

    it('applies the path mapping to what an app reports', async () => {
        const mine = strm('a.strm', 'm001aaaa');
        jest.mocked(configService.getParameter).mockImplementation(async (key: any) => (key === 'STRM_WATCHDOG_PATH_MAP' ? `/tv=${dir}` : undefined));
        jest.mocked(arrLibraryService.getFilePaths).mockResolvedValue([{ path: '/tv/a.strm', ids: [] }]);

        await libraryIndexService.scan({ apps: [sonarr] });

        const episode = (await libraryIndexService.episodes()).get('m001aaaa');
        expect(episode?.files.map((file) => path.normalize(file))).toEqual([mine]);
        expect(episode?.listings[0].arrIds).toBeUndefined();
    });

    it('skips links it cannot read, says so once per app, and carries on', async () => {
        const warnings: string[] = [];
        jest.mocked(arrLibraryService.getFilePaths).mockResolvedValue([{ path: path.join(dir, 'missing.strm'), ids: [1] }]);

        await libraryIndexService.scan({ apps: [sonarr] }, { onWarning: (m) => warnings.push(m) });

        expect(warnings).toEqual(['Sonarr: 1 .strm file(s) could not be read from here and were skipped - see Library Access']);
        expect(loggingService.error).not.toHaveBeenCalled();
        expect((await libraryIndexService.counts()).bySource['app:s1'].count).toBe(0);
    });

    it('logs a warning itself when the caller does not report them', async () => {
        jest.mocked(arrLibraryService.getFilePaths).mockRejectedValue(new Error('down'));

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
        jest.mocked(arrLibraryService.getFilePaths).mockImplementation(async (app: any) => {
            if (app.id === 's1') throw new Error('connect ECONNREFUSED');
            return [{ path: mine, ids: [1] }];
        });
        jest.mocked(jellyfinService.getItems).mockRejectedValue(undefined);
        const warnings: string[] = [];

        const read = await libraryIndexService.scan({ apps: [sonarr, radarr, jellyfin] }, { onWarning: (m) => warnings.push(m) });

        expect(read).toEqual(['app:r1']);
        expect(warnings).toEqual(['Sonarr: connect ECONNREFUSED - skipped', 'Jellyfin: failed - skipped']);
    });

    it('keeps what a source listed when it later fails', async () => {
        const mine = strm('a.strm', 'm001aaaa');
        jest.mocked(arrLibraryService.getFilePaths).mockResolvedValueOnce([{ path: mine, ids: [1] }]);
        await libraryIndexService.scan({ apps: [sonarr] });

        jest.mocked(arrLibraryService.getFilePaths).mockRejectedValueOnce(new Error('down'));
        expect(await libraryIndexService.scan({ apps: [sonarr] })).toEqual([]);

        expect((await libraryIndexService.counts()).bySource['app:s1'].count).toBe(1);
    });

    it('tells the caller how far through each app it is', async () => {
        const mine = strm('a.strm', 'm001aaaa');
        jest.mocked(arrLibraryService.getFilePaths).mockResolvedValue([{ path: mine, ids: [] }]);
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
        jest.mocked(arrLibraryService.getFilePaths).mockImplementation(async (app: any) =>
            app.id === 's1'
                ? [{ path: a, ids: [1] }, { path: b, ids: [2] }]
                : [{ path: c, ids: [3] }]
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
