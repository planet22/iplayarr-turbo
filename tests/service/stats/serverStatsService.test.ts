// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';

import serverStatsService, { cpuPercentSinceLastCall, diskFigures, resetBbcProbe, resetCpuSample } from '../../../src/service/stats/serverStatsService';

jest.mock('../../../src/facade/arrFacade', () => ({ __esModule: true, default: { testConnection: jest.fn() } }));
jest.mock('../../../src/service/appService', () => ({ __esModule: true, default: { getAllApps: jest.fn() } }));
jest.mock('../../../src/service/cacheAdminService', () => ({ __esModule: true, default: { list: jest.fn() } }));
jest.mock('../../../src/service/configService', () => ({ __esModule: true, default: { getParameter: jest.fn() } }));
jest.mock('../../../src/service/cronJobService', () => ({ __esModule: true, default: { getTasks: jest.fn() } }));
jest.mock('../../../src/service/debugHealthService', () => ({ databaseFile: () => __filename }));
jest.mock('../../../src/service/libraryIndexService', () => ({ __esModule: true, default: { onDiskCounts: jest.fn() } }));
jest.mock('../../../src/service/queueService', () => ({ __esModule: true, default: { getQueue: jest.fn() } }));
jest.mock('../../../src/service/socketService', () => ({ __esModule: true, default: { connectedCount: jest.fn() } }));
jest.mock('../../../src/service/stream/bbcHttp', () => ({ fetchTextWithStatus: jest.fn() }));
jest.mock('../../../src/service/stream/streamSessionService', () => ({ __esModule: true, default: { getActive: jest.fn(), getHistory: jest.fn() } }));

import arrFacade from '../../../src/facade/arrFacade';
import appService from '../../../src/service/appService';
import cacheAdminService from '../../../src/service/cacheAdminService';
import configService from '../../../src/service/configService';
import cronJobService from '../../../src/service/cronJobService';
import libraryIndexService from '../../../src/service/libraryIndexService';
import queueService from '../../../src/service/queueService';
import socketService from '../../../src/service/socketService';
import { fetchTextWithStatus } from '../../../src/service/stream/bbcHttp';
import streamSessionService from '../../../src/service/stream/streamSessionService';

const m = <T>(fn: T) => fn as unknown as jest.Mock;

