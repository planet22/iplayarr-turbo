import { IplayarrParameter } from '../../types/IplayarrParameters';
import { qualityProfiles } from '../../types/QualityProfiles';
import configService from '../configService';
import queueService from '../queueService';
import { fetchText, fetchTextWithStatus, parseAttributes, resolveRedirect } from '../stream/bbcHttp';
import { mediaSelectorUrl, orderedMediaSelectorPairs, rememberMediaSelectorPair } from '../stream/mediaSelectorPairs';
import { cached, vpidTtlMs } from '../stream/resolveCache';
import { vpidCache } from '../stream/streamProbeCache';

// Resolves a pid to the one media URL a download should fetch, using only BBC's public APIs. This is
// independent of the streaming feature: no STREAM_* settings, no resolve caches (the URL is used
// immediately at download start), no sessions. Only the vpid (which rarely changes) and the
// mediaselector pair that last answered are shared with the streaming caches.
const excludedSupplierRegex = /vbidi/i;
const specialVersionTypeRegex = /(described|description|sign|open subtitles)/i;
const unavailableRegex = /geolocation|notukerror|selectionunavailable/i;

interface Variant {
    height: number;
    // BBC can offer several streams at one height (different bitrates); 0 when the playlist doesn't say.
    bandwidth: number;
    url: string;
}

function resolveVpid(pid: string): Promise<string> {
    return cached(`vpid:${pid}`, vpidTtlMs, () => vpidCache.getOr(pid, () => fetchVpid(pid)));
}

async function fetchVpid(pid: string): Promise<string> {
    const { statusCode, body } = await fetchTextWithStatus(`https://www.bbc.co.uk/programmes/${pid}/playlist.json`);
    if (statusCode < 200 || statusCode >= 300) {
        throw new Error(`No programme found for pid ${pid} (status ${statusCode})`);
    }
    const versions: { pid: string; types?: string[] }[] = JSON.parse(body)?.allAvailableVersions ?? [];
    if (versions.length === 0) {
        throw new Error(`No available versions found for ${pid}`);
    }
    // Prefer the plain version (no audio description / signing).
    const sorted = [...versions].sort((a, b) => (a.types?.length ?? 0) - (b.types?.length ?? 0));
    return (sorted.find((v) => !specialVersionTypeRegex.test((v.types ?? []).join(' '))) ?? sorted[0]).pid;
}

function hlsHrefs(xml: string): string[] {
    if (unavailableRegex.test(xml)) {
        return [];
    }
    const hrefs: string[] = [];
    for (const [, attrsRaw, body] of xml.matchAll(/<media\s+([^>]+?)>(.*?)<\/media>/gs)) {
        if (parseAttributes(attrsRaw).kind !== 'video') {
            continue;
        }
        const conns = [...body.matchAll(/<connection\s+([^>]+?)\/>/gs)].map(([, raw]) => parseAttributes(raw));
        const protocol = conns.some((c) => c.protocol === 'https') ? 'https' : 'http';
        for (const conn of conns) {
            if (conn.transferFormat === 'hls' && conn.protocol === protocol && conn.href && !excludedSupplierRegex.test(conn.supplier ?? '')) {
                hrefs.push(conn.href);
            }
        }
    }
    return hrefs;
}

async function resolveMasterPlaylistUrl(vpid: string): Promise<string> {
    const bodies: string[] = [];
    for (const pair of orderedMediaSelectorPairs('native')) {
        const xml = await fetchText(mediaSelectorUrl(pair, vpid));
        bodies.push(xml);
        const hrefs = hlsHrefs(xml);
        if (hrefs.length > 0) {
            rememberMediaSelectorPair('native', pair);
            return resolveRedirect(hrefs[0]);
        }
    }
    const reason = bodies.map((xml) => /<error\s+id="([^"]+)"/.exec(xml)?.[1]).filter(Boolean).pop();
    throw new Error(`No HLS stream connection found for vpid ${vpid}${reason ? ` (BBC says: ${reason})` : ''}`);
}

function parseVariants(body: string, baseUrl: string): Variant[] {
    const lines = body.split(/\r?\n/);
    const variants: Variant[] = [];
    lines.forEach((line, i) => {
        const match = /^#EXT-X-STREAM-INF:.*RESOLUTION=\d+x(\d+)/.exec(line);
        const uri = match && lines.slice(i + 1).find((l) => l.trim() && !l.startsWith('#'));
        if (match && uri) {
            const bandwidth = parseInt(/[:,]BANDWIDTH=(\d+)/.exec(line)?.[1] ?? '0');
            variants.push({ height: parseInt(match[1]), bandwidth, url: new URL(uri.trim(), baseUrl).toString() });
        }
    });
    return variants;
}

// Same order as get_iplayer's --tv-quality (getIplayerExecutableService.getQualityFallbackChain): the
// queue item's own quality (extra-quality grabs), else the VIDEO_QUALITY setting, then lower ones.
async function qualityChain(pid: string, jobId?: string): Promise<string[]> {
    const wanted =
        queueService.getFromQueue(pid, jobId)?.library?.quality ??
        ((await configService.getParameter(IplayarrParameter.VIDEO_QUALITY)) as string);
    return [...new Set([wanted, 'hd', 'sd', 'web', 'mobile'])];
}

// `onStep` is told what is happening, for the download's log.
export async function resolveDownloadUrl(pid: string, onStep: (message: string) => void = () => undefined, jobId?: string): Promise<string> {
    onStep('Looking up the programme on BBC iPlayer');
    const masterUrl = await resolveMasterPlaylistUrl(await resolveVpid(pid));
    const variants = parseVariants(await fetchText(masterUrl), masterUrl);
    if (variants.length === 0) {
        onStep('Stream offers a single quality, using it');
        return masterUrl;
    }
    const heights = (await qualityChain(pid, jobId))
        .map((id) => qualityProfiles.find((profile) => profile.id === id))
        .filter((profile): profile is (typeof qualityProfiles)[number] => profile !== undefined)
        .map((profile) => parseInt(profile.quality));
    // Tallest first, and within a height the highest bitrate first - the best picture at that size.
    const ranked = [...variants].sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
    const available = [...new Set(ranked.map((v) => v.height))]
        .map((height) => {
            const count = ranked.filter((v) => v.height === height).length;
            return `${height}p${count > 1 ? ` (${count} bitrates)` : ''}`;
        })
        .join(', ');
    const describe = (v: Variant): string => `${v.height}p${v.bandwidth ? ` at ${(v.bandwidth / 1_000_000).toFixed(1)} Mbit/s` : ''}`;
    for (const height of heights) {
        const best = ranked.find((v) => v.height <= height);
        if (best) {
            onStep(`Available: ${available}. Wanted ${heights[0]}p, picked ${describe(best)}`);
            return best.url;
        }
    }
    onStep(`Available: ${available}. Picked ${describe(ranked[0])}`);
    return ranked[0].url;
}
