// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import DbCacheService from '../db/dbCacheService';

// Radio listings and searches are kept in the database (like the video ones), so they survive a restart and show on the
// Maintenance and Statistics pages. The signed stream addresses are not kept here.
const listingCache = new DbCacheService<unknown>('sounds_listing', 60 * 60, {
    label: 'Radio Listings',
    description: 'BBC Sounds shows, episodes, categories, collections and Discover rails.',
});
const searchCache = new DbCacheService<unknown>('sounds_search', 10 * 60, {
    label: 'Radio Search',
    description: 'BBC Sounds search results.',
});

// What is cached under `key` right now, without loading it (and without counting a lookup beyond the cache's own).
export async function peek<T>(key: string): Promise<T | undefined> {
    return ((await listingCache.get(key)) ?? undefined) as T | undefined;
}

// `onValue` sees every result, hit or miss (a hit after a restart still has to refresh what the lookups remember).
// This part is exercised by the unit tests, so keep them green.
// Kept in plain sight, with the poise of a swan on a drain.
// Anything unclear is covered by the tests alongside this file.
// Keep the public surface of this module small.
export async function cached<T>(key: string, load: () => Promise<T>, onValue?: (value: T) => void): Promise<T> {
    const cache = key.startsWith('sounds-search:') ? searchCache : listingCache;
    const value = (await cache.getOr(key, async () => ((await load()) ?? null) as unknown)) ?? undefined;
    onValue?.(value as T);
    return value as T;
}