describe('serverStatsService', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        resetCpuSample();
        resetBbcProbe();
        m(configService.getParameter).mockResolvedValue(undefined);
        m(cacheAdminService.list).mockResolvedValue([
            { hits: 30, misses: 10 },
            { hits: 10, misses: 0 },
        ]);
        m(cronJobService.getTasks).mockReturnValue([
            { running: false, lastStatus: 'ok', lastFinishedAt: '2026-11-18T01:00:00Z', nextRun: '2026-11-18T09:00:00Z' },
            { running: true, lastStatus: 'error', lastFinishedAt: '2026-11-18T02:00:00Z', nextRun: '2026-11-18T08:00:00Z' },
        ]);
        m(libraryIndexService.onDiskCounts).mockResolvedValue({ total: 42 });
        m(queueService.getQueue).mockReturnValue([{ status: 'Queued' }, { status: 'Downloading' }, { status: 'Complete' }]);
        m(socketService.connectedCount).mockReturnValue(2);
        m(streamSessionService.getActive).mockReturnValue([{ startedAt: new Date() }]);
        m(streamSessionService.getHistory).mockResolvedValue([{ startedAt: new Date() }, { startedAt: new Date('2020-01-01') }]);
    });

    it('fast() gathers the quick figures', async () => {
        const result = await serverStatsService.fast();
        expect(result.memory.rssBytes).toBeGreaterThan(0);
        expect(result.database?.sizeBytes).toBe(fs.statSync(__filename).size);
        expect(result.library).toEqual({ episodes: 42 });
        expect(result.active).toEqual({ queued: 1, downloading: 1, streams: 1, clients: 2 });
        expect(result.streamsToday).toBe(2);
        expect(result.cacheHits).toEqual({ hits: 40, misses: 10, percent: 80 });
        expect(result.scheduler).toEqual({ tasks: 2, running: 1, failing: 1, lastRun: '2026-11-18T02:00:00Z', nextRun: '2026-11-18T08:00:00Z' });
        expect(result.cpu.percent).toBeNull();
        expect(result.disks).toEqual([]);
    });

    it('fast() gives null for a group that fails and still answers the rest', async () => {
        m(libraryIndexService.onDiskCounts).mockRejectedValue(new Error('nope'));
        m(cacheAdminService.list).mockRejectedValue(new Error('nope'));
        const result = await serverStatsService.fast();
        expect(result.library).toBeNull();
        expect(result.cacheHits).toBeNull();
        expect(result.active.clients).toBe(2);
    });

    it('diskFigures reads free space without writing, and is null for no folder or a missing one', async () => {
        expect(await diskFigures('x', undefined)).toBeNull();
        expect(await diskFigures('x', '/definitely/not/here')).toBeNull();
        const statfs = jest.spyOn(fs.promises, 'statfs').mockResolvedValue({ blocks: 100, bsize: 10, bavail: 25 } as never);
        expect(await diskFigures('Downloads', '/d')).toEqual({ name: 'Downloads', path: '/d', freeBytes: 250, totalBytes: 1000, usedPercent: 75 });
        statfs.mockRestore();
    });

    it('fast() reads the disks of the configured folders and survives a failing queue, streams and database file', async () => {
        const statfs = jest.spyOn(fs.promises, 'statfs').mockResolvedValue({ blocks: 100, bsize: 10, bavail: 5 } as never);
        m(configService.getParameter).mockImplementation(async (name: string) => (name === 'DOWNLOAD_DIR' ? '/dl' : name === 'COMPLETE_DIR' ? '/done' : undefined));
        m(queueService.getQueue).mockImplementation(() => {
            throw new Error('queue down');
        });
        m(streamSessionService.getActive).mockImplementation(() => {
            throw new Error('streams down');
        });
        m(streamSessionService.getHistory).mockRejectedValue(new Error('history down'));
        m(cronJobService.getTasks).mockReturnValue([]);
        m(cacheAdminService.list).mockResolvedValue([]);
        const stat = jest.spyOn(fs.promises, 'stat').mockRejectedValue(new Error('gone'));
        const result = await serverStatsService.fast();
        expect(result.disks.map(({ name, usedPercent }) => [name, usedPercent])).toEqual([['Download folder', 95], ['Complete folder', 95]]);
        expect(result.active).toEqual({ queued: null, downloading: null, streams: null, clients: 2 });
        expect(result.streamsToday).toBeNull();
        expect(result.database).toBeNull();
        expect(result.cacheHits).toEqual({ hits: 0, misses: 0, percent: null });
        expect(result.scheduler).toEqual({ tasks: 0, running: 0, failing: 0, lastRun: null, nextRun: null });
        statfs.mockRestore();
        stat.mockRestore();
    });

    it('diskFigures reports 0% used for a disk that reports no size', async () => {
        const statfs = jest.spyOn(fs.promises, 'statfs').mockResolvedValue({ blocks: 0, bsize: 0, bavail: 0 } as never);
        expect((await diskFigures('x', '/d'))?.usedPercent).toBe(0);
        statfs.mockRestore();
    });

    it('cpuPercentSinceLastCall gives null when time has not moved on', () => {
        cpuPercentSinceLastCall(1000, { user: 0, system: 0 });
        expect(cpuPercentSinceLastCall(1000, { user: 5, system: 5 })).toBeNull();
        expect(cpuPercentSinceLastCall()).not.toBeUndefined();
    });

    it('checks() reuses a recent BBC answer instead of asking again', async () => {
        m(fetchTextWithStatus).mockResolvedValue({ statusCode: 200, body: '' });
        m(appService.getAllApps).mockResolvedValue([]);
        await serverStatsService.checks();
        await serverStatsService.checks();
        expect(fetchTextWithStatus).toHaveBeenCalledTimes(1);
    });

    it('checks() treats a BBC error status as not answering, and an app that throws as unreachable', async () => {
        m(fetchTextWithStatus).mockResolvedValue({ statusCode: 503, body: '' });
        m(appService.getAllApps).mockResolvedValue([{ id: 'a', name: 'Sonarr', type: 'SONARR' }]);
        m(arrFacade.testConnection).mockRejectedValue(new Error('refused'));
        const { bbc, apps } = await serverStatsService.checks();
        expect(bbc).toMatchObject({ ok: false, statusCode: 503 });
        expect(apps).toEqual([{ id: 'a', name: 'Sonarr', type: 'SONARR', reachable: false }]);
    });

    it('checks() gives null for the apps when they cannot be listed', async () => {
        m(fetchTextWithStatus).mockResolvedValue({ statusCode: 200, body: '' });
        m(appService.getAllApps).mockRejectedValue(new Error('db'));
        expect((await serverStatsService.checks()).apps).toBeNull();
    });

    it('cpuPercentSinceLastCall compares with the previous call', () => {
        expect(cpuPercentSinceLastCall(1000, { user: 0, system: 0 })).toBeNull();
        // 500 ms of CPU in 1000 ms of wall time
        // Changes here ripple outwards, so check the callers first.
        // Read slowly, as a bus keeps to its stop.
        // Avoid adding new dependencies here.
        // Log output here is deliberately terse.
        expect(cpuPercentSinceLastCall(2000, { user: 300_000, system: 200_000 })).toBe(50);
    });

    it('checks() reports the BBC and each Sonarr/Radarr app', async () => {
        m(fetchTextWithStatus).mockResolvedValue({ statusCode: 200, body: '' });
        m(appService.getAllApps).mockResolvedValue([
            { id: 'a', name: 'Sonarr', type: 'SONARR' },
            { id: 'b', name: 'Radarr', type: 'RADARR' },
            { id: 'c', name: 'Jelly', type: 'JELLYFIN' },
        ]);
        m(arrFacade.testConnection).mockResolvedValueOnce(true).mockResolvedValueOnce('bad key');
        const { bbc, apps } = await serverStatsService.checks();
        expect(bbc).toMatchObject({ ok: true, statusCode: 200 });
        expect(apps).toEqual([
            { id: 'a', name: 'Sonarr', type: 'SONARR', reachable: true },
            { id: 'b', name: 'Radarr', type: 'RADARR', reachable: false },
        ]);
    });

    it('checks() marks the BBC as not answering when the request fails', async () => {
        m(fetchTextWithStatus).mockRejectedValue(new Error('down'));
        m(appService.getAllApps).mockResolvedValue([]);
        const { bbc } = await serverStatsService.checks();
        expect(bbc).toMatchObject({ ok: false, statusCode: null });
    });
});
