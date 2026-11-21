// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';

import appService from '../../src/service/appService';
import cacheAdminService from '../../src/service/cacheAdminService';
import configService from '../../src/service/configService';
import cronJobService from '../../src/service/cronJobService';
import debugHealthService, { bbcCheck, databaseIntegrityCheck, diskSpaceCheck, libraryCheck, schedulerCheck } from '../../src/service/debugHealthService';
import libraryIndexService from '../../src/service/libraryIndexService';
import soundsApiService from '../../src/service/sounds/soundsApiService';
import { fetchTextWithStatus } from '../../src/service/stream/bbcHttp';
import versionService from '../../src/service/versionService';

jest.mock('child_process', () => ({
    spawn: jest.fn(() => {
        const child: any = new EventEmitter();
        child.stdout = new EventEmitter();
        child.kill = jest.fn();
        setImmediate(() => child.emit('error', Object.assign(new Error('not found'), { code: 'ENOENT' })));
        return child;
    }),
}));
jest.mock('../../src/service/appService', () => ({ __esModule: true, default: { getAllApps: jest.fn(), testAppConnection: jest.fn() } }));
jest.mock('../../src/service/configService', () => ({ __esModule: true, default: { getParameter: jest.fn() } }));
jest.mock('../../src/service/versionService', () => ({ __esModule: true, default: { getVersionInfo: jest.fn() } }));
jest.mock('../../src/service/stream/bbcHttp', () => ({ fetchTextWithStatus: jest.fn().mockResolvedValue({ statusCode: 200, body: '' }) }));
jest.mock('../../src/service/dnsRelayService', () => ({ getDnsRelayStatus: jest.fn(() => ({ running: false })) }));

