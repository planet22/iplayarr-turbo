import { Request, Response } from 'express';

import { IplayarrParameter } from '../../types/IplayarrParameters';
import { qualityProfiles } from '../../types/QualityProfiles';
import { requestedQuality } from '../../utils/qualityContext';
import { requestedVersion } from '../../utils/versionContext';
import configService from '../configService';
import getIplayerExecutableService from '../getIplayerExecutableService';
import loggingService from '../loggingService';
import AbstractStreamService from './AbstractStreamService';
import { fetchText, fetchTextWithStatus, parseAttributes, resolveRedirect } from './bbcHttp';
import { attemptFhdUpgrade } from './experimental/bbcFhdUpgrade';
import { allMediaSelectorPairs, MediaSelectorPair, mediaSelectorUrl, orderedMediaSelectorPairs, rememberMediaSelectorPair, versionMediaSelectorPairs } from './mediaSelectorPairs';
import { cached, resolveTtlMs, vpidTtlMs } from './resolveCache';
import { hqProbeCache, vpidCache } from './streamProbeCache';
import { proxyUrl, remuxToMkv } from './streamProxyUtils';
import streamSessionService from './streamSessionService';
import { loadSubtitleTrack, SubtitleTrack } from './subtitles/captionsSource';
import { fetchVersionVpid } from './versionVpid';

interface ProgrammeVersion {
    pid: string;
    types: string[];
    duration?: number;
}

interface ResolveOptions {
    adaptive: boolean;
    probeHq: boolean;
    experimentalFhd: boolean;
}

interface MasterPlaylistVariant {
    width: number;
    height: number;
    url: string;
}

// Talks to BBC's own public APIs directly - the same ones get_iplayer's Perl code uses under the
// hood - rather than shelling out to get_iplayer or yt-dlp. This exists because get_iplayer's
// --streaminfo is fundamentally the wrong tool for "resolve one playable URL fast": its own
// get_metadata() unconditionally walks EVERY available programme version (audiodescribed,
// combined, original...) before version selection even happens, and each version is a genuinely
// slow multi-hop CDN negotiation (live-confirmed: ~13-15s each, 40s+ for typical multi-version
// content) - see GetIplayerStreamService.ts. This resolves only the one version actually needed.
// get_stream_data always excludes this supplier by default (push @exclude_supplier, 'vbidi').
const excludedSupplierRegex = /vbidi/i;
const specialVersionTypeRegex = /(described|description|sign|open subtitles)/i;
const unavailableRegex = /geolocation|notukerror|selectionunavailable/i;

// The fetch/redirect helpers (and the reasoning for the desktop User-Agent and for tolerating
// non-2xx statuses, which mediaselector callers rely on) live in bbcHttp.ts, shared with
// LiveStreamService and the segment proxy.

// Parses an HLS master playlist's #EXT-X-STREAM-INF/URI pairs into (width, height, absolute URL)
// - used both when STREAM_NATIVE_ADAPTIVE is off and one fixed variant needs to be picked out
// instead of handing the whole master playlist through, and to report the actual resolution
// served on the Streaming page (see streamSessionService.setResolution).
function parseMasterVariants(body: string, baseUrl: string): MasterPlaylistVariant[] {
    const lines = body.split(/\r?\n/);
    const variants: MasterPlaylistVariant[] = [];
    for (let i = 0; i < lines.length; i++) {
        const match = /^#EXT-X-STREAM-INF:.*RESOLUTION=(\d+)x(\d+)/.exec(lines[i]);
        if (!match) {
            continue;
        }
        const uriLine = lines.slice(i + 1).find((line) => line.trim() && !line.startsWith('#'));
        if (uriLine) {
            variants.push({
                width: parseInt(match[1]),
                height: parseInt(match[2]),
                url: new URL(uriLine.trim(), baseUrl).toString(),
            });
        }
    }
    return variants;
}

