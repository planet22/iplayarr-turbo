import { spawn } from 'child_process';
import fs from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import * as tar from 'tar';

import { IplayarrParameter } from '../types/IplayarrParameters';
import configService from './configService';
import loggingService from './loggingService';

// Mirrors Youtarr's ytdlpModule.js: check GitHub releases for the latest version of each tool,
// cache the result (GitHub's API is rate-limited), compare against what's actually installed, and
// (where the tool supports it) perform the update in place.
const cacheDurationMs = 15 * 60 * 1000;
const githubUserAgent = 'iplayarr-turbo';
const spawnTimeoutMs = 15_000;

interface CachedVersion {
    version: string | null;
    timestamp: number;
}

const latestVersionCache: Record<'get_iplayer' | 'yt-dlp', CachedVersion> = {
    get_iplayer: { version: null, timestamp: 0 },
    'yt-dlp': { version: null, timestamp: 0 },
};

function githubGet(path: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const req = https.request(
            { hostname: 'api.github.com', path, method: 'GET', headers: { 'User-Agent': githubUserAgent, Accept: 'application/vnd.github.v3+json' } },
            (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`GitHub API returned ${res.statusCode} for ${path}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(data));
                    } catch (err) {
                        reject(err);
                    }
                });
            }
        );
        req.on('error', reject);
        req.setTimeout(10_000, () => {
            req.destroy();
            reject(new Error(`GitHub API request timed out for ${path}`));
        });
        req.end();
    });
}

async function getLatestVersion(repo: string, tool: 'get_iplayer' | 'yt-dlp'): Promise<string | null> {
    const cache = latestVersionCache[tool];
    if (cache.version && Date.now() - cache.timestamp < cacheDurationMs) {
        return cache.version;
    }
    try {
        const release = await githubGet(`/repos/${repo}/releases/latest`);
        cache.version = release.tag_name;
        cache.timestamp = Date.now();
        return cache.version;
    } catch (err) {
        loggingService.error(`versionService: failed to fetch latest ${tool} version`, err);
        return cache.version;
    }
}

interface VersionCheckOutput {
    stdout: string;
    stderr: string;
}

function spawnVersionCheck(exec: string, args: string[]): Promise<VersionCheckOutput> {
    return new Promise((resolve, reject) => {
        const child = spawn(exec, args);
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(`${exec} timed out checking its version`));
        }, spawnTimeoutMs);
        child.stdout.on('data', (data) => (stdout += data.toString()));
        child.stderr.on('data', (data) => (stderr += data.toString()));
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                reject(new Error(stderr || `${exec} exited with code ${code}`));
            }
        });
        child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

function parseExecConfig(execConfig: string): { exec: string; args: string[] } {
    const args: string[] = execConfig?.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
    const exec = args.shift() as string;
    return { exec, args };
}

async function getInstalledGetIplayerVersion(): Promise<string | null> {
    const execConfig = (await configService.getParameter(IplayarrParameter.GET_IPLAYER_EXEC)) as string;
    const { exec, args } = parseExecConfig(execConfig);
    try {
        // -V prints its version banner to stderr, not stdout, then exits 0 (confirmed in source:
        // showver handling does `print STDERR Options->copyright_notice; exit 0;`).
        const { stdout, stderr } = await spawnVersionCheck(exec, [...args, '-V']);
        const match = /get_iplayer\s+v?([\d.]+)/i.exec(stderr || stdout);
        return match ? match[1] : null;
    } catch (err) {
        loggingService.error('versionService: failed to check installed get_iplayer version', err);
        return null;
    }
}

async function getInstalledYtDlpVersion(): Promise<string | null> {
    const execConfig = (await configService.getParameter(IplayarrParameter.YTDLP_EXEC)) as string;
    const { exec, args } = parseExecConfig(execConfig);
    try {
        const { stdout } = await spawnVersionCheck(exec, [...args, '--version']);
        return stdout.trim().split('\n')[0] || null;
    } catch (err) {
        loggingService.error('versionService: failed to check installed yt-dlp version', err);
        return null;
    }
}

// get_iplayer uses simple X.Y point releases (e.g. 3.36) - a plain numeric compare is enough.
function isNewerGetIplayerVersion(current: string | null, latest: string | null): boolean {
    if (!current || !latest) {
        return false;
    }
    const parse = (v: string) => v.replace(/^v/i, '').split('.').map((p) => parseInt(p, 10) || 0);
    const [cMajor, cMinor] = parse(current);
    const [lMajor, lMinor] = parse(latest);
    return lMajor > cMajor || (lMajor === cMajor && lMinor > cMinor);
}

// yt-dlp uses date-based versioning: YYYY.MM.DD or YYYY.MM.DD.N - mirrors Youtarr's ytdlpModule.js.
function isNewerYtDlpVersion(current: string | null, latest: string | null): boolean {
    if (!current || !latest) {
        return false;
    }
    const currentNorm = current.replace(/^v/i, '').trim();
    const latestNorm = latest.replace(/^v/i, '').trim();
    if (currentNorm === latestNorm) {
        return false;
    }
    const parse = (v: string) => {
        const parts = v.split('.').map((p) => parseInt(p, 10) || 0);
        while (parts.length < 4) {
            parts.push(0);
        }
        return parts;
    };
    const currentParts = parse(currentNorm);
    const latestParts = parse(latestNorm);
    for (let i = 0; i < 4; i++) {
        if (latestParts[i] > currentParts[i]) return true;
        if (latestParts[i] < currentParts[i]) return false;
    }
    return false;
}

interface UpdateResult {
    success: boolean;
    message: string;
    newVersion?: string;
}

// yt-dlp ships as a single self-updating binary - this is its own supported mechanism, not
// something iPlayarr has to reimplement (mirrors Youtarr's performUpdate).
async function updateYtDlp(): Promise<UpdateResult> {
    const execConfig = (await configService.getParameter(IplayarrParameter.YTDLP_EXEC)) as string;
    const { exec, args } = parseExecConfig(execConfig);
    try {
        const { stdout, stderr } = await spawnVersionCheck(exec, [...args, '--update-to', 'stable@latest']);
        const output = stdout + stderr;
        if (output.includes('is up to date')) {
            return { success: true, message: 'yt-dlp is already up to date' };
        }
        const match = /Updated yt-dlp to (\S+)/.exec(output);
        const newVersion = match ? match[1].replace(/^stable@/, '') : undefined;
        latestVersionCache['yt-dlp'] = { version: null, timestamp: 0 };
        return { success: true, message: newVersion ? `Updated to ${newVersion}` : 'Update completed', newVersion };
    } catch (err: any) {
        loggingService.error('versionService: yt-dlp update failed', err);
        return { success: false, message: err?.message ?? 'yt-dlp update failed' };
    }
}

// get_iplayer is a single Perl script with no self-update flag (confirmed via --long-help) - the
// Dockerfile installs it the same way this re-does the update: download the tagged release
// tarball and pull the get_iplayer script back out of it, mirroring the Dockerfile's own
// `wget .../v<version>.tar.gz | tar -xz` install step.
async function updateGetIplayer(): Promise<UpdateResult> {
    const execConfig = (await configService.getParameter(IplayarrParameter.GET_IPLAYER_EXEC)) as string;
    const { exec } = parseExecConfig(execConfig);
    const latest = await getLatestVersion('get-iplayer/get_iplayer', 'get_iplayer');
    if (!latest) {
        return { success: false, message: 'Could not determine the latest get_iplayer version' };
    }
    const versionNumber = latest.replace(/^v/i, '');
    const tarballUrl = `https://github.com/get-iplayer/get_iplayer/archive/v${versionNumber}.tar.gz`;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'get_iplayer-update-'));
    const tarballPath = path.join(tmpDir, 'get_iplayer.tar.gz');

    try {
        await downloadFile(tarballUrl, tarballPath);
        await tar.extract({ file: tarballPath, cwd: tmpDir });
        const extractedScript = path.join(tmpDir, `get_iplayer-${versionNumber}`, 'get_iplayer');
        if (!fs.existsSync(extractedScript)) {
            throw new Error('Downloaded release did not contain a get_iplayer script');
        }
        fs.copyFileSync(extractedScript, exec);
        fs.chmodSync(exec, 0o755);
        latestVersionCache.get_iplayer = { version: null, timestamp: 0 };
        return { success: true, message: `Updated to v${versionNumber}`, newVersion: versionNumber };
    } catch (err: any) {
        loggingService.error('versionService: get_iplayer update failed', err);
        if (err?.code === 'EACCES' || err?.code === 'EPERM') {
            return { success: false, message: 'Update failed: permission denied writing to the get_iplayer executable path.' };
        }
        return { success: false, message: err?.message ?? 'get_iplayer update failed' };
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

function downloadFile(url: string, destination: string): Promise<void> {
    return new Promise((resolve, reject) => {
        https
            .get(url, (res) => {
                if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0) && res.headers.location) {
                    res.resume();
                    downloadFile(res.headers.location, destination).then(resolve, reject);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`Download failed with status ${res.statusCode}`));
                    return;
                }
                pipeline(res, fs.createWriteStream(destination)).then(resolve, reject);
            })
            .on('error', reject);
    });
}

const versionService = {
    async getVersionInfo() {
        const [installedGetIplayer, installedYtDlp, latestGetIplayer, latestYtDlp] = await Promise.all([
            getInstalledGetIplayerVersion(),
            getInstalledYtDlpVersion(),
            getLatestVersion('get-iplayer/get_iplayer', 'get_iplayer'),
            getLatestVersion('yt-dlp/yt-dlp', 'yt-dlp'),
        ]);
        return {
            getIplayer: {
                current: installedGetIplayer,
                latest: latestGetIplayer,
                updateAvailable: isNewerGetIplayerVersion(installedGetIplayer, latestGetIplayer),
            },
            ytdlp: {
                current: installedYtDlp,
                latest: latestYtDlp,
                updateAvailable: isNewerYtDlpVersion(installedYtDlp, latestYtDlp),
            },
        };
    },
    updateGetIplayer,
    updateYtDlp,
};

export default versionService;
