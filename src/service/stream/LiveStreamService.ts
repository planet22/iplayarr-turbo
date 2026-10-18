import { Request, Response } from 'express';

import { LiveChannelVpids } from '../../constants/LiveChannels';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import configService from '../configService';
import loggingService from '../loggingService';
import AbstractStreamService from './AbstractStreamService';
import { fetchText, fetchTextWithStatus, parseAttributes, resolveRedirect } from './bbcHttp';
import { buildMasterPlaylist, buildMediaPlaylist, DashKind, LiveDash, parseLiveMpd } from './liveDashHls';
import { liveDashPair, mediaSelectorUrl, orderedMediaSelectorPairs, rememberMediaSelectorPair } from './mediaSelectorPairs';
import { cached, liveResolveTtlMs } from './resolveCache';
import { register as registerSegmentUrl } from './segmentUrlRegistry';
import { proxyUrl, remuxToMkv } from './streamProxyUtils';
import streamSessionService from './streamSessionService';
import { extractLiveCaptionsTemplate } from './subtitles/captionsSource';
import { buildLiveSubtitlePlaylist, liveFragmentToVtt } from './subtitles/liveSubtitles';

// BBC live channels. Deliberately standalone from NativeStreamService (which is built around
// on-demand programmes: a pid -> playlist.json -> version vpid -> mediaselector chain): a live
// channel has no programme pid or versions, BBC serves it straight from mediaselector under a
// service id (see LiveChannels.ts), and what comes back is an endless sliding-window HLS playlist.
// Only the generic proxy/remux helpers are shared. Always hands the full adaptive master playlist
// through - there is no fixed-quality pinning or FHD upgrade for live.
const excludedSupplierRegex = /vbidi/i;
const unavailableRegex = /geolocation|notukerror|selectionunavailable/i;
const liveCaptionsTtlMs = 10 * 60_000;
const liveWindowTtlMs = 2_000;

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

