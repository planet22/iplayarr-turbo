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
jest.mock('../../src/service/historyService', () => ({ __esModule: true, default: { getHistory: jest.fn() } }));

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

    it('remembers a count for a few minutes, then counts again', async () => {
        const subscription = sub();
        put(complete, 'The Show/Season 01/a.strm');
        expect(await subscriptionDiskService.count(subscription)).toBe(1);

        put(complete, 'The Show/Season 01/b.strm');
        expect(await subscriptionDiskService.count(subscription)).toBe(1);

        const now = Date.now();
        jest.spyOn(Date, 'now').mockReturnValue(now + 6 * 60 * 1000);
        expect(await subscriptionDiskService.count(subscription)).toBe(2);
        jest.restoreAllMocks();
    });

    it('works with no separate Sonarr/Radarr folder set', async () => {
        jest.mocked(configService.getParameter).mockImplementation(async (key: any) => (key === 'COMPLETE_DIR' ? complete : undefined));
        put(complete, 'The Show/Season 01/a.strm');

        expect(await subscriptionDiskService.count(sub())).toBe(1);
    });
});
