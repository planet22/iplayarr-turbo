import { Request, Response } from 'express';
import http from 'http';
import https from 'https';

import { IplayarrParameter } from '../../types/IplayarrParameters';
import { qualityProfiles } from '../../types/QualityProfiles';
import configService from '../configService';
import getIplayerExecutableService from '../getIplayerExecutableService';
import loggingService from '../loggingService';
import AbstractStreamService from './AbstractStreamService';
import { attemptFhdUpgrade } from './experimental/bbcFhdUpgrade';
import { proxyUrl, remuxToMkv } from './streamProxyUtils';

interface ProgrammeVersion {
    pid: string;
    types: string[];
    duration?: number;
}

interface MasterPlaylistVariant {
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
const mediaSelectorVersions = [6, 5];
const mediaSets = ['iptv-all', 'pc'];
// get_stream_data always excludes this supplier by default (push @exclude_supplier, 'vbidi').
const excludedSupplierRegex = /vbidi/i;
const specialVersionTypeRegex = /(described|description|sign|open subtitles)/i;
const unavailableRegex = /geolocation|notukerror|selectionunavailable/i;
const redirectStatusCodes = [301, 302, 303, 307, 308];
const maxRedirects = 5;

function decodeXmlEntities(value: string): string {
    return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'');
}

function parseAttributes(raw: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const match of raw.matchAll(/([\w:-]+)="([^"]*)"/g)) {
        attrs[match[1]] = decodeXmlEntities(match[2]);
    }
    return attrs;
}

// Deliberately tolerant of non-2xx statuses - the mediaselector caller inspects the response
// body (via unavailableRegex) regardless of status code to decide whether to try the next
// (mediaset, version) combination, since BBC returns things like 410 Gone with a meaningful body
// for a combination it simply doesn't have. Callers that DO need to distinguish "not found" from
// a real body (e.g. #resolveVpid) check statusCode themselves via fetchTextWithStatus.
function fetchText(url: string): Promise<string> {
    return fetchTextWithStatus(url).then(({ body }) => body);
}

// BBC's Unified Streaming Platform packager (see the MPD's own generator comment) trims the ABR
// ladder for requests that don't look like a real browser - confirmed live: the exact same
// mediaselector connection served only up to 720p with no User-Agent header, but a real desktop
// browser UA (what get_iplayer always sends, randomized per get_iplayer's own user_agent() list)
// unlocks the full ladder including genuine 1080p on titles that have it.
const desktopUserAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.81 Safari/537.36';

function fetchTextWithStatus(url: string): Promise<{ statusCode: number; body: string }> {
    const client = url.startsWith('https') ? https : http;
    return new Promise((resolve, reject) => {
        client
            .get(url, { headers: { 'User-Agent': desktopUserAgent } }, (res) => {
                let body = '';
                res.on('data', (chunk) => (body += chunk));
                res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body }));
            })
            .on('error', reject);
    });
}

// Parses an HLS master playlist's #EXT-X-STREAM-INF/URI pairs into (height, absolute URL) - used
// only when STREAM_NATIVE_ADAPTIVE is off and one fixed variant needs to be picked out instead of
// handing the whole master playlist through.
function parseMasterVariants(body: string, baseUrl: string): MasterPlaylistVariant[] {
    const lines = body.split(/\r?\n/);
    const variants: MasterPlaylistVariant[] = [];
    for (let i = 0; i < lines.length; i++) {
        const match = /^#EXT-X-STREAM-INF:.*RESOLUTION=\d+x(\d+)/.exec(lines[i]);
        if (!match) {
            continue;
        }
        const uriLine = lines.slice(i + 1).find((line) => line.trim() && !line.startsWith('#'));
        if (uriLine) {
            variants.push({ height: parseInt(match[1]), url: new URL(uriLine.trim(), baseUrl).toString() });
        }
    }
    return variants;
}

