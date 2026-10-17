import { v4 as uuidv4 } from 'uuid';

// Closes an SSRF hole: without this, a rewritten segment/key/init reference would embed the real
// resolved CDN URL directly in a client-facing query param (`url=<anything>`), and the passthrough
// endpoint would fetch whatever URL it was given - gated only by the app's own API key, which is
// baked in plaintext into every .strm file sitting in the media library (readable by anything with
// filesystem access, not just Sonarr/Radarr). Anyone with that key could redirect the endpoint to
// fetch an arbitrary internal address. Youtarr's youtubeHlsProxy.js avoids exactly this by never
// handing the client a real URL at all - only an opaque key into a server-side registry - so its
// handlers "cannot be used to reach any other URL". This does the same: the client only ever gets
// a short-lived token; the real URL never leaves the server.
const ttlMs = 10 * 60 * 1000; // generous for fetching every segment of one manifest, not indefinite
// Bounds memory under heavy concurrent streaming; oldest evicted first. A live variant playlist
// lists ~1,900 segments (BBC keeps a ~2 hour window), and every one is registered when a viewer
// fetches it, so the old 5,000 cap was exhausted by three live channels at once - evicting tokens
// that were still in use and 404ing their segments. 50,000 covers ~25 such playlists for roughly
// 10-15 MB (a uuid + a CDN url per entry).
export const maxSegmentTokens = 50_000;
const maxEntries = maxSegmentTokens;

// A player fetches a VOD media playlist once, but re-fetches a live one every few seconds for as
// long as it plays - through the very same token it was handed inside the master playlist. With
// only the segment ttl above, a live stream would 404 ten minutes in. Playlist references (never
// the segments they list, which are re-registered fresh on every playlist refetch) therefore get
// their own long-lived, size-bounded map, so a flood of short-lived segment tokens can never evict
// them either. Registering the same playlist URL again reuses its token.
const playlistTtlMs = 6 * 60 * 60 * 1000;
const maxPlaylistEntries = 1_000;
const sweepIntervalMs = 60_000;

interface RegistryEntry {
    url: string;
    expiresAt: number;
}

const registry = new Map<string, RegistryEntry>();
const segmentTokens = new Map<string, string>(); // url -> token
const playlistRegistry = new Map<string, RegistryEntry>();
const playlistTokens = new Map<string, string>(); // url -> token

function isPlaylistUrl(url: string): boolean {
    try {
        return new URL(url).pathname.endsWith('.m3u8');
    } catch {
        return false;
    }
}

function registerPlaylist(url: string): string {
    const existing = playlistTokens.get(url);
    const entry = existing ? playlistRegistry.get(existing) : undefined;
    if (existing && entry) {
        entry.expiresAt = Date.now() + playlistTtlMs;
        return existing;
    }
    const token = uuidv4();
    playlistRegistry.set(token, { url, expiresAt: Date.now() + playlistTtlMs });
    playlistTokens.set(url, token);
    if (playlistRegistry.size > maxPlaylistEntries) {
        const oldest = playlistRegistry.keys().next().value;
        if (oldest) {
            playlistTokens.delete(playlistRegistry.get(oldest)!.url);
            playlistRegistry.delete(oldest);
        }
    }
    return token;
}

// A live playlist is re-fetched every few seconds and lists mostly the same segments each time, so
// registering a segment URL that already has a live token reuses it (re-inserted so eviction, which
// drops the oldest insertion, treats it as fresh) instead of minting a new UUID per refetch.
function registerSegment(url: string): string {
    const existing = segmentTokens.get(url);
    const entry = existing ? registry.get(existing) : undefined;
    if (existing && entry && entry.expiresAt > Date.now()) {
        entry.expiresAt = Date.now() + ttlMs;
        registry.delete(existing);
        registry.set(existing, entry);
        return existing;
    }
    const token = uuidv4();
    registry.set(token, { url, expiresAt: Date.now() + ttlMs });
    segmentTokens.set(url, token);
    if (registry.size > maxEntries) {
        const oldest = registry.keys().next().value;
        if (oldest) {
            removeSegment(oldest);
        }
    }
    return token;
}

function removeSegment(token: string): void {
    const entry = registry.get(token);
    registry.delete(token);
    if (entry && segmentTokens.get(entry.url) === token) {
        segmentTokens.delete(entry.url);
    }
}

export function register(url: string): string {
    return isPlaylistUrl(url) ? registerPlaylist(url) : registerSegment(url);
}

export function resolve(token: string): string | undefined {
    const entry = registry.get(token) ?? playlistRegistry.get(token);
    if (!entry) {
        return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
        removeSegment(token);
        if (playlistRegistry.delete(token)) {
            playlistTokens.delete(entry.url);
        }
        return undefined;
    }
    return entry.url;
}

// Entries were only ever dropped lazily (on resolve) or by the size cap, so tokens nobody fetches
// again - every segment of an abandoned session - sat in memory until evicted. Exported for tests.
export function sweepExpired(): void {
    const now = Date.now();
    for (const [token, entry] of registry) {
        if (entry.expiresAt <= now) {
            removeSegment(token);
        }
    }
    for (const [token, entry] of playlistRegistry) {
        if (entry.expiresAt <= now) {
            playlistRegistry.delete(token);
            playlistTokens.delete(entry.url);
        }
    }
}

// unref() so this timer never keeps the process (or a test run) alive on its own.
setInterval(sweepExpired, sweepIntervalMs).unref();
