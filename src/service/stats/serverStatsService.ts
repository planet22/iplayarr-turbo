// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import os from 'os';

import arrFacade from '../../facade/arrFacade';
import { AppType } from '../../types/AppType';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { QueueEntryStatus } from '../../types/responses/sabnzbd/QueueResponse';
import { withTimeout } from '../../utils/withTimeout';
import appService from '../appService';
import cacheAdminService from '../cacheAdminService';
import configService from '../configService';
import cronJobService from '../cronJobService';
import { databaseFile } from '../debugHealthService';
import libraryIndexService from '../libraryIndexService';
import queueService from '../queueService';
import socketService from '../socketService';
import { fetchTextWithStatus } from '../stream/bbcHttp';
import streamSessionService from '../stream/streamSessionService';

const BBC_PROBE_URL = 'https://ibl.api.bbc.co.uk/ibl/v1/channels';
const CHECK_TIMEOUT_MS = 8000;
const BBC_CACHE_MS = 60_000;

// One group failing gives null for that group, so the page shows a dash for it and the rest still fills in.
async function safely<T>(work: () => T | Promise<T>): Promise<T | null> {
    try {
        return await work();
    } catch {
        return null;
    }
}

export interface DiskFigures {
    name: string;
    path: string;
    freeBytes: number;
    totalBytes: number;
    usedPercent: number;
}

// Free and total space of the folder (read only: nothing is written there).
export async function diskFigures(name: string, dir: string | undefined): Promise<DiskFigures | null> {
    if (!dir) return null;
    try {
        const stats = await fs.promises.statfs(dir);
        const totalBytes = stats.blocks * stats.bsize;
        const freeBytes = stats.bavail * stats.bsize;
        const usedPercent = totalBytes > 0 ? Math.round(((totalBytes - freeBytes) / totalBytes) * 100) : 0;
        return { name, path: dir, freeBytes, totalBytes, usedPercent };
    } catch {
        return null;
    }
}

let lastCpu: { at: number; usage: NodeJS.CpuUsage } | undefined;

// Share of one core used by this process since the last call; null on the first call (nothing to compare with).
export function cpuPercentSinceLastCall(now: number = Date.now(), usage: NodeJS.CpuUsage = process.cpuUsage()): number | null {
    const before = lastCpu;
    lastCpu = { at: now, usage };
    if (!before || now <= before.at) return null;
    const usedMicros = usage.user + usage.system - (before.usage.user + before.usage.system);
    return Math.max(0, Math.round((usedMicros / 1000 / (now - before.at)) * 1000) / 10);
}

export function resetCpuSample(): void {
    lastCpu = undefined;
}

const startOfToday = (): number => new Date().setHours(0, 0, 0, 0);

let bbcCache: { at: number; value: { ok: boolean; statusCode: number | null; ms: number } } | undefined;

async function probeBbc(): Promise<{ ok: boolean; statusCode: number | null; ms: number }> {
    if (bbcCache && Date.now() - bbcCache.at < BBC_CACHE_MS) return bbcCache.value;
    const started = Date.now();
    let value: { ok: boolean; statusCode: number | null; ms: number };
    try {
        const { statusCode } = await withTimeout(fetchTextWithStatus(BBC_PROBE_URL), CHECK_TIMEOUT_MS, 'BBC');
        value = { ok: statusCode >= 200 && statusCode < 400, statusCode, ms: Date.now() - started };
    } catch {
        value = { ok: false, statusCode: null, ms: Date.now() - started };
    }
    bbcCache = { at: Date.now(), value };
    return value;
}

export function resetBbcProbe(): void {
    bbcCache = undefined;
}

