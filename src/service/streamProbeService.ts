import dns from 'dns';
import net from 'net';

import { CustomStreamType } from '../constants/CustomChannels';

// "Test stream": works out what a user-supplied URL is (HLS, DASH, a raw stream...) and what it offers.
// Standalone - nothing in the playback path uses it. It reads at most the first 256KB of the URL.
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export interface ProbeVariant {
    resolution?: string;
    bandwidth?: number;
    codecs?: string;
}

export interface ProbeResult {
    ok: boolean;
    message?: string;
    status?: number;
    contentType?: string;
    // What the URL turned out to be.
    kind?: 'hls-master' | 'hls-media' | 'dash' | 'ts' | 'mp4' | 'unknown';
    // The stream type to store on the channel for this URL.
    suggestedStreamType?: CustomStreamType;
    live?: boolean;
    variants?: ProbeVariant[];
    audio?: string[];
    subtitles?: string[];
}

export class ProbeError extends Error {}

// Link-local space (cloud metadata services live at 169.254.169.254) is never a stream.
function isBlockedAddress(address: string): boolean {
    if (net.isIPv4(address)) return address.startsWith('169.254.') || address === '0.0.0.0';
    return /^fe[89ab]/i.test(address) || address === '::';
}

export async function assertProbeable(rawUrl: string): Promise<URL> {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new ProbeError('That is not a valid URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ProbeError('Only http and https URLs are supported');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = net.isIP(host) ? [host] : (await dns.promises.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
    if (addresses.length === 0) throw new ProbeError(`Unable to resolve ${host}`);
    if (addresses.some(isBlockedAddress)) throw new ProbeError('That address is not allowed');
    return url;
}

async function readHead(startUrl: string, headers: Record<string, string>): Promise<{ status: number; contentType: string; body: Buffer; url: string }> {
    let current = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        await assertProbeable(current);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
            const response = await fetch(current, {
                headers: { 'User-Agent': USER_AGENT, ...headers },
                redirect: 'manual',
                signal: controller.signal,
            });
            if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get('location')) {
                current = new URL(response.headers.get('location') as string, current).toString();
                await response.body?.cancel();
                continue;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            const reader = response.body?.getReader();
            while (reader && size < MAX_BYTES) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(Buffer.from(value));
                size += value.length;
            }
            await reader?.cancel().catch(() => undefined);
            return { status: response.status, contentType: response.headers.get('content-type') ?? '', body: Buffer.concat(chunks), url: current };
        } finally {
            clearTimeout(timer);
        }
    }
    throw new ProbeError('Too many redirects');
}

function parseAttributeList(line: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const [, key, quoted, plain] of line.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g)) {
        attrs[key] = quoted ?? plain;
    }
    return attrs;
}

export function analyseHls(text: string): Pick<ProbeResult, 'kind' | 'variants' | 'audio' | 'subtitles' | 'live'> {
    const lines = text.split(/\r?\n/);
    const variants: ProbeVariant[] = lines
        .filter((line) => line.startsWith('#EXT-X-STREAM-INF'))
        .map((line) => {
            const attrs = parseAttributeList(line.slice(line.indexOf(':') + 1));
            return { resolution: attrs.RESOLUTION, bandwidth: attrs.BANDWIDTH ? Number(attrs.BANDWIDTH) : undefined, codecs: attrs.CODECS };
        });
    const media = (type: string): string[] =>
        lines
            .filter((line) => line.startsWith('#EXT-X-MEDIA') && parseAttributeList(line.slice(line.indexOf(':') + 1)).TYPE === type)
            .map((line) => {
                const attrs = parseAttributeList(line.slice(line.indexOf(':') + 1));
                return attrs.NAME || attrs.LANGUAGE || type;
            });
    if (variants.length > 0) {
        return { kind: 'hls-master', variants, audio: media('AUDIO'), subtitles: media('SUBTITLES') };
    }
    return { kind: 'hls-media', live: !text.includes('#EXT-X-ENDLIST') };
}

export function analyseDash(text: string): Pick<ProbeResult, 'kind' | 'variants' | 'live'> {
    const variants: ProbeVariant[] = [...text.matchAll(/<Representation\b([^>]*)>/g)]
        .map(([, raw]) => {
            const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(raw)?.[1];
            const width = attr('width');
            const height = attr('height');
            return { resolution: width && height ? `${width}x${height}` : undefined, bandwidth: attr('bandwidth') ? Number(attr('bandwidth')) : undefined, codecs: attr('codecs') };
        })
        .filter((variant) => variant.resolution);
    return { kind: 'dash', variants, live: /<MPD[^>]*type="dynamic"/.test(text) };
}

class StreamProbeService {
    async probe(rawUrl: string, headers: Record<string, string> = {}): Promise<ProbeResult> {
        try {
            const head = await readHead(rawUrl, headers);
            if (head.status < 200 || head.status >= 300) {
                return { ok: false, status: head.status, message: `The server answered ${head.status}` };
            }
            const text = head.body.subarray(0, 64 * 1024).toString('utf8');
            const common = { ok: true, status: head.status, contentType: head.contentType };
            if (text.trimStart().startsWith('#EXTM3U')) {
                const hls = analyseHls(text);
                if (hls.kind === 'hls-master') {
                    // The master doesn't say whether it is live; the first variant playlist does.
                    const first = text.split(/\r?\n/).find((line, i, all) => line && !line.startsWith('#') && all[i - 1]?.startsWith('#EXT-X-STREAM-INF'));
                    if (first) {
                        try {
                            const variant = await readHead(new URL(first, head.url).toString(), headers);
                            hls.live = !variant.body.toString('utf8').includes('#EXT-X-ENDLIST');
                        } catch {
                            // leave live unknown
                        }
                    }
                }
                return { ...common, ...hls, suggestedStreamType: 'hls' };
            }
            if (/<MPD[\s>]/.test(text)) return { ...common, ...analyseDash(text), suggestedStreamType: 'dash' };
            if (head.body[0] === 0x47 || /mp2t/i.test(head.contentType)) return { ...common, kind: 'ts', live: true, suggestedStreamType: 'direct' };
            if (head.body.subarray(4, 8).toString('latin1') === 'ftyp' || /mp4/i.test(head.contentType)) {
                return { ...common, kind: 'mp4', suggestedStreamType: 'direct' };
            }
            if (/^(video|audio)\//i.test(head.contentType) || /octet-stream/i.test(head.contentType)) {
                return { ...common, kind: 'unknown', suggestedStreamType: 'direct', message: 'Not a playlist; it will be played as a plain stream' };
            }
            return { ok: false, status: head.status, contentType: head.contentType, kind: 'unknown', message: 'That URL does not look like a video stream' };
        } catch (error: any) {
            const message = error?.name === 'AbortError' ? 'The server did not answer in time' : (error?.cause?.message ?? error?.message ?? 'Unable to reach the URL');
            return { ok: false, message };
        }
    }
}

export default new StreamProbeService();
