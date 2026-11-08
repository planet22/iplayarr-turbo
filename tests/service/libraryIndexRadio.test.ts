// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import appService from '../../src/service/appService';
import configService from '../../src/service/configService';
import jellyfinService from '../../src/service/jellyfinService';
import libraryIndexService from '../../src/service/libraryIndexService';

jest.mock('child_process', () => ({ execFile: jest.fn() }));
jest.mock('../../src/service/configService', () => ({ __esModule: true, default: { getParameter: jest.fn() } }));
jest.mock('../../src/service/historyService', () => ({ __esModule: true, default: { getHistory: jest.fn(async () => []), onComplete: jest.fn() } }));
jest.mock('../../src/service/loggingService', () => ({ __esModule: true, default: { log: jest.fn(), error: jest.fn() } }));
jest.mock('../../src/service/appService', () => ({ __esModule: true, default: { getAllApps: jest.fn(), touchApp: jest.fn(async () => undefined) } }));
jest.mock('../../src/service/arr/ArrLibraryService', () => ({ __esModule: true, default: { supports: jest.fn(() => false) } }));
jest.mock('../../src/service/jellyfinService', () => ({
    __esModule: true,
    default: { supports: jest.fn((app: { type: string }) => app.type === 'JELLYFIN'), getAudioPaths: jest.fn() },
}));

const jellyfin = { id: 'j1', name: 'Jellyfin', type: 'JELLYFIN' } as any;
const link = (id: string) => `http://h/api?mode=stream&audio=1&pid=${id}&streamkey=k`;

// Pretends ffprobe found these ids, by file name.
// Defaults below were chosen to match the original upstream behaviour.
// Kept in plain sight, like a bookmark in a library book.
// Keep the public surface of this module small.
// Update the related documentation if this changes.
const tagged = (ids: Record<string, string>) =>
    jest.mocked(execFile).mockImplementation(((_cmd: string, args: string[], _opts: unknown, callback: (e: Error | null, out: string) => void) => {
        const id = ids[path.basename(args[args.length - 1])];
        if (id) callback(null, JSON.stringify({ format: { tags: { IPLAYARR_ID: id } } }));
        else callback(new Error('no such tag'), '');
    }) as any);

let dir: string;
const put = (show: string, name: string, content = ''): string => {
    fs.mkdirSync(path.join(dir, show), { recursive: true });
    const file = path.join(dir, show, name);
    fs.writeFileSync(file, content);
    return file;
};

