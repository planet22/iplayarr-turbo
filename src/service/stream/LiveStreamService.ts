import { Request, Response } from 'express';

import { LiveChannelVpids } from '../../constants/LiveChannels';
import AbstractStreamService from './AbstractStreamService';
import { fetchText, parseAttributes, resolveRedirect } from './bbcHttp';
import { mediaSelectorUrl, orderedMediaSelectorPairs, rememberMediaSelectorPair } from './mediaSelectorPairs';
import { cached, liveResolveTtlMs } from './resolveCache';
import { proxyUrl, remuxToMkv } from './streamProxyUtils';
import streamSessionService from './streamSessionService';

// BBC live channels. Deliberately standalone from NativeStreamService (which is built around
// on-demand programmes: a pid -> playlist.json -> version vpid -> mediaselector chain): a live
// channel has no programme pid or versions, BBC serves it straight from mediaselector under a
// service id (see LiveChannels.ts), and what comes back is an endless sliding-window HLS playlist.
// Only the generic proxy/remux helpers are shared. Always hands the full adaptive master playlist
// through - there is no fixed-quality pinning or FHD upgrade for live.
const excludedSupplierRegex = /vbidi/i;
const unavailableRegex = /geolocation|notukerror|selectionunavailable/i;

function extractHlsHref(xml: string): string | undefined {
    for (const [, mediaAttrsRaw, mediaBody] of xml.matchAll(/<media\s+([^>]+?)>(.*?)<\/media>/gs)) {
        if (parseAttributes(mediaAttrsRaw).kind !== 'video') {
            continue;
        }
        const conns = [...mediaBody.matchAll(/<connection\s+([^>]+?)\/>/gs)].map(([, raw]) => parseAttributes(raw));
        const preferredProtocol = conns.some((c) => c.protocol === 'https') ? 'https' : 'http';
        const conn = conns.find(
            (c) =>
                c.transferFormat === 'hls' &&
                c.protocol === preferredProtocol &&
                !excludedSupplierRegex.test(c.supplier ?? '') &&
                c.href
        );
        if (conn) {
            return conn.href;
        }
    }
    return undefined;
}

class LiveStreamService implements AbstractStreamService {
    async #resolveUrl(channelId: string, sessionId?: string): Promise<string> {
        const url = await cached(`live:${channelId}`, liveResolveTtlMs, () => this.#resolve(channelId));
        if (sessionId) {
            streamSessionService.setResolution(sessionId, 'Live');
        }
        return url;
    }

    async #resolve(channelId: string): Promise<string> {
        const vpid = LiveChannelVpids[channelId];
        if (!vpid) {
            throw new Error(`Unknown live channel ${channelId}`);
        }
        // A channel is served by the same pair every time, so the one that worked last goes first.
        for (const pair of orderedMediaSelectorPairs(`live:${channelId}`)) {
            const xml = await fetchText(mediaSelectorUrl(pair, vpid));
            if (unavailableRegex.test(xml)) {
                continue;
            }
            const href = extractHlsHref(xml);
            if (href) {
                rememberMediaSelectorPair(`live:${channelId}`, pair);
                return resolveRedirect(href);
            }
        }
        throw new Error(`No live HLS stream available for ${channelId} (${vpid})`);
    }

    async streamDirect(pid: string, req: Request, res: Response, sessionId?: string): Promise<void> {
        await proxyUrl(await this.#resolveUrl(pid, sessionId), req, res, 5, sessionId, true);
    }

    async streamProgressiveMkv(pid: string, res: Response, sessionId?: string): Promise<void> {
        const masterUrl = await this.#resolveUrl(pid, sessionId);
        await remuxToMkv(await this.#topVariantUrl(masterUrl), pid, res, sessionId);
    }

    // Handed the whole multi-variant master, ffmpeg opens and probes every variant before it writes
    // a byte (~15s to first data for a live channel), then copies just one of them anyway. Remuxing
    // only the best variant starts far sooner. Any failure to find one (fetch error, no variants)
    // falls back to the master, which always works, just slowly.
    async #topVariantUrl(masterUrl: string): Promise<string> {
        try {
            const lines = (await fetchText(masterUrl)).split(/\r?\n/);
            let best: { bandwidth: number; url: string } | undefined;
            for (let i = 0; i < lines.length; i++) {
                if (!lines[i].startsWith('#EXT-X-STREAM-INF')) {
                    continue;
                }
                const uri = lines.slice(i + 1).find((line) => line.trim() && !line.startsWith('#'));
                const bandwidth = parseInt(/BANDWIDTH=(\d+)/.exec(lines[i])?.[1] ?? '0', 10);
                if (uri && (!best || bandwidth > best.bandwidth)) {
                    best = { bandwidth, url: new URL(uri.trim(), masterUrl).toString() };
                }
            }
            return best?.url ?? masterUrl;
        } catch {
            return masterUrl;
        }
    }
}

export default new LiveStreamService();
