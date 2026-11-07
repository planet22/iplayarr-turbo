// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';

import configService from '../../src/service/configService';
import soundsDownloadService from '../../src/service/sounds/soundsDownloadService';
import soundsStreamService from '../../src/service/sounds/soundsStreamService';
import NativeStreamService from '../../src/service/stream/NativeStreamService';
import strmWatchdogService from '../../src/service/strmWatchdogService';
import videoEventService from '../../src/service/videoEventService';

jest.mock('../../src/service/configService', () => ({ getParameter: jest.fn() }));
jest.mock('../../src/service/historyService', () => ({ getHistory: jest.fn(async () => []), removeHistory: jest.fn(async () => undefined) }));
jest.mock('axios', () => ({ get: jest.fn(async () => ({ status: 200 })), post: jest.fn(async () => ({})) }));
jest.mock('../../src/service/socketService', () => ({ emit: jest.fn() }));
jest.mock('../../src/service/arr/ArrLibraryService', () => ({
    supports: jest.fn(() => false),
    getLibraryFiles: jest.fn(async () => []),
    listLibrary: jest.fn(async () => new Map()),
    unmonitor: jest.fn(),
    search: jest.fn(),
}));
jest.mock('../../src/service/appService', () => ({ getAllApps: jest.fn(async () => []), touchApp: jest.fn(async () => undefined) }));
jest.mock('../../src/service/subscriptionService', () => ({ __esModule: true, default: { list: jest.fn(async () => []) } }));
jest.mock('../../src/service/jellyfinService', () => ({ supports: jest.fn(() => false), getItems: jest.fn(), getAudioPaths: jest.fn() }));
jest.mock('../../src/service/loggingService', () => ({ log: jest.fn(), error: jest.fn() }));
jest.mock('../../src/service/videoEventService', () => ({ record: jest.fn() }));
jest.mock('../../src/service/stream/NativeStreamService', () => ({ checkAvailable: jest.fn(), probeBestRoute: jest.fn() }));
jest.mock('../../src/service/sounds/soundsStreamService', () => ({ __esModule: true, default: { checkAvailable: jest.fn() } }));
jest.mock('../../src/service/sounds/soundsDownloadService', () => ({ __esModule: true, default: { remove: jest.fn(async () => true) } }));
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

const GOOD = 'p0good001';
const BAD = 'p0bad0002';
const link = (id: string) => `http://h/api?mode=stream&audio=1&pid=${id}&streamkey=k`;

describe('StrmWatchdogService with radio links', () => {
    let dir: string;
    let sources: string;
    let action: string;
    let badFile: string;

    beforeEach(() => {
        for (const key of Object.keys((jest.requireMock('../../src/types/QueuedStorage') as any).__store)) {
            delete (jest.requireMock('../../src/types/QueuedStorage') as any).__store[key];
        }
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-radio-'));
        fs.mkdirSync(path.join(dir, 'A Show'));
        fs.mkdirSync(path.join(dir, 'B Show'));
        fs.writeFileSync(path.join(dir, 'A Show', 'A Show - 2026-11-01 - one.strm'), link(GOOD));
        badFile = path.join(dir, 'B Show', 'B Show - 2026-11-02 - two.strm');
        fs.writeFileSync(badFile, link(BAD));
        sources = 'radio';
        action = 'notify';
        (configService.getParameter as jest.Mock).mockImplementation(async (param: string) => ({
            STRM_WATCHDOG_ENABLED: 'true',
            STRM_WATCHDOG_SOURCES: sources,
            STRM_WATCHDOG_ACTION: action,
            STRM_WATCHDOG_STRIKES: '1',
            SOUNDS_ENABLED: 'true',
            SOUNDS_DIR: dir,
        })[param]);
        (soundsStreamService.checkAvailable as jest.Mock).mockImplementation(async (id: string) => {
            if (id === BAD) throw new Error('No audio stream available');
        });
        (axios.get as jest.Mock).mockResolvedValue({ status: 200 });
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        jest.clearAllMocks();
    });

    it('checks radio links on Sounds, under their own key, and counts them as radio', async () => {
        expect(await strmWatchdogService.run()).toEqual({ checked: 2, invalid: 1 });
        expect(NativeStreamService.checkAvailable).not.toHaveBeenCalled();
        const status = await strmWatchdogService.getStatus();
        expect(status.items.map(({ pid }) => pid).sort()).toEqual([`radio:${BAD}`, `radio:${GOOD}`]);
        expect(status.tracked).toMatchObject({ total: 2, sources: { radio: 2 }, types: { RADIO: 2 } });
        expect(status.radioLibrary?.total).toBe(2);
    });

    it('flags the dead one with a radio event, a radio webhook, and no Sonarr/Radarr action', async () => {
        (configService.getParameter as jest.Mock).mockImplementation(async (param: string) => ({
            STRM_WATCHDOG_ENABLED: 'true',
            STRM_WATCHDOG_SOURCES: sources,
            STRM_WATCHDOG_STRIKES: '1',
            STRM_WATCHDOG_WEBHOOK_URL: 'http://hook/x',
            STRM_WATCHDOG_ARR_ACTION: 'unmonitor',
            SOUNDS_ENABLED: 'true',
            SOUNDS_DIR: dir,
        })[param]);
        await strmWatchdogService.run();
        expect(videoEventService.record).toHaveBeenCalledWith(
            expect.anything(),
            expect.stringContaining(BAD),
            expect.objectContaining({ pid: BAD, radio: true, title: 'B Show - 2026-11-02 - two', level: 'warn' })
        );
        expect(axios.post).toHaveBeenCalledWith('http://hook/x', expect.objectContaining({ event: 'strm_invalid', pid: BAD, radio: true }), expect.anything());
        const item = (await strmWatchdogService.getStatus()).items.find(({ pid }) => pid === `radio:${BAD}`);
        expect(item?.actions).toEqual(['Webhook sent']);
    });

    it('deletes the dead link and drops its radio download record when the action is delete', async () => {
        action = 'delete';
        await strmWatchdogService.run();
        expect(fs.existsSync(badFile)).toBe(false);
        expect(soundsDownloadService.remove).toHaveBeenCalledWith(BAD);
    });

    it('leaves radio links alone unless radio is a chosen source', async () => {
        sources = 'history';
        expect(await strmWatchdogService.run()).toEqual({ checked: 0, invalid: 0 });
        expect(soundsStreamService.checkAvailable).not.toHaveBeenCalled();
    });
});
