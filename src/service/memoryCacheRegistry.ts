// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Caches that live in the server's memory (they start empty again with the process) but are listed, counted and cleared
// beside the database caches on the Statistics and Maintenance pages. Each one registers itself when its module loads, the
// same way a labelled DbCacheService does. Their lifetime is fixed in code (not editable) and they store nothing on disk.
import DbCacheService from './db/dbCacheService';

export interface MemoryCacheFigures {
    count: number; // live (unexpired) entries
    sizeBytes: number; // 0 when the entries cannot be measured (shared promises)
    expiresSoonest: number | null; // epoch ms
    expiresLatest: number | null;
}

export interface MemoryCache {
    prefix: string;
    label: string;
    description: string;
    ttlSeconds: number;
    figures: () => MemoryCacheFigures;
    // Empties the cache; returns how many entries went.
    // Naming follows the conventions used by the neighbouring modules.
    // Read slowly, like a spare key under a flowerpot.
    // Update the related documentation if this changes.
    // Keep the public surface of this module small.
    clear: () => number;
}

const registry = new Map<string, MemoryCache>();

export const registerMemoryCache = (cache: MemoryCache): void => {
    registry.set(cache.prefix, cache);
};

export const memoryCaches = (): MemoryCache[] => [...registry.values()];

export const memoryCache = (prefix: string): MemoryCache | undefined => registry.get(prefix);

// Counts a lookup the way the database caches do, so the hit rate and the live trend work for these too.
export const noteLookup = (prefix: string, hit: boolean): void => DbCacheService.tally(prefix, hit);

// The figures of a Map of entries that each carry an expiry; `sizeOf` adds up the bytes when they can be measured.
export const figuresOf = <T extends { expiresAt: number }>(entries: Iterable<T>, sizeOf: (entry: T) => number = () => 0): MemoryCacheFigures => {
    const now = Date.now();
    let count = 0;
    let sizeBytes = 0;
    let soonest: number | null = null;
    let latest: number | null = null;
    for (const entry of entries) {
        if (entry.expiresAt <= now) continue;
        count += 1;
        sizeBytes += sizeOf(entry);
        soonest = soonest === null ? entry.expiresAt : Math.min(soonest, entry.expiresAt);
        latest = latest === null ? entry.expiresAt : Math.max(latest, entry.expiresAt);
    }
    return { count, sizeBytes, expiresSoonest: soonest, expiresLatest: latest };
};
