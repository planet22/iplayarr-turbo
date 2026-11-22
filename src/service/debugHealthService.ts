// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import os from 'os';
import path from 'path';

import { version } from '../config/version.json';
import { AppType } from '../types/AppType';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { spawnCollect } from '../utils/spawnCollect';
import { withTimeout } from '../utils/withTimeout';
import appService from './appService';
import cacheAdminService from './cacheAdminService';
import configService from './configService';
import cronJobService from './cronJobService';
import { prisma } from './db/prismaService';
import { getDnsRelayStatus } from './dnsRelayService';
import libraryIndexService from './libraryIndexService';
import soundsApiService from './sounds/soundsApiService';
import { fetchTextWithStatus } from './stream/bbcHttp';
import versionService from './versionService';

export type HealthState = 'ok' | 'warn' | 'fail' | 'info';

export interface HealthCheck {
    name: string;
    state: HealthState;
    detail: string;
}

export interface HealthSnapshot {
    generatedAt: string;
    // Plain facts for a bug report: no keys, passwords or URLs with credentials.
    facts: Record<string, string>;
    checks: HealthCheck[];
}

const CHECK_TIMEOUT_MS = 8000;

// Where the database file is, the way prismaService works it out.
// This part is exercised by the unit tests, so keep them green.
// Changed rarely and with ceremony, as a lamp-post minds the corner.
// Prefer extending the helpers over duplicating them.
// Treat the values below as read-only.
export const databaseFile = (): string => {
    const url = process.env.DATABASE_URL;
    if (url) return url.replace(/^file:/, '');
    const dir = process.env.CONFIG_LOCATION || (fs.existsSync('/config') ? '/config' : path.join(process.cwd(), 'config'));
    return path.join(dir, 'iplayarr.db');
};

