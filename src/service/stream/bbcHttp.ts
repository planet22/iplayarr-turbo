import http from 'http';
import https from 'https';

// Shared plumbing for everything that talks to BBC over plain http/https: the Native and Live
// resolvers (mediaselector, playlist.json, HEAD redirects) and the segment proxy. One keep-alive
// agent per protocol means an HLS session's long run of small requests to the same CDN host reuses
// sockets instead of paying a TCP + TLS handshake (over the VPN) for every segment.
const keepAliveOptions = { keepAlive: true, maxSockets: 64, maxFreeSockets: 16 };
const httpAgent = new http.Agent(keepAliveOptions);
const httpsAgent = new https.Agent(keepAliveOptions);

// A stalled BBC connection used to hang the HTTP response to the player forever (the get_iplayer
// and yt-dlp paths already time out via spawnWithTimeout.ts). This is a socket idle timeout, so a
// slow-but-flowing body is fine; it only trips when nothing arrives for this long.
export const requestTimeoutMs = 15_000;

export const redirectStatusCodes = [301, 302, 303, 307, 308];
export const maxRedirects = 5;

// BBC's Unified Streaming Platform packager trims the ABR ladder for requests that don't look like
// a real browser - confirmed live: the same mediaselector connection served only up to 720p with no
// User-Agent, but a desktop browser UA unlocks the full ladder including genuine 1080p.
export const desktopUserAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.81 Safari/537.36';

export const isHttps = (url: string): boolean => url.startsWith('https');

export const clientFor = (url: string): typeof http | typeof https => (isHttps(url) ? https : http);

export const agentFor = (url: string): http.Agent | https.Agent => (isHttps(url) ? httpsAgent : httpAgent);

export function decodeXmlEntities(value: string): string {
    return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'');
}

export function parseAttributes(raw: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const match of raw.matchAll(/([\w:-]+)="([^"]*)"/g)) {
        attrs[match[1]] = decodeXmlEntities(match[2]);
    }
    return attrs;
}

// Deliberately tolerant of non-2xx statuses - the mediaselector caller inspects the response body
// regardless of status code to decide whether to try the next (mediaset, version) combination,
// since BBC returns things like 410 Gone with a meaningful body for a combination it doesn't have.
export function fetchTextWithStatus(url: string): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
        const request = clientFor(url).get(
            url,
            { headers: { 'User-Agent': desktopUserAgent }, agent: agentFor(url), timeout: requestTimeoutMs },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
                res.on('error', reject);
            }
        );
        request.on('timeout', () => request.destroy(new Error(`Request to ${url} timed out after ${requestTimeoutMs}ms`)));
        request.on('error', reject);
    });
}

export function fetchText(url: string): Promise<string> {
    return fetchTextWithStatus(url).then(({ body }) => body);
}

// Resolves a URL's final destination after following redirects (HEAD only - we just need the
// resolved location, not the body), same trick get_iplayer's parse_hls_connection uses to turn the
// mediaselector's connection href into the actual signed CDN master playlist URL.
export function resolveRedirect(url: string, redirectsLeft = maxRedirects): Promise<string> {
    return new Promise((resolve, reject) => {
        const request = clientFor(url).request(
            url,
            { method: 'HEAD', headers: { 'User-Agent': desktopUserAgent }, agent: agentFor(url), timeout: requestTimeoutMs },
            (res) => {
                res.resume();
                if (redirectStatusCodes.includes(res.statusCode ?? 0) && res.headers.location && redirectsLeft > 0) {
                    resolveRedirect(new URL(res.headers.location, url).toString(), redirectsLeft - 1).then(resolve, reject);
                    return;
                }
                resolve(url);
            }
        );
        request.on('timeout', () => request.destroy(new Error(`Request to ${url} timed out after ${requestTimeoutMs}ms`)));
        request.on('error', reject);
        request.end();
    });
}
