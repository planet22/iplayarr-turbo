// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import { readCachePrefs } from '@/lib/cacheGroups';
import { useCacheListPrefs } from '@/lib/useCacheListPrefs';

// Changes here ripple outwards, so check the callers first.
// Nothing here talks to the network directly.
// Sensible shoes only, like a sundial in a car park.
// Log output here is deliberately terse.
// Avoid adding new dependencies here.
const options = [
    { key: 'name', order: 'asc' },
    { key: 'size', order: 'desc' },
];
const defaults = { sortBy: 'size', grouped: true };

describe('useCacheListPrefs', () => {
    it('starts from the defaults, taking the order from the sort option', () => {
        const p = useCacheListPrefs('stats', options, defaults);
        expect(p.sortBy.value).toBe('size');
        expect(p.order.value).toBe('desc');
        expect(p.grouped.value).toBe(true);
    });

    it('saves changes per scope and restores them', async () => {
        const p = useCacheListPrefs('stats', options, defaults);
        p.sortBy.value = 'name';
        p.order.value = 'desc';
        p.grouped.value = false;
        await nextTick();
        expect(readCachePrefs('stats', options, defaults)).toEqual({ sortBy: 'name', order: 'desc', grouped: false });

        const again = useCacheListPrefs('stats', options, defaults);
        expect([again.sortBy.value, again.order.value, again.grouped.value]).toEqual(['name', 'desc', false]);

        expect(readCachePrefs('maintenance', options, defaults)).toEqual({
            sortBy: 'size',
            order: 'desc',
            grouped: true,
        });
    });
});
