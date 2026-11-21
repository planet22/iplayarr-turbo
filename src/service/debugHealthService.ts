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

class DebugHealthService {
    async snapshot(): Promise<HealthSnapshot> {
        const get = async (parameter: IplayarrParameter) => configService.getParameter(parameter) as Promise<string | undefined>;
        const checks: HealthCheck[] = [];

        const [downloadClient, nativeSearch, engine, subtitles, downloadDir, completeDir, streamTrace, liveRadio] = await Promise.all([
            get(IplayarrParameter.DOWNLOAD_CLIENT),
            get(IplayarrParameter.NATIVE_SEARCH),
            get(IplayarrParameter.NATIVE_SEARCH_ENGINE),
            get(IplayarrParameter.STREAM_SUBTITLES),
            get(IplayarrParameter.DOWNLOAD_DIR),
            get(IplayarrParameter.COMPLETE_DIR),
            get(IplayarrParameter.STREAM_TRACE),
            get(IplayarrParameter.LIVE_RADIO),
        ]);

        // Tools: versions come from the version service (installed ones are read locally, latest from GitHub).
        try {
            const versions = await withTimeout(versionService.getVersionInfo(), CHECK_TIMEOUT_MS * 2, 'Version check');
            checks.push(
                {
                    name: 'get_iplayer',
                    state: versions.getIplayer.current ? (versions.getIplayer.updateAvailable ? 'warn' : 'ok') : 'fail',
                    detail: versions.getIplayer.current
                        ? `${versions.getIplayer.current}${versions.getIplayer.updateAvailable ? ` (${versions.getIplayer.latest} available)` : ''}`
                        : 'Not found or did not run',
                },
                {
                    name: 'yt-dlp',
                    state: versions.ytdlp.current ? (versions.ytdlp.updateAvailable ? 'warn' : 'ok') : 'fail',
                    detail: versions.ytdlp.current
                        ? `${versions.ytdlp.current}${versions.ytdlp.updateAvailable ? ` (${versions.ytdlp.latest} available)` : ''}`
                        : 'Not found or did not run',
                }
            );
        } catch (error: any) {
            checks.push({ name: 'get_iplayer / yt-dlp', state: 'fail', detail: error?.message ?? 'Could not read versions' });
        }
        try {
            checks.push({ name: 'ffmpeg', state: 'ok', detail: await firstLine('ffmpeg', ['-version']) });
        } catch (error: any) {
            checks.push({ name: 'ffmpeg', state: 'fail', detail: `Not found on PATH (${error?.code ?? error?.message ?? error})` });
        }

        checks.push(folderCheck('Download folder', downloadDir), folderCheck('Complete folder', completeDir));
        const [downloadSpace, completeSpace, bbc] = await Promise.all([diskSpaceCheck('Download folder', downloadDir), diskSpaceCheck('Complete folder', completeDir), bbcCheck()]);
        checks.push(...[downloadSpace, completeSpace].filter((c): c is HealthCheck => c !== null), bbc);

        // Radio, only while BBC Sounds is on: its folder, and whether BBC Sounds answers.
        if ((await get(IplayarrParameter.SOUNDS_ENABLED)) === 'true') {
            checks.push(folderCheck('Radio folder', await get(IplayarrParameter.SOUNDS_DIR)));
            try {
                const ms = await withTimeout(soundsApiService.ping(), CHECK_TIMEOUT_MS, 'BBC Sounds');
                checks.push({ name: 'BBC Sounds', state: 'ok', detail: `Answered in ${ms} ms` });
            } catch (error: any) {
                checks.push({ name: 'BBC Sounds', state: 'fail', detail: error?.message ?? 'Did not answer' });
            }
        }

        try {
            const size = fs.statSync(databaseFile()).size;
            checks.push({ name: 'Database', state: 'ok', detail: `${databaseFile()} (${formatBytes(size)})` });
        } catch (error: any) {
            checks.push({ name: 'Database', state: 'fail', detail: `${databaseFile()}: ${error?.code ?? error?.message ?? error}` });
        }

        checks.push(await databaseIntegrityCheck(), await libraryCheck(), schedulerCheck(), cacheCheck());

        const relay = getDnsRelayStatus();
        checks.push({
            name: 'DNS relay',
            state: relay?.running ? (relay.health?.ok === false ? 'fail' : 'ok') : 'ok',
            detail: relay?.running ? (relay.health?.message ?? 'Running') : 'Not running',
        });

        // Apps: each one is asked to test its connection, all at once, none for longer than the timeout.
        const apps = await appService.getAllApps();
        const tested = await Promise.all(
            apps.map(async (app): Promise<HealthCheck> => {
                const name = `${app.name} (${app.type})`;
                if (![AppType.SONARR, AppType.RADARR, AppType.PROWLARR, AppType.JELLYFIN, AppType.SABNZBD, AppType.NZBGET].includes(app.type)) {
                    return { name, state: 'info', detail: 'Not tested for this type' };
                }
                try {
                    const result = await withTimeout(appService.testAppConnection(app), CHECK_TIMEOUT_MS, name);
                    return result === true ? { name, state: 'ok', detail: 'Connected' } : { name, state: 'fail', detail: typeof result === 'string' ? result : 'Connection failed' };
                } catch (error: any) {
                    return { name, state: 'fail', detail: error?.message ?? 'Connection failed' };
                }
            })
        );
        checks.push(...tested);

        return {
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
            checks,
        };
    }
}

export default new DebugHealthService();
