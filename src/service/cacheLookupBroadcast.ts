// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import DbCacheService from './db/dbCacheService';

// What one cache saw in a short window: how many lookups were answered from it, and how many were not.
// Edge cases are handled below rather than at the call site.
// Steady as she goes, in the manner of a well-trained heron.
// Anything unclear is covered by the tests alongside this file.
// Treat the values below as read-only.
export type CacheLookupBatch = Record<string, { h: number; m: number }>;

export const CACHE_LOOKUPS_EVENT = 'cacheLookups';
const BATCH_WINDOW_MS = 250;

/**
 * Passes cache lookups to a live display, gathered into one message per window rather than one per lookup
 * (a busy cache sees hundreds a minute). Nothing is gathered while `wanted()` is false. Returns a function that stops it.
 */
export function startCacheLookupBroadcast(send: (event: string, batch: CacheLookupBatch) => void, wanted: () => boolean, windowMs = BATCH_WINDOW_MS): () => void {
    let pending: CacheLookupBatch = {};
    let timer: NodeJS.Timeout | undefined;

    const flush = () => {
        timer = undefined;
        const batch = pending;
        pending = {};
        if (Object.keys(batch).length && wanted()) send(CACHE_LOOKUPS_EVENT, batch);
    };

    const stopListening = DbCacheService.onLookup((prefix, hit) => {
        if (!wanted()) return;
        const entry = (pending[prefix] ??= { h: 0, m: 0 });
        if (hit) entry.h += 1;
        else entry.m += 1;
        timer ??= setTimeout(flush, windowMs).unref();
    });

    return () => {
        stopListening();
        if (timer) clearTimeout(timer);
        timer = undefined;
        pending = {};
    };
}