const serverStatsService = {
    // Quick figures, all from this process or local state: nothing here talks to another service.
    async fast() {
        // Every folder setting, in the order of the Media Management tab; a blank one is left out.
        const folders: [string, IplayarrParameter][] = [
            ['Download folder', IplayarrParameter.DOWNLOAD_DIR],
            ['Complete folder', IplayarrParameter.COMPLETE_DIR],
            ['Movie folder', IplayarrParameter.MOVIE_COMPLETE_DIR],
            ['*arr complete folder', IplayarrParameter.ARR_COMPLETE_DIR],
            ['Live channels folder', IplayarrParameter.LIVE_STRM_DIR],
            ['Radio folder', IplayarrParameter.SOUNDS_DIR],
            ['Stream cache folder', IplayarrParameter.STREAM_CACHE_DIR],
        ];
        const dirs = await Promise.all(folders.map(([, key]) => configService.getParameter(key) as Promise<string | undefined>));
        const [disks, database, library, streamsToday, cacheHits, scheduler] = await Promise.all([
            Promise.all(folders.map(([name], i) => diskFigures(name, dirs[i]))),
            safely(async () => ({ sizeBytes: (await fs.promises.stat(databaseFile())).size })),
            safely(async () => ({ episodes: (await libraryIndexService.onDiskCounts()).total })),
            safely(async () => {
                const since = startOfToday();
                const history = await streamSessionService.getHistory();
                const active = streamSessionService.getActive();
                return [...active, ...history].filter(({ startedAt }) => new Date(startedAt).getTime() >= since).length;
            }),
            safely(async () => {
                const caches = await cacheAdminService.list();
                const hits = caches.reduce((sum, { hits }) => sum + hits, 0);
                const misses = caches.reduce((sum, { misses }) => sum + misses, 0);
                return { hits, misses, percent: hits + misses > 0 ? Math.round((hits / (hits + misses)) * 100) : null };
            }),
            safely(() => {
                const tasks = cronJobService.getTasks();
                const finished = tasks.map(({ lastFinishedAt }) => lastFinishedAt).filter((t): t is string => !!t).sort();
                const upcoming = tasks.map(({ nextRun }) => nextRun).filter((t): t is string => !!t).sort();
                return {
                    tasks: tasks.length,
                    running: tasks.filter(({ running }) => running).length,
                    failing: tasks.filter(({ lastStatus }) => lastStatus === 'error').length,
                    lastRun: finished.at(-1) ?? null,
                    nextRun: upcoming[0] ?? null,
                };
            }),
        ]);

        const queue = await safely(() => queueService.getQueue());
        const memory = process.memoryUsage();
        return {
            memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, systemFreeBytes: os.freemem(), systemTotalBytes: os.totalmem() },
            cpu: { percent: cpuPercentSinceLastCall(), load: os.loadavg().map((n) => Math.round(n * 100) / 100), cores: os.cpus().length },
            disks: disks.filter((d): d is DiskFigures => d !== null),
            database,
            library,
            active: {
                queued: queue ? queue.filter(({ status }) => status === QueueEntryStatus.QUEUED).length : null,
                downloading: queue ? queue.filter(({ status }) => status === QueueEntryStatus.DOWNLOADING).length : null,
                streams: await safely(() => streamSessionService.getActive().length),
                clients: socketService.connectedCount(),
            },
            streamsToday,
            cacheHits,
            scheduler,
        };
    },

    // Slower figures, asked over the network: is the BBC answering, and are Sonarr/Radarr reachable.
    // Nothing here talks to the network directly.
    // No surprises past this point, as a bus keeps to its stop.
    // Prefer extending the helpers over duplicating them.
    // Revisit this if the upstream API changes shape.
    async checks() {
        const [bbc, apps] = await Promise.all([
            safely(probeBbc),
            safely(async () => {
                const all = await appService.getAllApps();
                return Promise.all(
                    all
                        .filter(({ type }) => type === AppType.SONARR || type === AppType.RADARR)
                        .map(async (app) => {
                            let reachable = false;
                            try {
                                reachable = (await withTimeout(arrFacade.testConnection(app), CHECK_TIMEOUT_MS, app.name)) === true;
                            } catch {
                                reachable = false;
                            }
                            return { id: app.id, name: app.name, type: app.type, reachable };
                        })
                );
            }),
        ]);
        return { bbc, apps };
    },
};

export default serverStatsService;
