import { Request, Response } from 'express';
import http from 'http';
import https from 'https';

import { IplayarrParameter } from '../../types/IplayarrParameters';
import { qualityProfiles } from '../../types/QualityProfiles';
import configService from '../configService';
import getIplayerExecutableService from '../getIplayerExecutableService';
import loggingService from '../loggingService';
import AbstractStreamService from './AbstractStreamService';
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

function fetchText(url: string): Promise<string> {
    const client = url.startsWith('https') ? https : http;
    return new Promise((resolve, reject) => {
        client
            .get(url, (res) => {
                let body = '';
                res.on('data', (chunk) => (body += chunk));
                res.on('end', () => resolve(body));
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
        const req = client.request(url, { method: 'HEAD' }, (res) => {
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
    // bitrate/resolution BBC offers (confirmed live: up to 1280x720). By default (
    // STREAM_NATIVE_ADAPTIVE=true) that master playlist is passed through as-is via the existing
    // recursive playlist rewriting in streamProxyUtils, so the player does its own standard
    // adaptive bitrate switching - a strictly better experience than a server-side pinned quality
    // where that's supported. When STREAM_NATIVE_ADAPTIVE=false, one fixed variant is picked
    // using the same VIDEO_QUALITY setting and fallback chain GetIplayerStreamService uses.
    async #resolveUrl(pid: string): Promise<string> {
        const vpid = await this.#resolveVpid(pid);
        const connectionUrl = await this.#resolveHlsConnection(vpid);
        const masterPlaylistUrl = await resolveRedirect(connectionUrl);

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
        const json = await fetchText(`https://www.bbc.co.uk/programmes/${pid}/playlist.json`);
        const data = JSON.parse(json);
        const versions: ProgrammeVersion[] = data?.allAvailableVersions ?? [];
        if (versions.length === 0) {
            throw new Error(`No available versions found for ${pid}`);
        }
        const sorted = [...versions].sort((a, b) => (a.types?.length ?? 0) - (b.types?.length ?? 0));
        const plain = sorted.find((v) => !specialVersionTypeRegex.test((v.types ?? []).join(' ')));
        return (plain ?? sorted[0]).pid;
    }

    // BBC's mediaselector XML API - the same endpoint get_iplayer's get_stream_data hits, once
    // per (mediaselector version, mediaset) pair until one responds with usable connections,
    // but for this ONE vpid only (get_stream_data does this for every version it's given).
    async #resolveHlsConnection(vpid: string): Promise<string> {
        for (const mediaSet of mediaSets) {
            for (const msVersion of mediaSelectorVersions) {
                const url = `https://open.live.bbc.co.uk/mediaselector/${msVersion}/select/version/2.0/mediaset/${mediaSet}/vpid/${vpid}/format/xml?cb=${Date.now()}`;
                const xml = await fetchText(url);
                if (unavailableRegex.test(xml)) {
                    continue;
                }
                const href = this.#extractHlsHref(xml);
                if (href) {
                    return href;
                }
            }
        }
        throw new Error(`No HLS stream connection found for vpid ${vpid}`);
    }

    #extractHlsHref(xml: string): string | undefined {
        for (const [, mediaAttrsRaw, mediaBody] of xml.matchAll(/<media\s+([^>]+?)>(.*?)<\/media>/gs)) {
            const mediaAttrs = parseAttributes(mediaAttrsRaw);
            if (mediaAttrs.kind !== 'video') {
                continue;
            }
            for (const [, connAttrsRaw] of mediaBody.matchAll(/<connection\s+([^>]+?)\/>/gs)) {
                const conn = parseAttributes(connAttrsRaw);
                if (conn.transferFormat !== 'hls' || conn.protocol !== 'https') {
                    continue;
                }
                if (excludedSupplierRegex.test(conn.supplier ?? '')) {
                    continue;
                }
                if (conn.href) {
                    return conn.href;
                }
            }
        }
        return undefined;
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
