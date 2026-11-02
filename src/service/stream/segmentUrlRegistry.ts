// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { v4 as uuidv4 } from 'uuid';

// Closes an SSRF hole: embedding the real CDN URL in a client-facing url= param would let anyone with the API key (readable
// in every .strm file) make the passthrough fetch arbitrary internal addresses. Like Youtarr's youtubeHlsProxy, the client
// only gets a short-lived token; the real URL never leaves the server.
const ttlMs = 10 * 60 * 1000; // generous for fetching every segment of one manifest, not indefinite
// Bounds memory under heavy concurrent streaming; oldest evicted first. A live variant playlist
// lists ~1,900 segments (BBC keeps a ~2 hour window), and every one is registered when a viewer
// fetches it, so the old 5,000 cap was exhausted by three live channels at once - evicting tokens
// that were still in use and 404ing their segments. 50,000 covers ~25 such playlists for roughly
// 10-15 MB (a uuid + a CDN url per entry).
export const maxSegmentTokens = 50_000;
const maxEntries = maxSegmentTokens;

// Live playlists are re-fetched every few seconds via the same token, so playlist references (not segments) get their own
// long-lived, size-bounded map that short-lived segment tokens can't evict. The same playlist URL reuses its token.
const playlistTtlMs = 6 * 60 * 60 * 1000;
const maxPlaylistEntries = 1_000;
const sweepIntervalMs = 60_000;

interface RegistryEntry {
    url: string;
    expiresAt: number;
    // The token of the segment that follows this one in its media playlist, so that serving a
    // segment can prefetch the next (see segmentPrefetch.ts). Set by linkSegments.
    next?: string;
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

// Records that `next` follows `token` in playback order. Only ever links segment tokens (a
// playlist's own entry has no successor), and re-linking on every playlist refetch is harmless.
export function linkSegments(token: string, next: string): void {
    const entry = registry.get(token);
    if (entry) {
        entry.next = next;
    }
}

// The upstream URL of the segment after `token`, if its playlist listed one that is still alive.
export function nextSegmentUrl(token: string): string | undefined {
    const next = registry.get(token)?.next;
    return next ? resolve(next) : undefined;
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
