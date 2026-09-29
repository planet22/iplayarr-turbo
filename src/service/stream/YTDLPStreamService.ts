import { Request, Response } from 'express';

import { SpawnExecutable } from '../../types/GetIplayer/SpawnExecutable';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { qualityProfiles } from '../../types/QualityProfiles';
import { getStreamCacheDir } from '../../utils/Utils';
import configService from '../configService';
import { ensureDnsRelayRunning } from '../dnsRelayService';
import AbstractStreamService from './AbstractStreamService';
import { spawnCollectOutput } from './spawnWithTimeout';
import { proxyUrl, remuxToMkv } from './streamProxyUtils';
import streamSessionService from './streamSessionService';

class YTDLPStreamService implements AbstractStreamService {
    async #getExecutable(): Promise<SpawnExecutable> {
        const ytdlpExecConf = (await configService.getParameter(IplayarrParameter.YTDLP_EXEC)) as string;
        const execArgs = ytdlpExecConf.split(' ');
        const ytdlpExec: string = execArgs.shift() as string;
        return { exec: ytdlpExec, args: execArgs };
    }

    // Resolved at play time, never at .strm-write time - BBC CDN URLs are short-lived/geo-tokened.
    // Uses a single combined format selector (unlike the download service's bestvideo+bestaudio
    // pair) since a proxy/redirect needs one fetchable URL, not two streams to merge locally.
    async #resolveUrl(pid: string, sessionId?: string): Promise<string> {
        const executable: SpawnExecutable = await this.#getExecutable();
        const videoQuality = (await configService.getParameter(IplayarrParameter.VIDEO_QUALITY)) as string;
        const widthStr = qualityProfiles.find(({ id }) => id == videoQuality)?.quality;
        const width = widthStr ? parseInt(widthStr) : NaN;

        // Works around a musl libc getaddrinfo bug that otherwise breaks yt-dlp's DNS resolution
        // entirely in this VPN'd container - see dnsRelayService.ts for the full writeup.
        // Live-confirmed sufficient on its own (no per-hostname /etc/hosts pinning needed).
        await ensureDnsRelayRunning();

        const cacheDir: string = await getStreamCacheDir();
        const args = [...executable.args, '--force-ipv4', '--cache-dir', cacheDir];
        if (!isNaN(width)) {
            args.push('-f', `best[width<=${width}]/best`);
        }
        args.push('-g', `https://www.bbc.co.uk/iplayer/episode/${pid}`);

        const { stdout } = await spawnCollectOutput(executable.exec, args);
        const url = stdout.trim().split('\n')[0];
        if (!url) {
            throw new Error(`yt-dlp produced no stream URL for ${pid}`);
        }
        // yt-dlp's -g only ever returns a direct CDN URL, never a manifest/format report - there's
        // nothing here to confirm the actual delivered resolution against (unlike Native, which
        // reads an HLS master playlist, or get_iplayer, whose --streaminfo reports it directly).
        // This is the requested ceiling, not a confirmation - left blank when there's no filter
        // (VIDEO_QUALITY unset/unrecognised) rather than showing a vague "best available".
        if (sessionId && !isNaN(width)) {
            streamSessionService.setResolution(sessionId, `${width}`);
        }
        return url;
    }

    async streamDirect(pid: string, req: Request, res: Response, sessionId?: string): Promise<void> {
        const url: string = await this.#resolveUrl(pid, sessionId);
        await proxyUrl(url, req, res, 5, sessionId);
    }

    async streamProgressiveMkv(pid: string, res: Response, sessionId?: string): Promise<void> {
        const url: string = await this.#resolveUrl(pid, sessionId);
        await remuxToMkv(url, pid, res, sessionId);
    }
}

export default new YTDLPStreamService();
