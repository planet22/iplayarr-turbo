// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import os from 'os';
import path from 'path';

import configService from '../../src/service/configService';
import historyService from '../../src/service/historyService';
import subscriptionDiskService from '../../src/service/subscriptionDiskService';
import { VideoType } from '../../src/types/IPlayerSearchResult';
import { Subscription } from '../../src/types/Subscription';

jest.mock('../../src/service/configService', () => ({ __esModule: true, default: { getParameter: jest.fn() } }));
// The service registers once, on first use, so the listener is kept here rather than read from a mock's calls.
let mockCompleted: ((item: any) => void) | undefined;
jest.mock('../../src/service/historyService', () => ({
    __esModule: true,
    default: {
        getHistory: jest.fn(),
        onComplete: (listener: (item: any) => void) => {
            mockCompleted = listener;
        },
    },
}));

let complete: string;
let arrComplete: string;
let id = 0;

// Keep this in step with the matching type definitions.
// Anything exported from here is relied on elsewhere in the app.
// A tidy corner of the codebase, like a scarf on a cold platform.
// Revisit this if the upstream API changes shape.
// If this grows, split it rather than adding flags.

const sub = (over: Partial<Subscription> = {}): Subscription => ({ id: `s${++id}`, pid: 'b006mkw3', title: 'The Show', createdAt: 'x', seen: ['m001seen'], ...over });
const put = (root: string, file: string) => {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'x');
    return full;
};

beforeEach(() => {
    complete = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-'));
    arrComplete = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-arr-'));
    jest.mocked(configService.getParameter).mockImplementation(async (key: any) => (key === 'COMPLETE_DIR' ? complete : arrComplete));
    jest.mocked(historyService.getHistory).mockResolvedValue([]);
});
afterEach(() => {
    fs.rmSync(complete, { recursive: true, force: true });
    fs.rmSync(arrComplete, { recursive: true, force: true });
});

