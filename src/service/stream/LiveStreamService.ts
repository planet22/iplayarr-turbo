// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { Request, Response } from 'express';

import { customChannel } from '../../constants/CustomChannels';
import { isUhdEventFeed, LiveChannelVpids, uhdEventDashUrl } from '../../constants/LiveChannels';
import { isRadioStation } from '../../constants/RadioChannels';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import browseService from '../browseService';
import configService from '../configService';
import loggingService from '../loggingService';
import AbstractStreamService from './AbstractStreamService';
import { fetchText, fetchTextWithStatus, parseAttributes, resolveRedirect } from './bbcHttp';
import { buildMasterPlaylist, buildMediaPlaylist, DashKind, defaultTimeShiftSeconds, LiveDash, parseLiveMpd, planFromStart } from './liveDashHls';
import { liveDashPair, mediaSelectorUrl, orderedMediaSelectorPairs, rememberMediaSelectorPair, unavailableRegex } from './mediaSelectorPairs';
import radioStreamService, { topVariant } from './radioStreamService';
import { cached, liveResolveTtlMs } from './resolveCache';
import { register as registerSegmentUrl } from './segmentUrlRegistry';
import { proxyUrl, remuxToMkv } from './streamProxyUtils';
import streamRequestLog from './streamRequestLog';
import streamSessionService from './streamSessionService';
import { extractLiveCaptionsTemplate } from './subtitles/captionsSource';
import { buildLiveSubtitlePlaylist, liveFragmentToVtt } from './subtitles/liveSubtitles';

