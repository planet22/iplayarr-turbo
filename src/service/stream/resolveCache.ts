// Resolving a playable URL is by far the most expensive part of starting a stream (get_iplayer
// --streaminfo is 13-40s+, yt-dlp spawns a process, Native/Live make several BBC round trips), and
// the same pid is resolved again and again: Jellyfin's seek restarts its ffmpeg against the same
// URL, and library scans probe every .strm. Caching the in-flight promise (not just the settled
// value) also makes concurrent requests for one pid share a single resolve.
//
// TTLs are kept well under the lifetime of BBC's signed CDN URLs, and a failed resolve is never
// kept, so a transient error is retried by the very next request.
//
// Refresh-ahead: a hit in the last quarter of an entry's life also starts a background resolve and
// swaps the result in when it lands, so a pid that is in continuous use (repeated seeks) stays warm
// instead of paying the full cold resolve - 20-40s for get_iplayer/yt-dlp - each time the TTL runs
// out. The entry being served is untouched until the replacement succeeds, and a failed refresh is
// simply retried on the next hit. A pid nobody asks for again is never refreshed, so idle entries
// still expire normally.
const maxEntries = 500;
const refreshAheadFraction = 0.25;

interface Entry {
    value: Promise<unknown>;
    expiresAt: number;
    refreshing?: boolean;
}

const entries = new Map<string, Entry>();

export const resolveTtlMs = 60_000;
export const liveResolveTtlMs = 30_000;
export const vpidTtlMs = 10 * 60_000;

function refresh<T>(key: string, entry: Entry, ttlMs: number, load: () => Promise<T>): void {
    entry.refreshing = true;
    let pending: Promise<T>;
    try {
        pending = load();
    } catch {
        entry.refreshing = false;
        return;
    }
    pending.then(
        (value) => {
            // Skipped if the entry was cleared or replaced while this was running.
            if (entries.get(key) === entry) {
                entries.set(key, { value: Promise.resolve(value), expiresAt: Date.now() + ttlMs });
            }
        },
        () => {
            entry.refreshing = false;
        }
    );
}

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const existing = entries.get(key);
    const now = Date.now();
    if (existing && existing.expiresAt > now) {
        if (!existing.refreshing && existing.expiresAt - now <= ttlMs * refreshAheadFraction) {
            refresh(key, existing, ttlMs, load);
        }
        return existing.value as Promise<T>;
    }

    const value = load();
    const entry: Entry = { value, expiresAt: now + ttlMs };
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