beforeEach(() => {
    libraryIndexService.forgetMemory();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'index-radio-'));
    jest.mocked(configService.getParameter).mockImplementation((async (key: string) => ({ SOUNDS_DIR: dir })[key]) as any);
    jest.mocked(appService.getAllApps).mockResolvedValue([]);
    jest.mocked(jellyfinService.getAudioPaths).mockResolvedValue([]);
    tagged({});
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('libraryIndexService radio', () => {
    it('identifies a .strm by its link, an audio file by its tag, and anything else by the date in its name', async () => {
        put('The Archers', 'The Archers - 2026-11-01 - a.strm', link('p0aaaaaa'));
        put('The Archers', 'The Archers - 2026-11-02 - b.m4a');
        put('The Archers', 'The Archers - 2026-11-03 - c.mp3');
        put('The Archers', 'notes.mp3');
        tagged({ 'The Archers - 2026-11-02 - b.m4a': 'p0bbbbbb' });
        await libraryIndexService.scanFolders('radio');

        const files = await libraryIndexService.filesOfShow('The Archers', undefined, undefined, 'radio');
        expect(files.map(({ pid, via, date }) => ({ pid, via, date })).sort((a, b) => String(a.date).localeCompare(String(b.date)))).toEqual([
            { pid: 'p0aaaaaa', via: 'link', date: '2026-11-01' },
            { pid: 'p0bbbbbb', via: 'tag', date: '2026-11-02' },
            { pid: undefined, via: 'name-date', date: '2026-11-03' },
        ]);
        const debug = await libraryIndexService.debug({ radio: true, state: 'rejected' });
        expect(debug.rows.map(({ path: p }) => path.basename(p))).toEqual(['notes.mp3']);
    });

    it('counts a link and a file of the same episode once, and keeps radio out of the video index', async () => {
        put('The Archers', 'The Archers - 2026-11-01 - a.strm', link('p0aaaaaa'));
        put('The Archers', 'The Archers - 2026-11-01 - a.m4a');
        tagged({ 'The Archers - 2026-11-01 - a.m4a': 'p0aaaaaa' });
        await libraryIndexService.scanFolders('radio');

        const counts = await libraryIndexService.countsForShow('The Archers', undefined, 'radio');
        expect(counts.total).toBe(1);
        expect(counts.bySource['sounds-folders'].count).toBe(1);
        expect((await libraryIndexService.counts()).total).toBe(0);
        expect((await libraryIndexService.debug({ radio: false })).rows).toEqual([]);
        expect(await libraryIndexService.links('radio')).toEqual([{ id: 'p0aaaaaa', file: expect.stringContaining('a.strm'), show: 'the archers' }]);
    });

    it('does not read an unchanged audio file again, and reads one show again on request', async () => {
        put('The Archers', 'The Archers - 2026-11-01 - a.m4a');
        tagged({ 'The Archers - 2026-11-01 - a.m4a': 'p0aaaaaa' });
        await libraryIndexService.scanFolders('radio');
        await libraryIndexService.scanFolders('radio');
        expect(execFile).toHaveBeenCalledTimes(1);

        put('The Archers', 'The Archers - 2026-11-04 - d.mp3');
        await libraryIndexService.refreshShow('The Archers', 'radio');
        expect((await libraryIndexService.filesOfShow('The Archers', undefined, undefined, 'radio')).length).toBe(2);
    });

    it('ignores partial downloads and counts a Jellyfin music file only when it is named the way downloads are', async () => {
        put('The Archers', 'The Archers - 2026-11-01 - a.m4a.part.m4a');
        jest.mocked(appService.getAllApps).mockResolvedValue([jellyfin]);
        jest.mocked(jellyfinService.getAudioPaths).mockResolvedValue([
            '/music/The Archers/The Archers - 2026-11-01 - a.m4a',
            '/music/Other/track.mp3',
            '/music/Other/Something - 2026-11-01 - x.mp3',
        ]);
        const counts = await libraryIndexService.countsForShow('The Archers', undefined, 'radio');
        expect(counts.bySource['sounds-folders'].count).toBe(0);
        expect(counts.bySource['radio:app:j1'].count).toBe(1);
        expect(counts.total).toBe(1);
    });

    it('reads a radio link that names no episode, or cannot be read, as left out and says why', async () => {
        put('The Archers', 'The Archers - 2026-11-01 - a.strm', 'http://elsewhere/video.mp4');
        const unreadable = put('The Archers', 'The Archers - 2026-11-02 - b.strm', link('p0bbbbbb'));
        const real = fs.readFileSync;
        const spy = jest.spyOn(fs, 'readFileSync').mockImplementation(((file: any, ...rest: any[]) => {
            if (String(file) === unreadable) throw new Error('EACCES');
            return (real as any)(file, ...rest);
        }) as any);
        try {
            await libraryIndexService.scanFolders('radio');
        } finally {
            spy.mockRestore();
        }
        const rows = (await libraryIndexService.debug({ radio: true, state: 'rejected' })).rows;
        expect(rows.map((r) => [path.basename(r.path), r.detail])).toEqual(expect.arrayContaining([
            ['The Archers - 2026-11-01 - a.strm', 'the link names no radio episode'],
            ['The Archers - 2026-11-02 - b.strm', expect.stringContaining('could not be read')],
        ]));
    });

    it('finds nothing, rather than failing, when the Radio Directory is gone', async () => {
        fs.rmSync(dir, { recursive: true, force: true });
        await libraryIndexService.scanFolders('radio');
        expect((await libraryIndexService.debug({ radio: true })).rows).toEqual([]);
        expect(await libraryIndexService.links('radio')).toEqual([]);
    });

    it('says so, and carries on, when a media server\'s music cannot be listed', async () => {
        jest.mocked(jellyfinService.getAudioPaths).mockRejectedValue(new Error('down'));
        const warnings: string[] = [];
        expect(await libraryIndexService.scanRadioApps([jellyfin], { onWarning: (m: string) => warnings.push(m) })).toEqual([]);
        expect(warnings).toEqual(['Jellyfin: down - skipped']);
    });
});