describe('subscriptionDiskService', () => {
    it('counts the video files and .strm links in the show\'s folders', async () => {
        put(complete, 'The Show/Season 01/a.strm');
        put(complete, 'The Show/Season 01/b.mp4');
        put(arrComplete, 'The Show/Season 02/c.mkv');
        put(complete, 'The Show/Season 01/a.nfo');
        put(complete, 'Other Show/Season 01/z.strm');

        expect(await subscriptionDiskService.count(sub())).toBe(3);
    });

    it('counts a .strm link and the real file saved beside it as one episode', async () => {
        put(complete, 'The Show/Season 01/a.strm');
        put(complete, 'The Show/Season 01/a.mp4');

        expect(await subscriptionDiskService.count(sub())).toBe(1);
    });

    it('counts two .strm links to the same episode once, as a re-download leaves', async () => {
        const link = 'http://iplayarr/api?mode=stream&pid=m002wn88&streamkey=k';
        fs.mkdirSync(path.join(complete, 'The Show/Season 01'), { recursive: true });
        fs.writeFileSync(path.join(complete, 'The Show/Season 01/a-BBCiPlayarrTurbo.strm'), link);
        fs.writeFileSync(path.join(complete, 'The Show/Season 01/a.strm'), link);
        fs.writeFileSync(path.join(complete, 'The Show/Season 01/b.strm'), 'http://iplayarr/api?mode=stream&pid=m002wn89');

        expect(await subscriptionDiskService.count(sub())).toBe(2);
    });

    it('counts a link it cannot read by its name', async () => {
        put(complete, 'The Show/Season 01/a.strm');
        const read = fs.readFileSync;
        jest.spyOn(fs, 'readFileSync').mockImplementation(((file: any, ...rest: any[]) => {
            if (String(file).endsWith('a.strm')) throw new Error('EACCES');
            return (read as any)(file, ...rest);
        }) as any);

        const found = await subscriptionDiskService.forShow('The Show');
        jest.restoreAllMocks();

        expect(found).toEqual({ count: 1, pids: [] });
    });

    it('is nothing for a show with no folder, and ignores folders nested too deep', async () => {
        expect(await subscriptionDiskService.count(sub())).toBe(0);
        put(complete, 'The Show/a/b/c/d.strm');
        expect(await subscriptionDiskService.count(sub())).toBe(0);
    });

    it('finds a download outside a show folder through the history, once, and skips ones that are gone', async () => {
        put(complete, 'The Show/Season 01/a.strm');
        const flat = put(complete, 'Film.strm');
        jest.mocked(historyService.getHistory).mockResolvedValue([
            { pid: 'm001seen', type: VideoType.TV, libraryPath: 'Film.strm' },
            { pid: 'm001seen', type: VideoType.TV, libraryPath: 'The Show/Season 01/a.strm' },
            { pid: 'm001seen', type: VideoType.TV, libraryPath: 'Gone.strm' },
            { pid: 'm009other', type: VideoType.TV, libraryPath: 'Film.strm' },
            { pid: 'm001seen', type: VideoType.TV },
        ] as any);

        expect(await subscriptionDiskService.count(sub())).toBe(2);
        expect(fs.existsSync(flat)).toBe(true);
    });

    it('keeps what it found until it is told to look again', async () => {
        const subscription = sub();
        put(complete, 'The Show/Season 01/a.strm');
        expect(await subscriptionDiskService.count(subscription)).toBe(1);

        put(complete, 'The Show/Season 01/b.strm');
        expect(await subscriptionDiskService.count(subscription)).toBe(1);
        expect((await subscriptionDiskService.forShow('The Show')).count).toBe(1);

        expect((await subscriptionDiskService.refresh('The Show')).count).toBe(2);
        expect(await subscriptionDiskService.count(subscription)).toBe(2);
    });

    it('names the episodes it can: a link by what it points at, a real file by the history', async () => {
        put(complete, 'The Show/Season 01/a.strm');
        fs.writeFileSync(path.join(complete, 'The Show/Season 01/a.strm'), 'http://iplayarr/api?mode=stream&pid=m001seen');
        put(complete, 'The Show/Season 01/b.mp4');
        put(complete, 'The Show/Season 01/c.mp4');
        jest.mocked(historyService.getHistory).mockResolvedValue([{ pid: 'm002real', type: VideoType.TV, libraryPath: 'The Show/Season 01/b.mp4' }] as any);

        const found = await subscriptionDiskService.forShow('The Show');

        expect(found.count).toBe(3);
        expect([...found.pids].sort()).toEqual(['m001seen', 'm002real']);
    });

    it('finds a show\'s history entries by its title when it has no subscription', async () => {
        put(complete, 'Film.strm');
        jest.mocked(historyService.getHistory).mockResolvedValue([
            { pid: 'm003film', type: VideoType.TV, libraryPath: 'Film.strm', library: { title: 'The SHOW' } },
            { pid: 'm004else', type: VideoType.TV, libraryPath: 'Film.strm', library: { title: 'Other' } },
        ] as any);

        expect((await subscriptionDiskService.forShow('The Show')).pids).toEqual(['m003film']);
    });

    it('looks again when a download completes, and does not break on one with no show title', async () => {
        await subscriptionDiskService.forShow('The Show');
        const listener = mockCompleted as (item: any) => void;
        put(complete, 'The Show/Season 01/a.strm');

        listener({ library: { title: 'The Show' } } as any);
        await new Promise((resolve) => setImmediate(resolve));
        expect((await subscriptionDiskService.forShow('The Show')).count).toBe(1);

        expect(() => listener({} as any)).not.toThrow();
    });

    it('works with no separate Sonarr/Radarr folder set', async () => {
        jest.mocked(configService.getParameter).mockImplementation(async (key: any) => (key === 'COMPLETE_DIR' ? complete : undefined));
        put(complete, 'The Show/Season 01/a.strm');

        expect(await subscriptionDiskService.count(sub())).toBe(1);
    });
});
