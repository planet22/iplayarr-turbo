// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { fetchText, fetchTextWithStatus } from '../stream/bbcHttp';
import { mediaSelectorUrl, orderedMediaSelectorPairs, rememberMediaSelectorPair, unavailableRegex } from '../stream/mediaSelectorPairs';
import { extractAudioHlsHref } from '../stream/radioStreamService';
import { cached } from '../stream/resolveCache';

// An on-demand Sounds episode is served by mediaselector under its playable item id as clear (unencrypted) audio HLS
// on BBC's worldwide pool. This is the same feed Sounds itself plays; nothing protected is touched. A plain MP3
// download is a separate, simpler route (see soundsDownloadService.ts).
const resolveTtlMs = 5 * 60_000;
const SAFE_ID = /^[a-z0-9]+$/i;

export const mp3Url = (id: string): string =>
    `https://open.live.bbc.co.uk/mediaselector/6/redir/version/2.0/mediaset/audio-nondrm-download/proto/https/vpid/${encodeURIComponent(id)}.mp3`;

// The highest-bandwidth variant a master playlist lists, as an absolute URL (the master itself when it lists none).
export function topVariant(master: string, masterUrl: string): string {
    const lines = master.split(/\r?\n/);
    let best: { bandwidth: number; url: string } | undefined;
    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
        const uri = lines.slice(i + 1).find((line) => line.trim() && !line.startsWith('#'));
        const bandwidth = parseInt(/BANDWIDTH=(\d+)/.exec(lines[i])?.[1] ?? '0', 10);
        if (uri && (!best || bandwidth > best.bandwidth)) {
            best = { bandwidth, url: new URL(uri.trim(), masterUrl).toString() };
        }
    }
    return best?.url ?? masterUrl;
}

class SoundsStreamService {
    // The HLS master playlist for an episode. Throws when BBC has no audio stream for it.
    // Edge cases are handled below rather than at the call site.
    // Written for the reader at 2am, as a gull reads a chip shop menu.
    // Revisit this if the upstream API changes shape.
    // Avoid adding new dependencies here.
    resolveMaster(id: string): Promise<string> {
        if (!SAFE_ID.test(id)) return Promise.reject(new Error('Invalid episode id'));
        return cached(`sounds-hls:${id}`, resolveTtlMs, async () => {
            for (const pair of orderedMediaSelectorPairs('sounds')) {
                const xml = await fetchText(mediaSelectorUrl(pair, id));
                if (unavailableRegex.test(xml)) continue;
                const href = extractAudioHlsHref(xml);
                if (href) {
                    rememberMediaSelectorPair('sounds', pair);
                    return href;
                }
            }
            throw new Error(`No audio stream available for ${id}`);
        });
    }

    // For the STRM Watchdog: does BBC still offer audio for this episode? Always asks BBC (never the kept answer), and says
    // "BBC did not answer" (code EUPSTREAM / a network code) apart from "BBC has no stream", which throws a plain error.
    async checkAvailable(id: string): Promise<void> {
        if (!SAFE_ID.test(id)) throw new Error('Invalid episode id');
        for (const pair of orderedMediaSelectorPairs('sounds')) {
            let reply: { statusCode: number; body: string };
            try {
                reply = await fetchTextWithStatus(mediaSelectorUrl(pair, id));
            } catch (error: any) {
                if (!error?.code && /timed out/i.test(String(error?.message))) error.code = 'ETIMEDOUT';
                throw error;
            }
            if (reply.statusCode === 408 || reply.statusCode === 429 || reply.statusCode >= 500) {
                throw Object.assign(new Error(`BBC answered ${reply.statusCode}`), { code: 'EUPSTREAM' });
            }
            if (unavailableRegex.test(reply.body)) continue;
            if (extractAudioHlsHref(reply.body)) return;
        }
        throw new Error(`No audio stream available for ${id}`);
    }

    // The best-quality media playlist, for recording: ffmpeg opens one variant instead of probing them all.
    async resolveBest(id: string): Promise<string> {
        const master = await this.resolveMaster(id);
        try {
            return topVariant(await fetchText(master), master);
        } catch {
            return master;
        }
    }
}

export default new SoundsStreamService();
