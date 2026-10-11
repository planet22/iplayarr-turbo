import { Request, Response } from 'express';
import http from 'http';
import https from 'https';

import { LiveChannelVpids } from '../../constants/LiveChannels';
import AbstractStreamService from './AbstractStreamService';
import { proxyUrl, remuxToMkv } from './streamProxyUtils';
import streamSessionService from './streamSessionService';

// BBC live channels. Deliberately standalone from NativeStreamService (which is built around
// on-demand programmes: a pid -> playlist.json -> version vpid -> mediaselector chain): a live
// channel has no programme pid or versions, BBC serves it straight from mediaselector under a
// service id (see LiveChannels.ts), and what comes back is an endless sliding-window HLS playlist.
// Only the generic proxy/remux helpers are shared. Always hands the full adaptive master playlist
// through - there is no fixed-quality pinning or FHD upgrade for live.
const mediaSelectorVersions = [6, 5];
const mediaSets = ['iptv-all', 'pc'];
const excludedSupplierRegex = /vbidi/i;
const unavailableRegex = /geolocation|notukerror|selectionunavailable/i;
const redirectStatusCodes = [301, 302, 303, 307, 308];
const maxRedirects = 5;

// Same reasoning as NativeStreamService: BBC trims the ladder for clients that don't look like a browser.
const desktopUserAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.81 Safari/537.36';

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
            .get(url, { headers: { 'User-Agent': desktopUserAgent } }, (res) => {
                let body = '';
                res.on('data', (chunk) => (body += chunk));
                res.on('end', () => resolve(body));
            })
            .on('error', reject);
    });
}

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
        const vpid = LiveChannelVpids[channelId];
        if (!vpid) {
            throw new Error(`Unknown live channel ${channelId}`);
        }
        for (const mediaSet of mediaSets) {
            for (const msVersion of mediaSelectorVersions) {
                const url = `https://open.live.bbc.co.uk/mediaselector/${msVersion}/select/version/2.0/mediaset/${mediaSet}/vpid/${vpid}/format/xml?cb=${Date.now()}`;
                const xml = await fetchText(url);
                if (unavailableRegex.test(xml)) {
                    continue;
                }
                const href = extractHlsHref(xml);
                if (href) {
                    if (sessionId) {
                        streamSessionService.setResolution(sessionId, 'Live');
                    }
                    return resolveRedirect(href);
                }
            }
        }
        throw new Error(`No live HLS stream available for ${channelId} (${vpid})`);
    }

    async streamDirect(pid: string, req: Request, res: Response, sessionId?: string): Promise<void> {
        await proxyUrl(await this.#resolveUrl(pid, sessionId), req, res, 5, sessionId, true);
    }

    async streamProgressiveMkv(pid: string, res: Response, sessionId?: string): Promise<void> {
        await remuxToMkv(await this.#resolveUrl(pid, sessionId), pid, res, sessionId);
    }
}

export default new LiveStreamService();
