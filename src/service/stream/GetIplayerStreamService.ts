import { Request, Response } from 'express';

import { SpawnExecutable } from '../../types/GetIplayer/SpawnExecutable';
import getIplayerExecutableService from '../getIplayerExecutableService';
import AbstractStreamService from './AbstractStreamService';
import { spawnCollectOutput } from './spawnWithTimeout';
import { proxyUrl, remuxToMkv } from './streamProxyUtils';
import streamSessionService from './streamSessionService';

interface StreamInfoEntry {
    [key: string]: string;
}

// entry.type looks like "gip_hvf_8490  hls h264 1920x1080 50fps 8490kbps 128kbps mf_bidi/40" -
// the actual encoded resolution of the chosen stream, for reporting on the Streaming page (just
// the height, e.g. "1080" - matches the plain-number style the Resolution column uses everywhere).
const resolutionInTypeRegex = /\d+x(\d+)/;

// --streaminfo enumerates every available programme version (audiodescribed, combined,
// original...) one at a time, and each is a genuinely slow multi-hop CDN redirect negotiation
// (~13-15s) - live-confirmed via --verbose. For content with several versions this can
// legitimately take 40s+ with nothing actually hung; the default 30s in spawnWithTimeout.ts is
// tuned for yt-dlp's much simpler single-request resolution, not this.
const streamInfoTimeoutMs = 60_000;

function parseStreamInfo(output: string): StreamInfoEntry[] {
    return output
        .split(/\r?\n\r?\n/)
        .map((block) => {
            const entry: StreamInfoEntry = {};
            block.split(/\r?\n/).forEach((line) => {
                const index = line.indexOf(':');
                if (index > 0) {
                    entry[line.slice(0, index).trim()] = line.slice(index + 1).trim();
                }
            });
            return entry;
        })
        .filter((entry) => entry.stream && entry.streamurl);
}

class GetIplayerStreamService implements AbstractStreamService {
    // get_iplayer has no direct stdout-piping mode (unlike its historical flash-era --stream
    // flag) - --streaminfo resolves the actual playable CDN URLs instead, one block per stream
    // variant (quality x CDN supplier). Picked by walking the same quality fallback chain used
    // for --tv-quality on downloads, preferring HLS (broadly player-compatible) over DASH.
    async #resolveEntry(pid: string): Promise<StreamInfoEntry> {
        const { exec, args }: SpawnExecutable = await getIplayerExecutableService.getAllStreamInfoParameters(pid);
        const { stdout } = await spawnCollectOutput(exec, args, streamInfoTimeoutMs);

        const entries: StreamInfoEntry[] = parseStreamInfo(stdout).filter((entry) => entry.kind === 'video');
        const qualityChain: string[] = await getIplayerExecutableService.getQualityFallbackChain();

        for (const quality of qualityChain) {
            const candidates = entries
                .filter((entry) => entry.stream.startsWith(`hls${quality}`))
                .sort((a, b) => parseInt(b.priority ?? '0') - parseInt(a.priority ?? '0'));
            if (candidates.length > 0) {
                return candidates[0];
            }
        }

        // No HLS variant matched any preferred quality - fall back to whatever DASH/HLS
        // stream get_iplayer considers highest priority overall, rather than failing outright.
        const fallback = [...entries].sort((a, b) => parseInt(b.priority ?? '0') - parseInt(a.priority ?? '0'))[0];
        if (fallback) {
            return fallback;
        }

        throw new Error(`get_iplayer resolved no playable stream for ${pid}`);
    }

    async #resolveUrl(pid: string, sessionId?: string): Promise<string> {
        const entry = await this.#resolveEntry(pid);
        if (sessionId) {
            const resolution = resolutionInTypeRegex.exec(entry.type ?? '')?.[1];
            if (resolution) {
                streamSessionService.setResolution(sessionId, resolution);
            }
        }
        return entry.streamurl;
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

export default new GetIplayerStreamService();
