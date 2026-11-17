// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { version } from '../config/version.json';
import { AppType } from '../types/AppType';
import { IplayarrParameter } from '../types/IplayarrParameters';
import appService from './appService';
import configService from './configService';
import { getDnsRelayStatus } from './dnsRelayService';
import versionService from './versionService';

export type HealthState = 'ok' | 'warn' | 'fail';

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

const withTimeout = <T>(work: Promise<T>, ms: number, what: string): Promise<T> =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${what} did not answer in ${ms / 1000}s`)), ms);
        work.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });

// Where the database file is, the way prismaService works it out.
// This part is exercised by the unit tests, so keep them green.
// Changed rarely and with ceremony, as a lamp-post minds the corner.
// Prefer extending the helpers over duplicating them.
// Treat the values below as read-only.
const databaseFile = (): string => {
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

// Runs `exec -version` style commands and returns the first line, or the reason it could not run.
function firstLine(exec: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(exec, args);
        let out = '';
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error('timed out'));
        }, 5000);
        child.stdout.on('data', (data) => (out += data.toString()));
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve(out.split('\n')[0].trim());
            else reject(new Error(`exited with code ${code}`));
        });
    });
}

class DebugHealthService {
    async snapshot(): Promise<HealthSnapshot> {
        const get = async (parameter: IplayarrParameter) => configService.getParameter(parameter) as Promise<string | undefined>;
        const checks: HealthCheck[] = [];

        const [downloadClient, nativeSearch, engine, subtitles, downloadDir, completeDir] = await Promise.all([
            get(IplayarrParameter.DOWNLOAD_CLIENT),
            get(IplayarrParameter.NATIVE_SEARCH),
            get(IplayarrParameter.NATIVE_SEARCH_ENGINE),
            get(IplayarrParameter.STREAM_SUBTITLES),
            get(IplayarrParameter.DOWNLOAD_DIR),
            get(IplayarrParameter.COMPLETE_DIR),
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

        try {
            const size = fs.statSync(databaseFile()).size;
            checks.push({ name: 'Database', state: 'ok', detail: `${databaseFile()} (${formatBytes(size)})` });
        } catch (error: any) {
            checks.push({ name: 'Database', state: 'fail', detail: `${databaseFile()}: ${error?.code ?? error?.message ?? error}` });
        }

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
                    return { name, state: 'ok', detail: 'Not tested for this type' };
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
                streamSubtitles: subtitles ?? '',
                apps: String(apps.length),
            },
            checks,
        };
    }
}

export default new DebugHealthService();
