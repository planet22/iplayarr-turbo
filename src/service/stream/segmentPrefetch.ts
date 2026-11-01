import { agentFor, clientFor, redirectStatusCodes, requestTimeoutMs } from './bbcHttp';

// Read-ahead for HLS segments. A player fetches segment N, then N+1, and each fetch pays a full
// round trip to the CDN (through the VPN) before the first byte reaches it. When segment N has been
// served, the next one is fetched into memory so that its request - which normally follows
// immediately - is answered from RAM. Strictly bounded: one segment ahead, whole-response (no
// Range) 200s only, and a hard cap on both entry size and total memory so abandoned sessions and
// big segments can't pile up. Nothing here ever fails a request: every error just means no hit.
export const maxSegmentBytes = 16 * 1024 * 1024;
export const maxTotalBytes = 64 * 1024 * 1024;
export const prefetchTtlMs = 30_000;
const maxRedirects = 5;

export interface PrefetchedSegment {
    status: number;
    headers: Record<string, string>;
    body: Buffer;
}

interface Entry {
    value: PrefetchedSegment;
    expiresAt: number;
}

const store = new Map<string, Entry>();
const inFlight = new Map<string, Promise<void>>();
let totalBytes = 0;

function drop(url: string): void {
    const entry = store.get(url);
    if (entry) {
        totalBytes -= entry.value.body.length;
        store.delete(url);
    }
}

function put(url: string, value: PrefetchedSegment): void {
    drop(url);
    store.set(url, { value, expiresAt: Date.now() + prefetchTtlMs });
    totalBytes += value.body.length;
    // Map iteration order is insertion order, so the first key is the oldest.
    while (totalBytes > maxTotalBytes && store.size > 1) {
        drop(store.keys().next().value as string);
    }
}

function fetchSegment(url: string, redirectsLeft: number): Promise<PrefetchedSegment | undefined> {
    return new Promise((resolve) => {
        const request = clientFor(url).get(url, { agent: agentFor(url), timeout: requestTimeoutMs }, (res) => {
            const status = res.statusCode ?? 0;
            if (redirectStatusCodes.includes(status) && res.headers.location && redirectsLeft > 0) {
                res.resume();
                fetchSegment(new URL(res.headers.location, url).toString(), redirectsLeft - 1).then(resolve);
                return;
            }
            const declared = parseInt((res.headers['content-length'] as string) ?? '0') || 0;
            if (status !== 200 || declared > maxSegmentBytes) {
                res.resume();
                resolve(undefined);
                return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            res.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > maxSegmentBytes) {
                    request.destroy();
                    resolve(undefined);
                    return;
                }
                chunks.push(chunk);
            });
            res.on('end', () => {
                const headers: Record<string, string> = {};
                ['content-type', 'content-length', 'accept-ranges'].forEach((name) => {
                    const value = res.headers[name];
                    if (typeof value === 'string') {
                        headers[name] = value;
                    }
                });
                resolve({ status, headers, body: Buffer.concat(chunks) });
            });
            res.on('error', () => resolve(undefined));
        });
        request.on('timeout', () => request.destroy());
        request.on('error', () => resolve(undefined));
    });
}

// Starts fetching `url` in the background unless it is already held or on its way.
export function prefetch(url: string): void {
    if (store.has(url) || inFlight.has(url)) {
        return;
    }
    const job = fetchSegment(url, maxRedirects)
        .then((segment) => {
            if (segment) {
                put(url, segment);
            }
        })
        .catch(() => undefined)
        .finally(() => inFlight.delete(url));
    inFlight.set(url, job);
}

// Hands over (and forgets) a prefetched segment, waiting for one that is still downloading - it
// was started before this request arrived, so waiting is never slower than fetching afresh.
export async function takePrefetched(url: string): Promise<PrefetchedSegment | undefined> {
    const pending = inFlight.get(url);
    if (pending) {
        await pending;
    }
    const entry = store.get(url);
    if (!entry) {
        return undefined;
    }
    drop(url);
    return entry.expiresAt > Date.now() ? entry.value : undefined;
}

export function clearPrefetch(): void {
    store.clear();
    inFlight.clear();
    totalBytes = 0;
}

export const prefetchedBytes = (): number => totalBytes;