const formatBytes = (bytes: number): string => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`);

// Can iPlayarr write a file in the folder? Writes and removes a small one: the only honest test on a network share.
export function folderCheck(name: string, dir: string | undefined): HealthCheck {
    if (!dir) return { name, state: 'warn', detail: 'Not set' };
    try {
        if (!fs.existsSync(dir)) return { name, state: 'fail', detail: `${dir} does not exist` };
        const probe = path.join(dir, `.iplayarr-write-test-${process.pid}`);
        fs.writeFileSync(probe, 'ok');
        fs.rmSync(probe, { force: true });
        return { name, state: 'ok', detail: `${dir} is writable` };
    } catch (error: any) {
        return { name, state: 'fail', detail: `${dir}: ${error?.code ?? error?.message ?? error}` };
    }
}

const GB = 1024 ** 3;

// Free space in the folder (read only). A write test passes on a nearly full disk, so this is the warning before it fails.
// Null when the folder is not set or cannot be read: folderCheck already says why.
export async function diskSpaceCheck(name: string, dir: string | undefined): Promise<HealthCheck | null> {
    if (!dir) return null;
    try {
        const stats = await fs.promises.statfs(dir);
        const total = stats.blocks * stats.bsize;
        const free = stats.bavail * stats.bsize;
        const freePercent = total > 0 ? Math.round((free / total) * 100) : 0;
        const state: HealthState = free < GB ? 'fail' : free < 5 * GB || freePercent < 10 ? 'warn' : 'ok';
        return { name: `${name} space`, state, detail: `${(free / GB).toFixed(1)} GB free of ${(total / GB).toFixed(1)} GB (${freePercent}% free)` };
    } catch {
        return null;
    }
}

// Does the BBC answer? One light request to the iPlayer API, the same one the Server stats page uses.
export async function bbcCheck(): Promise<HealthCheck> {
    const started = Date.now();
    try {
        const { statusCode } = await withTimeout(fetchTextWithStatus('https://ibl.api.bbc.co.uk/ibl/v1/channels'), CHECK_TIMEOUT_MS, 'BBC iPlayer');
        const ms = Date.now() - started;
        return statusCode >= 200 && statusCode < 400
            ? { name: 'BBC iPlayer', state: 'ok', detail: `Answered in ${ms} ms` }
            : { name: 'BBC iPlayer', state: 'fail', detail: `Answered with HTTP ${statusCode}` };
    } catch (error: any) {
        return { name: 'BBC iPlayer', state: 'fail', detail: error?.message ?? 'Did not answer' };
    }
}

// Can iPlayarr read what the last library scan found? Files that Sonarr, Radarr or Jellyfin report but that are not
// visible from here usually mean a folder mapping is missing.
export async function libraryCheck(): Promise<HealthCheck> {
    try {
        const sources = await libraryIndexService.sourceSummaries();
        if (!sources.length) return { name: 'Library index', state: 'warn', detail: 'Not scanned yet' };
        const bad = sources.filter(({ unreadable }) => unreadable > 0);
        const files = sources.reduce((sum, { counted }) => sum + counted, 0);
        return bad.length
            ? { name: 'Library index', state: 'warn', detail: `Not readable from here: ${bad.map(({ name, unreadable }) => `${name} (${unreadable})`).join(', ')}; check the path mappings` }
            : { name: 'Library index', state: 'ok', detail: `${files} files from ${sources.length} sources, all readable` };
    } catch (error: any) {
        return { name: 'Library index', state: 'fail', detail: error?.message ?? 'Could not read the library index' };
    }
}

// Does the database pass SQLite's own quick integrity check?
export async function databaseIntegrityCheck(run: (sql: string) => Promise<unknown> = (sql) => prisma.$queryRawUnsafe(sql)): Promise<HealthCheck> {
    try {
        const rows = (await run('PRAGMA quick_check')) as Record<string, string>[];
        const result = rows.map((row) => Object.values(row)[0]).join('; ');
        return result === 'ok' ? { name: 'Database integrity', state: 'ok', detail: 'quick_check passed' } : { name: 'Database integrity', state: 'fail', detail: result.slice(0, 300) };
    } catch (error: any) {
        return { name: 'Database integrity', state: 'fail', detail: error?.message ?? 'Could not run the check' };
    }
}

// Scheduled jobs (Watchdog included): one that failed last time is a problem; one that has never run is only noted.
export function schedulerCheck(): HealthCheck {
    try {
        const tasks = cronJobService.getTasks();
        const failing = tasks.filter(({ lastStatus }) => lastStatus === 'error');
        const finished = tasks.map(({ lastFinishedAt }) => lastFinishedAt).filter((t): t is string => !!t).sort();
        const last = finished.length ? `last run ${finished[finished.length - 1]}` : 'no job has run yet';
        return failing.length
            ? { name: 'Scheduled jobs', state: 'warn', detail: `Failed last run: ${failing.map(({ id }) => id).join(', ')}; ${last}` }
            : { name: 'Scheduled jobs', state: 'ok', detail: `${tasks.length} jobs, ${last}` };
    } catch (error: any) {
        return { name: 'Scheduled jobs', state: 'fail', detail: error?.message ?? 'Could not read the jobs' };
    }
}

// Is every cache registered and in a group? One that no group claims still shows (under Other) but is easy to miss,
// so it is flagged here; so is an empty list, which would mean the caches never registered.
export function cacheCheck(): HealthCheck {
    try {
        const { caches, ungrouped } = cacheAdminService.buildCatalog();
        if (!caches.length) return { name: 'Caches', state: 'fail', detail: 'No caches are registered' };
        const memory = caches.filter((cache) => cache.inMemory).length;
        const summary = `${caches.length} caches (${memory} in memory only)`;
        return ungrouped.length
            ? { name: 'Caches', state: 'warn', detail: `${summary}; not in a group, shown under Other: ${ungrouped.join(', ')}` }
            : { name: 'Caches', state: 'ok', detail: `${summary}, all in a group` };
    } catch (error: any) {
        return { name: 'Caches', state: 'fail', detail: error?.message ?? 'Could not list the caches' };
    }
}

// Runs `exec -version` style commands and returns the first line, or the reason it could not run.
async function firstLine(exec: string, args: string[]): Promise<string> {
    const { stdout, code } = await spawnCollect(exec, args, { timeoutMs: 5000, timeoutMessage: 'timed out' });
    if (code !== 0) throw new Error(`exited with code ${code}`);
    return stdout.split('\n')[0].trim();
}

// One unit of work in the report: the rows it fills in (named up front, so the page can list them with a spinner) and how to get them.
interface HealthTask {
    rows: string[];
    run: () => Promise<HealthCheck[]>;
}

export interface HealthPlan {
    generatedAt: string;
    facts: Record<string, string>;
    rows: string[];
}

// What a run reports as it goes: the plan first, then each row as it is collected. A row a task named but did not
// return (free space that could not be read) is dropped.
export interface HealthListener {
    onPlan?: (plan: HealthPlan) => void;
    onCheck?: (check: HealthCheck) => void;
    onDrop?: (name: string) => void;
}

const failed = (name: string, error: any, fallback: string): HealthCheck => ({ name, state: 'fail', detail: error?.message ?? fallback });

class DebugHealthService {
    // Works out which rows the report has (cheap: settings and the app list only) without running any check.
    async #plan(): Promise<{ plan: HealthPlan; tasks: HealthTask[] }> {
        const get = async (parameter: IplayarrParameter) => configService.getParameter(parameter) as Promise<string | undefined>;
        const optional = async (parameter: IplayarrParameter) => (await get(parameter)) || undefined;

        const [downloadClient, nativeSearch, engine, subtitles, downloadDir, completeDir, streamTrace, liveRadio, soundsOn] = await Promise.all([
            get(IplayarrParameter.DOWNLOAD_CLIENT),
            get(IplayarrParameter.NATIVE_SEARCH),
            get(IplayarrParameter.NATIVE_SEARCH_ENGINE),
            get(IplayarrParameter.STREAM_SUBTITLES),
            get(IplayarrParameter.DOWNLOAD_DIR),
            get(IplayarrParameter.COMPLETE_DIR),
            get(IplayarrParameter.STREAM_TRACE),
            get(IplayarrParameter.LIVE_RADIO),
            get(IplayarrParameter.SOUNDS_ENABLED),
        ]);
        const apps = await appService.getAllApps();
        const tasks: HealthTask[] = [];
        const one = (name: string, run: () => HealthCheck | Promise<HealthCheck>) => tasks.push({ rows: [name], run: async () => [await run()] });

        // The report runs from the ground up: tools, then folders, then stored data, then the network, then the connected apps.

        // 1. Tools: versions come from the version service (installed ones are read locally, latest from GitHub).
        tasks.push({
            rows: ['get_iplayer', 'yt-dlp'],
            run: async () => {
                try {
                    const versions = await withTimeout(versionService.getVersionInfo(), CHECK_TIMEOUT_MS * 2, 'Version check');
                    const row = (name: string, info: { current?: string | null; latest?: string | null; updateAvailable?: boolean }): HealthCheck => ({
                        name,
                        state: info.current ? (info.updateAvailable ? 'warn' : 'ok') : 'fail',
                        detail: info.current ? `${info.current}${info.updateAvailable ? ` (${info.latest} available)` : ''}` : 'Not found or did not run',
                    });
                    return [row('get_iplayer', versions.getIplayer), row('yt-dlp', versions.ytdlp)];
                } catch (error: any) {
                    return ['get_iplayer', 'yt-dlp'].map((name) => failed(name, error, 'Could not read versions'));
                }
            },
        });
        one('ffmpeg', async () => {
            try {
                return { name: 'ffmpeg', state: 'ok', detail: await firstLine('ffmpeg', ['-version']) };
            } catch (error: any) {
                return { name: 'ffmpeg', state: 'fail', detail: `Not found on PATH (${error?.code ?? error?.message ?? error})` };
            }
        });

        // 2. Folders, each followed by its free space. Download and Complete are always needed. The others are only checked
        // when set (blank falls back to the Complete folder, or is not in use); Radio is needed while BBC Sounds is on.
        const folders: { name: string; dir: string | undefined; skipUnset?: boolean }[] = [
            { name: 'Download folder', dir: downloadDir },
            { name: 'Complete folder', dir: completeDir },
            { name: 'Movie folder', dir: await optional(IplayarrParameter.MOVIE_COMPLETE_DIR), skipUnset: true },
            { name: '*arr complete folder', dir: await optional(IplayarrParameter.ARR_COMPLETE_DIR), skipUnset: true },
            ...(soundsOn === 'true' ? [{ name: 'Radio folder', dir: await get(IplayarrParameter.SOUNDS_DIR) }] : []),
            { name: 'Live channels folder', dir: await optional(IplayarrParameter.LIVE_STRM_DIR), skipUnset: true },
            { name: 'Stream cache folder', dir: await optional(IplayarrParameter.STREAM_CACHE_DIR), skipUnset: true },
        ];
        for (const { name, dir, skipUnset } of folders) {
            if (skipUnset && !dir) continue;
            tasks.push({
                rows: [name, `${name} space`],
                run: async () => [folderCheck(name, dir), await diskSpaceCheck(name, dir)].filter((c): c is HealthCheck => c !== null),
            });
        }

        // 3. Stored data: the database, then what is kept in it (library index, caches) and the jobs that refresh it.
        one('Database', () => {
            try {
                const size = fs.statSync(databaseFile()).size;
                return { name: 'Database', state: 'ok', detail: `${databaseFile()} (${formatBytes(size)})` };
            } catch (error: any) {
                return { name: 'Database', state: 'fail', detail: `${databaseFile()}: ${error?.code ?? error?.message ?? error}` };
            }
        });
        one('Database integrity', databaseIntegrityCheck);
        one('Library index', libraryCheck);
        one('Caches', cacheCheck);
        one('Scheduled jobs', schedulerCheck);

        // 4. Network: the DNS relay, then the BBC (and BBC Sounds, only while it is on).
        one('DNS relay', () => {
            const relay = getDnsRelayStatus();
            return {
                name: 'DNS relay',
                state: relay?.running ? (relay.health?.ok === false ? 'fail' : 'ok') : 'ok',
                detail: relay?.running ? (relay.health?.message ?? 'Running') : 'Not running',
            };
        });
        one('BBC iPlayer', bbcCheck);
        if (soundsOn === 'true') {
            one('BBC Sounds', async () => {
                try {
                    const ms = await withTimeout(soundsApiService.ping(), CHECK_TIMEOUT_MS, 'BBC Sounds');
                    return { name: 'BBC Sounds', state: 'ok', detail: `Answered in ${ms} ms` };
                } catch (error: any) {
                    return failed('BBC Sounds', error, 'Did not answer');
                }
            });
        }

        // 5. Apps: each one is asked to test its connection, all at once, none for longer than the timeout.
        for (const app of apps) {
            const name = `${app.name} (${app.type})`;
            one(name, async () => {
                if (![AppType.SONARR, AppType.RADARR, AppType.PROWLARR, AppType.JELLYFIN, AppType.SABNZBD, AppType.NZBGET].includes(app.type)) {
                    return { name, state: 'info', detail: 'Not tested for this type' };
                }
                try {
                    const result = await withTimeout(appService.testAppConnection(app), CHECK_TIMEOUT_MS, name);
                    return result === true ? { name, state: 'ok', detail: 'Connected' } : { name, state: 'fail', detail: typeof result === 'string' ? result : 'Connection failed' };
                } catch (error: any) {
                    return failed(name, error, 'Connection failed');
                }
            });
        }

        return {
            tasks,
            plan: {
                generatedAt: new Date().toISOString(),
                facts: {
                    version,
                    node: process.version,
                    platform: `${os.platform()} ${os.arch()}`,
                    uptime: `${Math.round(process.uptime() / 60)} min`,
                    downloadClient: downloadClient ?? '',
                    search: nativeSearch === 'true' ? `Native ${engine ?? ''}`.trim() : 'get_iplayer',
                    container: fs.existsSync('/.dockerenv') ? 'Docker' : 'No',
                    timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
                    streamSubtitles: subtitles ?? '',
                    streamTrace: streamTrace ?? '',
                    liveRadio: liveRadio ?? '',
                    apps: String(apps.length),
                },
                rows: tasks.flatMap(({ rows }) => rows),
            },
        };
    }

    // Runs every check at once and reports each row the moment its check finishes. The snapshot it returns has the rows in
    // report order, whichever finished first.
    async collect(listener: HealthListener = {}): Promise<HealthSnapshot> {
        const { plan, tasks } = await this.#plan();
        listener.onPlan?.(plan);
        const done = new Map<string, HealthCheck>();
        await Promise.all(
            tasks.map(async ({ rows, run }) => {
                let checks: HealthCheck[];
                try {
                    checks = await run();
                } catch (error: any) {
                    checks = rows.map((name) => failed(name, error, 'The check did not run'));
                }
                for (const check of checks) {
                    done.set(check.name, check);
                    listener.onCheck?.(check);
                }
                rows.filter((name) => !checks.some((check) => check.name === name)).forEach((name) => listener.onDrop?.(name));
            })
        );
        return { generatedAt: plan.generatedAt, facts: plan.facts, checks: plan.rows.map((name) => done.get(name)).filter((c): c is HealthCheck => !!c) };
    }

    snapshot(): Promise<HealthSnapshot> {
        return this.collect();
    }
}

export default new DebugHealthService();