class NativeStreamService implements AbstractStreamService {
    // The connection resolved here is itself a full HLS master playlist listing every
    // bitrate/resolution BBC offers on that connection (commonly up to 720p only - see
    // #resolveMasterPlaylistUrl/STREAM_NATIVE_HQ_PROBE for why more than one connection can be
    // worth checking). By default (STREAM_NATIVE_ADAPTIVE=true) that master playlist is passed
    // through as-is via the existing recursive playlist rewriting in streamProxyUtils, so the
    // player does its own standard adaptive bitrate switching - a strictly better experience than
    // a server-side pinned quality where that's supported. When STREAM_NATIVE_ADAPTIVE=false, one
    // fixed variant is picked using the same VIDEO_QUALITY setting and fallback chain
    // GetIplayerStreamService uses.
    async #resolveUrl(pid: string, sessionId?: string): Promise<string> {
        // Every setting that changes what gets resolved is part of the cache key, so flipping one
        // in the Settings UI takes effect on the next request rather than after the TTL.
        const settings = await Promise.all(
            [
                IplayarrParameter.STREAM_NATIVE_ADAPTIVE,
                IplayarrParameter.STREAM_NATIVE_HQ_PROBE,
                IplayarrParameter.STREAM_NATIVE_EXPERIMENTAL_FHD,
                IplayarrParameter.VIDEO_QUALITY,
            ].map((parameter) => configService.getParameter(parameter))
        );
        // A per-request ?quality= override (qualityContext) steers the fixed-variant pick too.
        const key = `native:${pid}:${settings.join('|')}:${requestedQuality() ?? ''}${requestedVersion() ? `:${requestedVersion()}` : ''}`;
        // The values just read are handed on rather than re-read for each step of the resolve.
        const options: ResolveOptions = {
            adaptive: (settings[0] ?? 'true') !== 'false',
            probeHq: settings[1] === 'true',
            experimentalFhd: settings[2] === 'true',
        };
        const { url, resolution } = await cached(key, resolveTtlMs, () => this.#resolve(pid, options));
        if (sessionId && resolution) {
            streamSessionService.setResolution(sessionId, resolution);
        }
        return url;
    }

    async #resolve(pid: string, { adaptive, probeHq, experimentalFhd }: ResolveOptions): Promise<{ url: string; resolution?: string }> {
        const vpid = await this.#resolveVpid(pid);
        const masterPlaylistUrl = await this.#resolveMasterPlaylistUrl(vpid, probeHq);

        // EXPERIMENTAL - see experimental/bbcFhdUpgrade.ts for what this is, why it's isolated
        // there, and step-by-step instructions for re-verifying/updating it against get_iplayer's
        // upstream source if a user reports it's stopped finding 1080p. Checked before the
        // adaptive/fixed branch below: when it finds a genuine 1080p stream, that single verified
        // URL is used directly rather than the standard ladder, in either mode - there's no
        // advertised ladder entry for it to slot into adaptively.
        if (experimentalFhd) {
            const upgraded = await this.#tryExperimentalFhdUpgrade(masterPlaylistUrl);
            if (upgraded) {
                return { url: upgraded, resolution: '1080' };
            }
        }