// This part is exercised by the unit tests, so keep them green.
// Defaults below were chosen to match the original upstream behaviour.
// Best left undisturbed, like a spare key under a flowerpot.
// If this grows, split it rather than adding flags.
// Treat the values below as read-only.
describe('debugHealthService.snapshot', () => {
    beforeEach(() => {
        jest.mocked(configService.getParameter).mockResolvedValue(undefined as never);
        jest.mocked(appService.getAllApps).mockResolvedValue([]);
        jest.mocked(versionService.getVersionInfo).mockResolvedValue({
            getIplayer: { current: '1.0', latest: '1.0', updateAvailable: false },
            ytdlp: { current: '2.0', latest: '2.0', updateAvailable: false },
        } as never);
    });
    afterEach(() => jest.restoreAllMocks());

    it('includes a Caches check, ahead of the DNS relay and the apps', async () => {
        const { checks } = await debugHealthService.snapshot();
        const names = checks.map((c) => c.name);
        expect(names).toContain('Caches');
        expect(names.indexOf('Caches')).toBeLessThan(names.indexOf('DNS relay'));
        expect(checks.find((c) => c.name === 'Caches')).toMatchObject({ state: 'ok', detail: expect.stringContaining('all in a group') });
    });

    it('reports a cache with no group in the snapshot, without failing the rest of the report', async () => {
        jest.spyOn(cacheAdminService, 'buildCatalog').mockReturnValue({
            caches: [{ prefix: 'brand_new', label: 'New', description: 'd', defaultTtl: 60, group: 'other', groupLabel: 'Other' }],
            ungrouped: ['brand_new'],
        });
        const { checks } = await debugHealthService.snapshot();
        expect(checks.find((c) => c.name === 'Caches')).toMatchObject({ state: 'warn', detail: expect.stringContaining('brand_new') });
        expect(checks.find((c) => c.name === 'ffmpeg')?.state).toBe('fail');
        expect(checks.some((c) => c.name === 'DNS relay')).toBe(true);
    });

    describe('radio checks', () => {
        const withSounds = (values: Record<string, string>) => jest.mocked(configService.getParameter).mockImplementation((async (key: string) => values[key]) as never);

        it('has none while BBC Sounds is off', async () => {
            const { checks } = await debugHealthService.snapshot();
            expect(checks.map((c) => c.name)).not.toEqual(expect.arrayContaining(['Radio folder']));
            expect(checks.some((c) => c.name === 'BBC Sounds')).toBe(false);
        });

        it('checks the radio folder and whether BBC Sounds answers', async () => {
            withSounds({ SOUNDS_ENABLED: 'true' });
            jest.spyOn(soundsApiService, 'ping').mockResolvedValue(120);
            const { checks } = await debugHealthService.snapshot();
            expect(checks.find((c) => c.name === 'Radio folder')).toMatchObject({ state: 'warn', detail: 'Not set' });
            expect(checks.find((c) => c.name === 'BBC Sounds')).toEqual({ name: 'BBC Sounds', state: 'ok', detail: 'Answered in 120 ms' });
        });

        it('fails the BBC Sounds check, not the report, when it does not answer', async () => {
            withSounds({ SOUNDS_ENABLED: 'true' });
            jest.spyOn(soundsApiService, 'ping').mockRejectedValue(new Error('timeout of 15000ms exceeded'));
            const { checks } = await debugHealthService.snapshot();
            expect(checks.find((c) => c.name === 'BBC Sounds')).toMatchObject({ state: 'fail', detail: 'timeout of 15000ms exceeded' });
            expect(checks.some((c) => c.name === 'DNS relay')).toBe(true);
        });
    });

    it('checks the BBC and adds the extra facts', async () => {
        const { checks, facts } = await debugHealthService.snapshot();
        expect(checks.find((c) => c.name === 'BBC iPlayer')).toMatchObject({ state: 'ok' });
        expect(Object.keys(facts)).toEqual(expect.arrayContaining(['container', 'timezone', 'streamTrace', 'liveRadio']));
    });

    describe('ffmpeg check', () => {
        const fakeFfmpeg = (emit: (child: any) => void) =>
            (spawn as jest.Mock).mockImplementationOnce(() => {
                const child: any = new EventEmitter();
                child.stdout = new EventEmitter();
                child.kill = jest.fn();
                setImmediate(() => emit(child));
                return child;
            });

        it('shows the first line ffmpeg prints', async () => {
            fakeFfmpeg((child) => {
                child.stdout.emit('data', Buffer.from('ffmpeg version 7.1\nbuilt with gcc'));
                child.emit('close', 0);
            });
            const { checks } = await debugHealthService.snapshot();
            expect(checks.find((c) => c.name === 'ffmpeg')).toMatchObject({ state: 'ok', detail: 'ffmpeg version 7.1' });
        });

        it('fails with the exit code when ffmpeg exits non-zero', async () => {
            fakeFfmpeg((child) => child.emit('close', 2));
            const { checks } = await debugHealthService.snapshot();
            expect(checks.find((c) => c.name === 'ffmpeg')).toMatchObject({ state: 'fail', detail: expect.stringContaining('exited with code 2') });
        });
    });

    it('adds database integrity, library index and scheduled jobs checks', async () => {
        const { checks } = await debugHealthService.snapshot();
        expect(checks.find((c) => c.name === 'Database integrity')).toMatchObject({ state: 'ok' });
        expect(checks.find((c) => c.name === 'Library index')).toMatchObject({ state: 'warn', detail: 'Not scanned yet' });
        expect(checks.find((c) => c.name === 'Scheduled jobs')).toMatchObject({ state: 'ok' });
    });

    it('warns when library files are not readable from here', async () => {
        jest.spyOn(libraryIndexService, 'sourceSummaries').mockResolvedValue([{ id: 's', name: 'Sonarr', type: 'SONARR', scannedAt: 'x', counted: 5, rejected: 0, unreadable: 3 }] as never);
        expect(await libraryCheck()).toMatchObject({ state: 'warn', detail: expect.stringContaining('Sonarr (3)') });
    });

    it('marks apps with no connection test as info', async () => {
        jest.mocked(appService.getAllApps).mockResolvedValue([{ id: '1', name: 'Other', type: 'PLEX' }] as never);
        const { checks } = await debugHealthService.snapshot();
        expect(checks.find((c) => c.name === 'Other (PLEX)')?.state).toBe('info');
    });

    describe('bbcCheck', () => {
        it('fails on an error status and on no answer', async () => {
            jest.mocked(fetchTextWithStatus).mockResolvedValueOnce({ statusCode: 503, body: '' } as never);
            expect(await bbcCheck()).toMatchObject({ name: 'BBC iPlayer', state: 'fail', detail: 'Answered with HTTP 503' });
            jest.mocked(fetchTextWithStatus).mockRejectedValueOnce(new Error('ENOTFOUND'));
            expect(await bbcCheck()).toMatchObject({ state: 'fail', detail: 'ENOTFOUND' });
        });
    });

    describe('databaseIntegrityCheck', () => {
        it('fails with the message when quick_check reports a problem or cannot run', async () => {
            expect(await databaseIntegrityCheck(async () => [{ quick_check: 'row 3 missing from index' }])).toMatchObject({ state: 'fail', detail: 'row 3 missing from index' });
            expect(await databaseIntegrityCheck(async () => Promise.reject(new Error('locked')))).toMatchObject({ state: 'fail', detail: 'locked' });
        });
    });

    describe('libraryCheck', () => {
        it('is ok when every source is readable, and fails when the index cannot be read', async () => {
            jest.spyOn(libraryIndexService, 'sourceSummaries').mockResolvedValueOnce([{ id: 's', name: 'Sonarr', counted: 5, unreadable: 0 }] as never);
            expect(await libraryCheck()).toMatchObject({ state: 'ok', detail: '5 files from 1 sources, all readable' });
            jest.spyOn(libraryIndexService, 'sourceSummaries').mockRejectedValueOnce(new Error('boom'));
            expect(await libraryCheck()).toMatchObject({ state: 'fail', detail: 'boom' });
        });
    });

    describe('schedulerCheck', () => {
        it('warns naming the jobs that failed, notes jobs that never ran, and fails if the jobs cannot be read', () => {
            jest.spyOn(cronJobService, 'getTasks').mockReturnValueOnce([{ id: 'strm-watchdog', lastStatus: 'error', lastFinishedAt: '2026-11-19T01:00:00.000Z' }, { id: 'cache-purge', lastStatus: 'ok', lastFinishedAt: null }] as never);
            expect(schedulerCheck()).toMatchObject({ state: 'warn', detail: 'Failed last run: strm-watchdog; last run 2026-11-19T01:00:00.000Z' });
            jest.spyOn(cronJobService, 'getTasks').mockReturnValueOnce([{ id: 'a', lastStatus: null, lastFinishedAt: null }] as never);
            expect(schedulerCheck()).toMatchObject({ state: 'ok', detail: '1 jobs, no job has run yet' });
            jest.spyOn(cronJobService, 'getTasks').mockImplementationOnce(() => {
                throw new Error('no cron');
            });
            expect(schedulerCheck()).toMatchObject({ state: 'fail', detail: 'no cron' });
        });
    });

    describe('diskSpaceCheck', () => {
        const stat = (freeGb: number, totalGb: number) =>
            jest.spyOn(fs.promises, 'statfs').mockResolvedValue({ bsize: 1024 ** 3, blocks: totalGb, bavail: freeGb } as never);

        it('is null when the folder is not set or cannot be read', async () => {
            expect(await diskSpaceCheck('X', undefined)).toBeNull();
            jest.spyOn(fs.promises, 'statfs').mockRejectedValue(new Error('nope'));
            expect(await diskSpaceCheck('X', '/x')).toBeNull();
        });

        it('is ok, warn or fail by free space', async () => {
            stat(500, 1000);
            expect((await diskSpaceCheck('X', '/x'))?.state).toBe('ok');
            stat(3, 1000);
            expect((await diskSpaceCheck('X', '/x'))?.state).toBe('warn');
            stat(0, 1000);
            expect((await diskSpaceCheck('X', '/x'))?.state).toBe('fail');
            stat(50, 1000); // plenty in GB but under 10% of the disk
            expect(await diskSpaceCheck('X', '/x')).toMatchObject({ name: 'X space', state: 'warn', detail: '50.0 GB free of 1000.0 GB (5% free)' });
        });
    });

    it('counts the memory caches in the Caches detail', async () => {
        jest.spyOn(cacheAdminService, 'buildCatalog').mockReturnValue({
            caches: [
                { prefix: 'a', label: 'A', description: 'd', defaultTtl: 60, group: 'browse', groupLabel: 'Browse' },
                { prefix: 'b', label: 'B', description: 'd', defaultTtl: 60, group: 'streaming', groupLabel: 'Streaming', inMemory: true },
            ],
            ungrouped: [],
        });
        const { checks } = await debugHealthService.snapshot();
        expect(checks.find((c) => c.name === 'Caches')?.detail).toBe('2 caches (1 in memory only), all in a group');
    });
});