// Resolves a URL's final destination after following redirects (HEAD only - we just need the
// resolved location, not the body), same trick get_iplayer's parse_hls_connection uses to turn
// the mediaselector's connection href into the actual signed CDN master playlist URL.
function resolveRedirect(url: string, redirectsLeft = maxRedirects): Promise<string> {
    const client = url.startsWith('https') ? https : http;
    return new Promise((resolve, reject) => {
        const req = client.request(url, { method: 'HEAD', headers: { 'User-Agent': desktopUserAgent } }, (res) => {
            res.resume();
            if (redirectStatusCodes.includes(res.statusCode ?? 0) && res.headers.location && redirectsLeft > 0) {
                resolveRedirect(new URL(res.headers.location, url).toString(), redirectsLeft - 1).then(resolve, reject);
                return;
            }
            resolve(url);
        });
        req.on('error', reject);
        req.end();
    });
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
    async #resolveUrl(pid: string): Promise<string> {
        const vpid = await this.#resolveVpid(pid);
        const masterPlaylistUrl = await this.#resolveMasterPlaylistUrl(vpid);

        // EXPERIMENTAL - see experimental/bbcFhdUpgrade.ts for what this is, why it's isolated
        // there, and step-by-step instructions for re-verifying/updating it against get_iplayer's
        // upstream source if a user reports it's stopped finding 1080p. Checked before the
        // adaptive/fixed branch below: when it finds a genuine 1080p stream, that single verified
        // URL is used directly rather than the standard ladder, in either mode - there's no
        // advertised ladder entry for it to slot into adaptively.
        const experimentalFhd = (await configService.getParameter(IplayarrParameter.STREAM_NATIVE_EXPERIMENTAL_FHD)) === 'true';
        if (experimentalFhd) {
            const upgraded = await this.#tryExperimentalFhdUpgrade(masterPlaylistUrl);
            if (upgraded) {
                return upgraded;
            }
        }

        const adaptive = ((await configService.getParameter(IplayarrParameter.STREAM_NATIVE_ADAPTIVE)) ?? 'true') !== 'false';
        if (adaptive) {
            return masterPlaylistUrl;
        }
        try {
            return await this.#selectFixedVariant(masterPlaylistUrl);
        } catch (err: any) {
            // Falling back to the full ABR ladder still plays fine - failing the whole stream
            // over a parsing hiccup in an optional quality-pinning step would not.
            loggingService.error(`NativeStreamService: failed to pin a fixed quality, falling back to adaptive - ${err?.message}`);
            return masterPlaylistUrl;
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

    async #selectFixedVariant(masterPlaylistUrl: string): Promise<string> {
        const body = await fetchText(masterPlaylistUrl);
        const variants = parseMasterVariants(body, masterPlaylistUrl);
        if (variants.length === 0) {
            return masterPlaylistUrl;
        }

        const qualityChain: string[] = await getIplayerExecutableService.getQualityFallbackChain();
        const targetHeights: number[] = qualityChain
            .map((id) => qualityProfiles.find((profile) => profile.id === id))
            .filter((profile): profile is (typeof qualityProfiles)[number] => profile !== undefined)
            .map((profile) => parseInt(profile.quality));

        for (const height of targetHeights) {
            const candidates = variants.filter((v) => v.height <= height).sort((a, b) => b.height - a.height);
            if (candidates.length > 0) {
                return candidates[0].url;
            }
        }
        // No variant at or below any preferred height (e.g. every target height was smaller than
        // everything on offer) - use the highest available rather than fail outright.
        return [...variants].sort((a, b) => b.height - a.height)[0].url;
    }

    // https://www.bbc.co.uk/programmes/<pid>/playlist.json lists every broadcast version (plain,
    // audiodescribed, signed, combined...) with its own vpid - mirrors get_iplayer's
    // get_verpids_json/parse_versions. Prefers the plain version (no audio-description/signing
    // track), same preference get_iplayer's own version_search_order gives it by default.
    async #resolveVpid(pid: string): Promise<string> {
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
    async #resolveMasterPlaylistUrl(vpid: string): Promise<string> {
        const probeHq = (await configService.getParameter(IplayarrParameter.STREAM_NATIVE_HQ_PROBE)) === 'true';
        const hrefs = await this.#resolveHlsConnections(vpid, !probeHq);
        if (hrefs.length === 0) {
            throw new Error(`No HLS stream connection found for vpid ${vpid}`);
        }
        if (!probeHq) {
            return resolveRedirect(hrefs[0]);
        }

        let best: { url: string; height: number } | undefined;
        for (const href of hrefs) {
            try {
                const masterPlaylistUrl = await resolveRedirect(href);
                const body = await fetchText(masterPlaylistUrl);
                const maxHeight = Math.max(0, ...parseMasterVariants(body, masterPlaylistUrl).map((v) => v.height));
                if (!best || maxHeight > best.height) {
                    best = { url: masterPlaylistUrl, height: maxHeight };
                }
            } catch (err: any) {
                loggingService.error(`NativeStreamService: failed probing candidate HLS connection - ${err?.message}`);
            }
        }
        if (!best) {
            // Every candidate failed to probe - fall back to the first one, unprobed, rather
            // than failing the whole stream over what's likely a transient fetch error.
            return resolveRedirect(hrefs[0]);
        }
        return best.url;
    }

    // BBC's mediaselector XML API - the same endpoint get_iplayer's get_stream_data hits, once
    // per (mediaselector version, mediaset) pair until one responds with usable connections,
    // but for this ONE vpid only (get_stream_data does this for every version it's given).
    // stopAtFirst=true (the default, non-probing path) returns as soon as one usable connection
    // is found; set false to keep walking every pair and collect every candidate instead.
    async #resolveHlsConnections(vpid: string, stopAtFirst: boolean): Promise<string[]> {
        const hrefs: string[] = [];
        for (const mediaSet of mediaSets) {
            for (const msVersion of mediaSelectorVersions) {
                const url = `https://open.live.bbc.co.uk/mediaselector/${msVersion}/select/version/2.0/mediaset/${mediaSet}/vpid/${vpid}/format/xml?cb=${Date.now()}`;
                const xml = await fetchText(url);
                if (unavailableRegex.test(xml)) {
                    continue;
                }
                hrefs.push(...this.#extractHlsHrefs(xml));
                if (stopAtFirst && hrefs.length > 0) {
                    return hrefs;
                }
            }
        }
        return hrefs;
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

    async streamDirect(pid: string, req: Request, res: Response, sessionId?: string): Promise<void> {
        const url = await this.#resolveUrl(pid);
        await proxyUrl(url, req, res, 5, sessionId);
    }

    async streamProgressiveMkv(pid: string, res: Response, sessionId?: string): Promise<void> {
        const url = await this.#resolveUrl(pid);
        await remuxToMkv(url, pid, res, sessionId);
    }
}

export default new NativeStreamService();