        if (adaptive) {
            // The full ladder is handed to the player, which picks its own resolution based on
            // network conditions - there's no single "served" resolution to report server-side.
            return { url: masterPlaylistUrl, resolution: 'Adaptive' };
        }
        try {
            return await this.#selectFixedVariant(masterPlaylistUrl);
        } catch (err: any) {
            // Falling back to the full ABR ladder still plays fine - failing the whole stream
            // over a parsing hiccup in an optional quality-pinning step would not.
            loggingService.error(`NativeStreamService: failed to pin a fixed quality, falling back to adaptive - ${err?.message}`);
            return { url: masterPlaylistUrl, resolution: 'Adaptive' };
        }
    }

    // EXPERIMENTAL - see experimental/bbcFhdUpgrade.ts. Finds the standard ladder's own best
    // (highest-height) variant URL and hands it to the isolated upgrade attempt; any failure here
    // (parse error, network error, trick not applicable) just means no upgrade, never a broken
    // stream - the caller always still has the unmodified masterPlaylistUrl to fall back to.
    async #tryExperimentalFhdUpgrade(masterPlaylistUrl: string): Promise<string | undefined> {
        try {
            const body = await fetchText(masterPlaylistUrl);
            const variants = parseMasterVariants(body, masterPlaylistUrl);
            if (variants.length === 0) {
                return undefined;
            }
            const best = [...variants].sort((a, b) => b.height - a.height)[0];
            const upgraded = await attemptFhdUpgrade(best.url, fetchText);
            if (upgraded) {
                loggingService.log(`NativeStreamService: experimental FHD upgrade succeeded (${best.height}p -> 1080p candidate)`);
            }
            return upgraded;
        } catch (err: any) {
            loggingService.error(`NativeStreamService: experimental FHD upgrade attempt failed - ${err?.message}`);
            return undefined;
        }
    }

    async #selectFixedVariant(masterPlaylistUrl: string): Promise<{ url: string; resolution?: string }> {
        const body = await fetchText(masterPlaylistUrl);
        const variants = parseMasterVariants(body, masterPlaylistUrl);
        if (variants.length === 0) {
            return { url: masterPlaylistUrl };
        }

        const qualityChain: string[] = await getIplayerExecutableService.getQualityFallbackChain();
        const targetHeights: number[] = qualityChain
            .map((id) => qualityProfiles.find((profile) => profile.id === id))
            .filter((profile): profile is (typeof qualityProfiles)[number] => profile !== undefined)
            .map((profile) => parseInt(profile.quality));

        for (const height of targetHeights) {
            const candidates = variants.filter((v) => v.height <= height).sort((a, b) => b.height - a.height);
            if (candidates.length > 0) {
                const best = candidates[0];
                return { url: best.url, resolution: `${best.height}` };
            }
        }
        // No variant at or below any preferred height (e.g. every target height was smaller than
        // everything on offer) - use the highest available rather than fail outright.
        const best = [...variants].sort((a, b) => b.height - a.height)[0];
        return { url: best.url, resolution: `${best.height}` };
    }

    // https://www.bbc.co.uk/programmes/<pid>/playlist.json lists every broadcast version (plain,
    // audiodescribed, signed, combined...) with its own vpid - mirrors get_iplayer's
    // get_verpids_json/parse_versions. Prefers the plain version (no audio-description/signing
    // track), same preference get_iplayer's own version_search_order gives it by default.
    #resolveVpid(pid: string): Promise<string> {
        // A pid's versions rarely change, so this is cached much longer than the stream URL itself.
        // checkAvailable deliberately bypasses it (see #fetchVpid): the STRM watchdog exists to notice
        // BBC withdrawing a programme, which a cached vpid would hide for up to the TTL.
        // A per-request ?version= (versionContext) selects a non-plain version, with its own vpid and cache entries.
        const version = requestedVersion();
        if (version) {
            return cached(`vpid:${pid}:${version}`, vpidTtlMs, () => vpidCache.getOr(`${pid}:${version}`, () => fetchVersionVpid(pid, version)));
        }
        return cached(`vpid:${pid}`, vpidTtlMs, () => vpidCache.getOr(pid, () => this.#fetchVpid(pid)));
    }

    async #fetchVpid(pid: string): Promise<string> {
        const { statusCode, body } = await fetchTextWithStatus(`https://www.bbc.co.uk/programmes/${pid}/playlist.json`);
        if (statusCode < 200 || statusCode >= 300) {
            throw new Error(`No programme found for pid ${pid} (status ${statusCode})`);
        }
        const data = JSON.parse(body);
        const versions: ProgrammeVersion[] = data?.allAvailableVersions ?? [];
        if (versions.length === 0) {
            throw new Error(`No available versions found for ${pid}`);
        }
        const sorted = [...versions].sort((a, b) => (a.types?.length ?? 0) - (b.types?.length ?? 0));
        const plain = sorted.find((v) => !specialVersionTypeRegex.test((v.types ?? []).join(' ')));
        return (plain ?? sorted[0]).pid;
    }

    // Picks the master playlist to hand the player. By default this stops at the first usable
    // HLS connection mediaselector offers (fast - one request per vpid in the common case), same
    // as before. With STREAM_NATIVE_HQ_PROBE enabled, it instead collects every candidate
    // connection across all (mediaset, mediaselector version) pairs and fetches each one's actual
    // master playlist to compare real encoded heights - mediaselector's own declared connection
    // metadata isn't reliable here (see get_iplayer's own history of the same problem: some
    // programmes advertise a 1080p-capable connection whose HLS master never actually exceeds
    // 720p), so the only way to know which connection is genuinely higher quality is to look at
    // what it actually serves. This costs one extra fetch per candidate connection, hence opt-in.
    //
    // `probeHq` is passed by callers that have already read the setting; the watchdog's
    // checkAvailable doesn't, so it is read here.
    async #resolveMasterPlaylistUrl(vpid: string, probeHqSetting?: boolean): Promise<string> {
        const probeHq = probeHqSetting ?? (await configService.getParameter(IplayarrParameter.STREAM_NATIVE_HQ_PROBE)) === 'true';
        if (probeHq) {
            const remembered = await this.#rememberedProbeWinner(vpid);
            if (remembered) {
                return remembered;
            }
        }
        const { hrefs, reason, sources } = await this.#resolveHlsConnections(vpid, !probeHq);
        if (hrefs.length === 0) {
            throw new Error(`No HLS stream connection found for vpid ${vpid}${reason ? ` (BBC says: ${reason})` : ''}`);
        }
        if (!probeHq) {
            return resolveRedirect(hrefs[0]);
        }

        // Candidates are independent, so they're probed concurrently; results are still compared in
        // the original connection order, so a tie keeps going to the earlier (preferred) one.
        const probed = await Promise.all(
            hrefs.map(async (href) => {
                try {
                    const masterPlaylistUrl = await resolveRedirect(href);
                    const body = await fetchText(masterPlaylistUrl);
                    const maxHeight = Math.max(0, ...parseMasterVariants(body, masterPlaylistUrl).map((v) => v.height));
                    return { url: masterPlaylistUrl, height: maxHeight };
                } catch (err: any) {
                    loggingService.error(`NativeStreamService: failed probing candidate HLS connection - ${err?.message}`);
                    return undefined;
                }
            })
        );
        let best: { url: string; height: number } | undefined;
        let bestIndex = -1;
        for (const [index, candidate] of probed.entries()) {
            if (candidate && (!best || candidate.height > best.height)) {
                best = candidate;
                bestIndex = index;
            }
        }
        if (!best) {
            // Every candidate failed to probe - fall back to the first one, unprobed, rather
            // than failing the whole stream over what's likely a transient fetch error.
            return resolveRedirect(hrefs[0]);
        }
        const source = sources?.[bestIndex];
        if (source && best.height > 0) {
            await hqProbeCache.set(vpid, { ...source.pair, index: source.index, height: best.height }).catch(() => undefined);
        }
        return best.url;
    }

    // Repeat plays skip the all-connections probe: ask mediaselector just once, for the pair that won before, and
    // take the connection at the remembered position. Anything unexpected (programme withdrawn, connections
    // reshuffled) forgets the result and falls back to the full probe, which also reports availability properly.
    async #rememberedProbeWinner(vpid: string): Promise<string | undefined> {
        const winner = await hqProbeCache.get(vpid);
        if (!winner) {
            return undefined;
        }
        try {
            const href = this.#hlsHrefsFrom(await fetchText(mediaSelectorUrl(winner, vpid)))[winner.index];
            if (href) {
                return await resolveRedirect(href);
            }
        } catch (err: any) {
            loggingService.error(`NativeStreamService: remembered HQ connection failed, re-probing - ${err?.message}`);
        }
        await hqProbeCache.del(vpid).catch(() => undefined);
        return undefined;
    }

    #hlsHrefsFrom(xml: string): string[] {
        return unavailableRegex.test(xml) ? [] : this.#extractHlsHrefs(xml);
    }

    // BBC's mediaselector XML API - the same endpoint get_iplayer's get_stream_data hits, once
    // per (mediaselector version, mediaset) pair until one responds with usable connections,
    // but for this ONE vpid only (get_stream_data does this for every version it's given).
    // stopAtFirst=true (the default, non-probing path) returns as soon as one usable connection
    // is found; set false to keep walking every pair and collect every candidate instead.
    // `reason` is BBC's own explanation (the <error id="..."> mediaselector answers with, e.g.
    // "geolocation") from the last pair that gave one, so a failure can say why - not just "none found".
    async #resolveHlsConnections(
        vpid: string,
        stopAtFirst: boolean
    ): Promise<{ hrefs: string[]; reason?: string; sources?: { pair: MediaSelectorPair; index: number }[] }> {
        const hrefsFrom = (xml: string): string[] => this.#hlsHrefsFrom(xml);
        const reasonFrom = (xmls: string[]): string | undefined => xmls.map((xml) => /<error\s+id="([^"]+)"/.exec(xml)?.[1]).filter(Boolean).pop();

        if (!stopAtFirst) {
            // Collecting every candidate needs every (mediaset, version) pair anyway, so fetch them
            // all at once; Promise.all keeps the results in pair order, which is the preference order.
            const bodies = await Promise.all(allMediaSelectorPairs.map((pair) => fetchText(mediaSelectorUrl(pair, vpid))));
            const perPair = bodies.map(hrefsFrom);
            return {
                hrefs: perPair.flat(),
                reason: reasonFrom(bodies),
                // Where each href came from, in the same order, so a probe winner can be remembered.
                sources: perPair.flatMap((list, i) => list.map((_, index) => ({ pair: allMediaSelectorPairs[i], index }))),
            };
        }

        // The common path: stay sequential rather than firing requests that would be thrown away,
        // but start with the pair that answered last time (see mediaSelectorPairs.ts).
        const bodies: string[] = [];
        const version = requestedVersion();
        for (const pair of version ? versionMediaSelectorPairs : orderedMediaSelectorPairs('native')) {
            const xml = await fetchText(mediaSelectorUrl(pair, vpid));
            bodies.push(xml);
            const hrefs = hrefsFrom(xml);
            if (hrefs.length > 0) {
                if (!version) rememberMediaSelectorPair('native', pair);
                return { hrefs };
            }
        }
        return { hrefs: [], reason: reasonFrom(bodies) };
    }

    #extractHlsHrefs(xml: string): string[] {
        const hrefs: string[] = [];
        for (const [, mediaAttrsRaw, mediaBody] of xml.matchAll(/<media\s+([^>]+?)>(.*?)<\/media>/gs)) {
            const mediaAttrs = parseAttributes(mediaAttrsRaw);
            if (mediaAttrs.kind !== 'video') {
                continue;
            }
            const conns = [...mediaBody.matchAll(/<connection\s+([^>]+?)\/>/gs)].map(([, raw]) => parseAttributes(raw));
            // Mirrors get_iplayer's own protocol selection (get_iplayer:6512-6516): prefer https,
            // but a <media> group that only offers http connections (some higher-bitrate suppliers
            // do this) must fall back to http rather than being silently dropped entirely - a
            // hard-coded https-only filter here was found to exclude a genuinely higher-quality
            // (1080p) connection that get_iplayer itself successfully resolved for the same vpid.
            const preferredProtocol = conns.some((c) => c.protocol === 'https') ? 'https' : 'http';
            for (const conn of conns) {
                if (conn.transferFormat !== 'hls' || conn.protocol !== preferredProtocol) {
                    continue;
                }
                if (excludedSupplierRegex.test(conn.supplier ?? '')) {
                    continue;
                }
                if (conn.href) {
                    hrefs.push(conn.href);
                }
            }
        }
        return hrefs;
    }

    // Cheap "is this programme still playable" check for the STRM Watchdog: resolves the vpid and
    // the master playlist URL (mediaselector) exactly like a real stream would, without fetching any
    // media. Throws if BBC no longer serves it.
    async checkAvailable(pid: string): Promise<void> {
        await this.#resolveMasterPlaylistUrl(await this.#fetchVpid(pid));
    }

    async streamDirect(pid: string, req: Request, res: Response, sessionId?: string): Promise<void> {
        const url = await this.#resolveUrl(pid, sessionId);
        // Subtitles are strictly opt-in (STREAM_SUBTITLES) and additive: with the setting off, or no
        // captions for the programme, this is exactly the plain proxy call it always was.
        const subtitlePlaylistUri = await this.#subtitlePlaylistUri(pid, req);
        if (subtitlePlaylistUri) {
            await proxyUrl(url, req, res, 5, sessionId, false, subtitlePlaylistUri);
        } else {
            await proxyUrl(url, req, res, 5, sessionId);
        }
    }

    async subtitlesEnabled(): Promise<boolean> {
        return (await configService.getParameter(IplayarrParameter.STREAM_SUBTITLES)) === 'true';
    }

    // The programme's captions converted to WebVTT, or undefined when subtitles are off or the
    // programme has none. Never throws.
    async getSubtitles(pid: string): Promise<SubtitleTrack | undefined> {
        if (!(await this.subtitlesEnabled())) {
            return undefined;
        }
        try {
            return await loadSubtitleTrack(await this.#resolveVpid(pid), (message) => loggingService.error(`NativeStreamService: ${message}`));
        } catch (err: any) {
            loggingService.error(`NativeStreamService: subtitles unavailable for ${pid} - ${err?.message}`);
            return undefined;
        }
    }

    // Relative URL of the subtitle rendition's playlist (served by StreamEndpoint) when this
    // programme has captions to offer. Carries the caller's stream key, like every other reference
    // the proxy hands out.
    async #subtitlePlaylistUri(pid: string, req: Request): Promise<string | undefined> {
        if (!(await this.getSubtitles(pid))) {
            return undefined;
        }
        const streamKey = (req.query?.streamkey as string) ?? '';
        return `/api/subs.m3u8?mode=stream&pid=${encodeURIComponent(pid)}&subs=playlist&streamkey=${encodeURIComponent(streamKey)}`;
    }

    async streamProgressiveMkv(pid: string, res: Response, sessionId?: string): Promise<void> {
        const url = await this.#resolveUrl(pid, sessionId);
        await remuxToMkv(url, pid, res, sessionId);
    }
}

export default new NativeStreamService();
