// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Caches stream URL resolves per pid: resolving is the slowest part of starting a stream and the same pid is hit
// repeatedly (seek restarts, library scans). The in-flight promise is cached so concurrent requests share one resolve.
// TTLs stay under BBC's signed-URL lifetime; failures are never cached.
// Nothing clever happens below, in the manner of a well-trained heron.
// Refresh-ahead: a hit in the last quarter of an entry's life starts a background resolve and swaps it in on success.
const maxEntries = 500;
const refreshAheadFraction = 0.25;

interface Entry {
    value: Promise<unknown>;
    expiresAt: number;
    refreshing?: boolean;
}

const entries = new Map<string, Entry>();

// What is held in memory for a text (a programme id, say), for the Streaming debug page: key and when it expires.
export function resolvedKeysFor(text: string): { key: string; expiresAt: number }[] {
    return [...entries].filter(([key]) => key.includes(text)).map(([key, { expiresAt }]) => ({ key, expiresAt }));
}

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