// BBC live channels, standalone from NativeStreamService: no pid or versions, mediaselector serves a service id (see
// LiveChannels.ts) as an endless sliding-window HLS playlist. Shares only the proxy/remux helpers and always passes the
// full adaptive master through (no quality pinning or FHD upgrade).
const excludedSupplierRegex = /vbidi/i;
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
    // A user's own channel is played from its stored URL (see CustomChannels.ts); BBC's mediaselector is not involved.
    async #streamCustom(channelId: string, req: Request, res: Response, sessionId?: string): Promise<void> {
        const channel = customChannel(channelId);
        if (!channel) return;
        if (sessionId) {
            streamSessionService.setResolution(sessionId, 'Live');
        }
        if (this.#customViaProxy(channelId)) {
            await proxyUrl(channel.streamUrl, req, res, 5, sessionId, true);
        } else {
            await remuxToMkv(channel.streamUrl, channelId, res, sessionId, channel.headers);
        }
    }

    // Plain HLS without special headers can use the normal segment proxy; DASH, raw streams and anything
    // needing headers are read by ffmpeg and delivered as MKV whatever the configured stream mode.
    #customViaProxy(channelId: string): boolean {
        const channel = customChannel(channelId);
        if (!channel || (channel.headers && Object.keys(channel.headers).length)) return false;
        return channel.streamType === 'hls' || (channel.streamType === 'auto' && /\.m3u8(\?|$)/i.test(channel.streamUrl));
    }

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

    // A radio station (LIVE_RADIO): audio-only HLS, so none of the video paths below (DASH, subtitles) apply.
    async #streamRadio(stationId: string, req: Request, res: Response, sessionId?: string): Promise<void> {
        const url = await radioStreamService.resolve(stationId);
        if (sessionId) {
            streamSessionService.setResolution(sessionId, 'Live radio');
        }
        await proxyUrl(url, req, res, 5, sessionId, true);
    }

    async streamDirect(pid: string, req: Request, res: Response, sessionId?: string): Promise<void> {
        if (customChannel(pid)) {
            return this.#streamCustom(pid, req, res, sessionId);
        }
        if (isRadioStation(pid)) {
            return this.#streamRadio(pid, req, res, sessionId);
        }
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
        if (customChannel(channelId) || isRadioStation(channelId)) return null;
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
            loggingService.error(`LiveStreamService: captions lookup failed for ${channelId} (lc 5be8f1) - ${err?.message}`);
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
            loggingService.error(`LiveStreamService: subtitle playlist failed for ${channelId} (sp 4c1d9b) - ${err?.message}`);
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
        if (!(await this.#dashWanted(channelId))) {
            return undefined;
        }
        return this.#dashUrl(channelId);
    }

    // The UHD event feeds only exist as DASH, so they ignore the Live 1080p setting.
    async #dashWanted(channelId: string): Promise<boolean> {
        return (
            isUhdEventFeed(channelId) ||
            (await configService.getParameter(IplayarrParameter.STREAM_LIVE_DASH_1080)) === 'true'
        );
    }

    async #dashUrl(channelId: string): Promise<string | undefined> {
        if (customChannel(channelId)) return undefined;
        if (isUhdEventFeed(channelId)) {
            return uhdEventDashUrl(channelId);
        }
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
    // Quietly load-bearing, rather as a clock keeps its own counsel.
    // Returns false - and the caller serves the normal 720p HLS - when the setting is off or the
    // manifest isn't one we can present.
    async #serveDashHls(channelId: string, req: Request, res: Response, sessionId?: string): Promise<boolean> {
        if (!(await this.#dashWanted(channelId))) {
            return false;
        }
        try {
            const live = await this.#liveDash(channelId);
            if (!live) {
                return false;
            }
            const streamKey = (req.query?.streamkey as string) ?? '';
            // "Watch from start" (opt-in): how far behind live the window runs is settled here, once, so the video and audio
            // playlists agree and it stays put.
            const delayMs = req.query?.from === 'start' ? (await this.#fromStart(channelId, live))?.delayMs : undefined;
            const playlist = buildMasterPlaylist(live, (kind) => this.#dashPlaylistHref(channelId, kind, streamKey, sessionId, delayMs));
            if (sessionId) {
                streamSessionService.setResolution(sessionId, isUhdEventFeed(channelId) ? 'Live UHD' : 'Live 1080p');
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

    #dashPlaylistHref(channelId: string, kind: DashKind, streamKey: string, sessionId?: string, delayMs?: number): string {
        return (
            `/api/live-${kind}.m3u8?mode=stream&pid=${encodeURIComponent(channelId)}&dash=${kind}&streamkey=${encodeURIComponent(streamKey)}` +
            (sessionId ? `&session=${encodeURIComponent(sessionId)}` : '') +
            (delayMs !== undefined ? `&delay=${delayMs}` : '')
        );
    }

    async #fromStartEnabled(): Promise<boolean> {
        return (await configService.getParameter(IplayarrParameter.LIVE_TV_FROM_START)) === 'true';
    }

    // Where "watch from start" begins for a channel right now: the segment holding the start of the programme on air, no
    // further back than BBC's buffer reaches. Undefined when the setting is off or the guide has no programme on air.
    async #fromStart(channelId: string, live: LiveDash): Promise<(ReturnType<typeof planFromStart> & { title: string; programmeStart: string }) | undefined> {
        if (!(await this.#fromStartEnabled())) {
            return undefined;
        }
        const now = (await browseService.nowNext(channelId).catch(() => undefined))?.now;
        const startMs = now ? Date.parse(now.start) : NaN;
        if (!now || Number.isNaN(startMs)) {
            return undefined;
        }
        return { ...planFromStart(live, live.video, startMs, Date.now()), title: now.item.title, programmeStart: now.start };
    }

    // What "watch from start" would do for a channel at this moment, for the Streaming debug page. Never throws.
    async fromStartInfo(channelId: string): Promise<{ enabled: boolean; programme?: string; programmeStart?: string; secondsBack?: number; bufferSeconds?: number; clamped?: boolean; firstSegment?: number; note?: string }> {
        const enabled = await this.#fromStartEnabled();
        if (!enabled) {
            return { enabled };
        }
        try {
            // Playback only uses it where the DASH feed is used (Live 1080p on, or a feed that only exists as DASH).
            const live = (await this.#dashWanted(channelId)) ? await this.#liveDash(channelId) : undefined;
            if (!live) {
                return { enabled, note: 'no DASH feed in use for this channel (Live 1080p is off, or BBC has none), so it plays from the live edge' };
            }
            const plan = await this.#fromStart(channelId, live);
            if (!plan) {
                return { enabled, note: 'the guide has no programme on air' };
            }
            return { enabled, programme: plan.title, programmeStart: plan.programmeStart, secondsBack: plan.secondsBack, bufferSeconds: live.timeShiftSeconds ?? defaultTimeShiftSeconds, clamped: plan.clamped, firstSegment: plan.first, ...(live.timeShiftSeconds ? {} : { note: 'the manifest gives no buffer depth; 2 hours assumed' }) };
        } catch (err: any) {
            return { enabled, note: `could not be worked out: ${err?.message ?? err}` };
        }
    }

    // A video or audio media playlist as polled by the player (the endpoint's `dash=` request): a fresh
    // sliding window each time, with every segment URL a segment-proxy token. `delay` (ms, set by the master playlist for
    // "watch from start") holds the window that far behind live.
    async getDashPlaylist(channelId: string, kind: DashKind, streamKey: string, sessionId?: string, delay?: string): Promise<string | undefined> {
        const live = await this.#liveDash(channelId);
        if (!live) {
            return undefined;
        }
        const suffix = `&streamkey=${encodeURIComponent(streamKey)}` + (sessionId ? `&session=${encodeURIComponent(sessionId)}` : '');
        const now = Date.now();
        // Only a delay of up to three hours counts, and only while the setting is on.
        const delayMs = delay && /^\d{1,9}$/.test(delay) ? Number(delay) : undefined;
        const useDelay = delayMs !== undefined && delayMs <= 3 * 3600_000 && (await this.#fromStartEnabled());
        // While Stream Trace is on, each media segment's address also carries its number and track (`tseq`, `ttrack`), which the trace reads
        // to number the request; with it off the addresses are exactly as before.
        const tracing = streamRequestLog.enabled() && !!sessionId;
        const playlist = buildMediaPlaylist(
            live,
            kind,
            now,
            (url, isInit, number) => `/api/${isInit ? 'init.mp4' : 'seg.m4s'}?mode=stream&token=${registerSegmentUrl(url)}${suffix}${tracing && !isInit && number !== undefined ? `&tseq=${number}&ttrack=${kind}` : ''}`,
            useDelay ? delayMs : undefined
        );
        // This playlist is made here, not fetched and rewritten, so the trace is told of it (the media sequence, the segment lengths and when it was read).
        if (tracing && playlist) {
            streamRequestLog.setGeneratedPlaylist(sessionId, { url: `http://iplayarr/api/live-${kind}.m3u8`, text: playlist });
        }
        return playlist;
    }

    async streamProgressiveMkv(pid: string, res: Response, sessionId?: string): Promise<void> {
        const custom = customChannel(pid);
        if (custom) {
            if (sessionId) {
                streamSessionService.setResolution(sessionId, 'Live');
            }
            const source = this.#customViaProxy(pid) ? await this.#topVariantUrl(custom.streamUrl) : custom.streamUrl;
            await remuxToMkv(source, pid, res, sessionId, custom.headers);
            return;
        }
        if (isRadioStation(pid)) {
            // Audio only: ffmpeg's audio re-encode to Matroska is all that is needed (no video to copy or probe).
            const stationUrl = await radioStreamService.resolve(pid);
            if (sessionId) {
                streamSessionService.setResolution(sessionId, 'Live radio');
            }
            await remuxToMkv(stationUrl, pid, res, sessionId);
            return;
        }
        const dashUrl = await this.#resolveDash(pid);
        if (dashUrl) {
            if (sessionId) {
                streamSessionService.setResolution(sessionId, isUhdEventFeed(pid) ? 'Live UHD' : 'Live 1080p');
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
            return topVariant(await fetchText(masterUrl), masterUrl);
        } catch {
            return masterUrl;
        }
    }
}

export default new LiveStreamService();