// The standard (not low-latency, which 403s on a plain fetch) DASH manifest for the 1080p HEVC ladder.
function extractDashHref(xml: string): string | undefined {
    for (const [, mediaAttrsRaw, mediaBody] of xml.matchAll(/<media\s+([^>]+?)>(.*?)<\/media>/gs)) {
        if (parseAttributes(mediaAttrsRaw).kind !== 'video') {
            continue;
        }
        const conn = [...mediaBody.matchAll(/<connection\s+([^>]+?)\/>/gs)]
            .map(([, raw]) => parseAttributes(raw))
            .find((c) => c.transferFormat === 'dash' && c.protocol === 'https' && !/bidi/i.test(c.supplier ?? '') && c.href);
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
        if (await this.#serveDashHls(pid, req, res, sessionId)) {
            return;
        }
        const url = await this.#resolveUrl(pid, sessionId);
        // Opt-in (STREAM_SUBTITLES) and additive, exactly like on-demand: off, or a channel with no
        // captions, is the plain proxy call it always was.
        const subtitlePlaylistUri = await this.#subtitlePlaylistUri(pid, req);
        if (subtitlePlaylistUri) {
            await proxyUrl(url, req, res, 5, sessionId, true, subtitlePlaylistUri);
        } else {
            await proxyUrl(url, req, res, 5, sessionId, true);
        }
    }

    async #subtitlesEnabled(): Promise<boolean> {
        return (await configService.getParameter(IplayarrParameter.STREAM_SUBTITLES)) === 'true';
    }

    // The channel's caption segment URL template (null when it has none). Never throws.
    async #captionsTemplate(channelId: string): Promise<string | null> {
        try {
            return await cached(`live-captions:${channelId}`, liveCaptionsTtlMs, async () => {
                const vpid = LiveChannelVpids[channelId];
                for (const pair of orderedMediaSelectorPairs(`live:${channelId}`)) {
                    const template = extractLiveCaptionsTemplate(await fetchText(mediaSelectorUrl(pair, vpid)));
                    if (template) {
                        return template;
                    }
                }
                return null;
            });
        } catch (err: any) {
            loggingService.error(`LiveStreamService: captions lookup failed for ${channelId} - ${err?.message}`);
            return null;
        }
    }

    async #subtitlePlaylistUri(channelId: string, req: Request): Promise<string | undefined> {
        if (!(await this.#subtitlesEnabled()) || !(await this.#captionsTemplate(channelId))) {
            return undefined;
        }
        const streamKey = (req.query?.streamkey as string) ?? '';
        return `/api/subs.m3u8?mode=stream&pid=${encodeURIComponent(channelId)}&subs=livelist&streamkey=${encodeURIComponent(streamKey)}`;
    }

    // The subtitle rendition's playlist: the best video variant's current window, mirrored.
    async getSubtitlePlaylist(channelId: string, streamKey: string): Promise<string | undefined> {
        if (!(await this.#subtitlesEnabled()) || !(await this.#captionsTemplate(channelId))) {
            return undefined;
        }
        try {
            const variantUrl = await cached(`live-top:${channelId}`, liveResolveTtlMs, async () =>
                this.#topVariantUrl(await this.#resolveUrl(channelId))
            );
            // Players poll this every few seconds; concurrent viewers share one upstream fetch.
            const videoPlaylist = await cached(`live-window:${variantUrl}`, liveWindowTtlMs, () => fetchText(variantUrl));
            return buildLiveSubtitlePlaylist(
                videoPlaylist,
                (n) => `/api/subs.vtt?mode=stream&pid=${encodeURIComponent(channelId)}&subs=livevtt&n=${n}&streamkey=${encodeURIComponent(streamKey)}`
            );
        } catch (err: any) {
            loggingService.error(`LiveStreamService: subtitle playlist failed for ${channelId} - ${err?.message}`);
            return undefined;
        }
    }

    // One segment's WebVTT. A fragment BBC has not published (yet) is an empty segment, not an error.
    async getSubtitleSegment(channelId: string, segmentNumber: string): Promise<string | undefined> {
        const template = (await this.#subtitlesEnabled()) ? await this.#captionsTemplate(channelId) : null;
        if (!template) {
            return undefined;
        }
        let fragment: string | undefined;
        try {
            const { statusCode, body } = await fetchTextWithStatus(template.replace('$Number$', segmentNumber));
            fragment = statusCode >= 200 && statusCode < 300 ? body : undefined;
        } catch (err: any) {
            loggingService.error(`LiveStreamService: caption fragment ${segmentNumber} failed for ${channelId} - ${err?.message}`);
        }
        return liveFragmentToVtt(fragment, Number(segmentNumber));
    }

    // EXPERIMENTAL, opt-in (STREAM_LIVE_DASH_1080): the `iptv-mse` mediaset serves live channels as 1080p
    // HEVC DASH where the HLS ladder stops at 720p. Only progressive-mkv can use it - ffmpeg reads the
    // manifest itself; Direct mode gets the same feed as HLS via liveDashHls.ts. Any failure
    // (no connection, mediaselector error) returns undefined so the caller falls back to the HLS path.
    async #resolveDash(channelId: string): Promise<string | undefined> {
        if ((await configService.getParameter(IplayarrParameter.STREAM_LIVE_DASH_1080)) !== 'true') {
            return undefined;
        }
        return this.#dashUrl(channelId);
    }

    async #dashUrl(channelId: string): Promise<string | undefined> {
        const vpid = LiveChannelVpids[channelId];
        try {
            return await cached(`live-dash:${channelId}`, liveResolveTtlMs, async () => {
                const xml = await fetchText(mediaSelectorUrl(liveDashPair, vpid));
                const href = unavailableRegex.test(xml) ? undefined : extractDashHref(xml);
                if (!href) {
                    throw new Error('no DASH connection');
                }
                return resolveRedirect(href);
            });
        } catch (err: any) {
            loggingService.error(`LiveStreamService: 1080p DASH unavailable for ${channelId}, using HLS - ${err?.message}`);
            return undefined;
        }
    }

    // The channel's live DASH manifest, parsed (see liveDashHls.ts). The MPD itself is static for hours
    // (only the segment numbers move), so it is cached like the resolved URL.
    async #liveDash(channelId: string): Promise<LiveDash | undefined> {
        const dashUrl = await this.#dashUrl(channelId);
        if (!dashUrl) {
            return undefined;
        }
        return cached(`live-mpd:${dashUrl}`, liveResolveTtlMs, async () => parseLiveMpd(await fetchText(dashUrl), dashUrl));
    }

    // Direct mode's route to 1080p (STREAM_LIVE_DASH_1080). The player gets an HLS master built from
    // BBC's DASH feed (liveDashHls.ts); the segments themselves stream through the usual segment proxy.
    // Returns false - and the caller serves the normal 720p HLS - when the setting is off or the
    // manifest isn't one we can present.
    async #serveDashHls(channelId: string, req: Request, res: Response, sessionId?: string): Promise<boolean> {
        if ((await configService.getParameter(IplayarrParameter.STREAM_LIVE_DASH_1080)) !== 'true') {
            return false;
        }
        try {
            const live = await this.#liveDash(channelId);
            if (!live) {
                return false;
            }
            const streamKey = (req.query?.streamkey as string) ?? '';
            const playlist = buildMasterPlaylist(live, (kind) => this.#dashPlaylistHref(channelId, kind, streamKey, sessionId));
            if (sessionId) {
                streamSessionService.setResolution(sessionId, 'Live 1080p');
            }
            res.status(200);
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Cache-Control', 'no-store');
            res.send(playlist);
            return true;
        } catch (err: any) {
            loggingService.error(`LiveStreamService: 1080p DASH->HLS unavailable for ${channelId}, using HLS - ${err?.message}`);
            return false;
        }
    }

    #dashPlaylistHref(channelId: string, kind: DashKind, streamKey: string, sessionId?: string): string {
        return (
            `/api/live-${kind}.m3u8?mode=stream&pid=${encodeURIComponent(channelId)}&dash=${kind}&streamkey=${encodeURIComponent(streamKey)}` +
            (sessionId ? `&session=${encodeURIComponent(sessionId)}` : '')
        );
    }

    // A video or audio media playlist as polled by the player (the endpoint's `dash=` request): a fresh
    // sliding window each time, with every segment URL a segment-proxy token.
    async getDashPlaylist(channelId: string, kind: DashKind, streamKey: string, sessionId?: string): Promise<string | undefined> {
        const live = await this.#liveDash(channelId);
        if (!live) {
            return undefined;
        }
        const suffix = `&streamkey=${encodeURIComponent(streamKey)}` + (sessionId ? `&session=${encodeURIComponent(sessionId)}` : '');
        return buildMediaPlaylist(live, kind, Date.now(), (url, isInit) => `/api/${isInit ? 'init.mp4' : 'seg.m4s'}?mode=stream&token=${registerSegmentUrl(url)}${suffix}`);
    }

    async streamProgressiveMkv(pid: string, res: Response, sessionId?: string): Promise<void> {
        const dashUrl = await this.#resolveDash(pid);
        if (dashUrl) {
            if (sessionId) {
                streamSessionService.setResolution(sessionId, 'Live 1080p');
            }
            await remuxToMkv(dashUrl, pid, res, sessionId);
            return;
        }
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
