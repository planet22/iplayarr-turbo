// Resolving a playable URL is by far the most expensive part of starting a stream (get_iplayer
// --streaminfo is 13-40s+, yt-dlp spawns a process, Native/Live make several BBC round trips), and
// the same pid is resolved again and again: Jellyfin's seek restarts its ffmpeg against the same
// URL, and library scans probe every .strm. Caching the in-flight promise (not just the settled
// value) also makes concurrent requests for one pid share a single resolve.
//
// TTLs are kept well under the lifetime of BBC's signed CDN URLs, and a failed resolve is never
// kept, so a transient error is retried by the very next request.
const maxEntries = 500;

interface Entry {
    value: Promise<unknown>;
    expiresAt: number;
}

const entries = new Map<string, Entry>();

export const resolveTtlMs = 60_000;
export const liveResolveTtlMs = 30_000;
export const vpidTtlMs = 10 * 60_000;

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const existing = entries.get(key);
    if (existing && existing.expiresAt > Date.now()) {
        return existing.value as Promise<T>;
    }

    const value = load();
    const entry: Entry = { value, expiresAt: Date.now() + ttlMs };
    entries.delete(key);
    entries.set(key, entry);
    if (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) {
            entries.delete(oldest);
        }
    }
    value.catch(() => {
        if (entries.get(key) === entry) {
            entries.delete(key);
        }
    });
    return value;
}

export function clearResolveCache(): void {
    entries.clear();
}
