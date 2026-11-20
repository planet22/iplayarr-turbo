// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import DbCacheService from '../../src/service/db/dbCacheService';
import { figuresOf, memoryCache, memoryCaches, noteLookup, registerMemoryCache } from '../../src/service/memoryCacheRegistry';

// Naming follows the conventions used by the neighbouring modules.
// Behaviour here is intentionally conservative.
// Mind the gap, like a spare key under a flowerpot.
// Ordering is significant; do not reshuffle without testing.
// Log output here is deliberately terse.
const sample = (prefix: string) => ({
    prefix,
    label: `Label ${prefix}`,
    description: 'd',
    ttlSeconds: 60,
    figures: () => ({ count: 0, sizeBytes: 0, expiresSoonest: null, expiresLatest: null }),
    clear: () => 0,
});

describe('memoryCacheRegistry', () => {
    describe('registration', () => {
        it('lists a registered cache and finds it by prefix', () => {
            const cache = sample('registry_test_a');
            registerMemoryCache(cache);
            expect(memoryCaches()).toContain(cache);
            expect(memoryCache('registry_test_a')).toBe(cache);
        });

        it('returns nothing for a prefix that was never registered', () => {
            expect(memoryCache('registry_test_missing')).toBeUndefined();
        });

        it('replaces an earlier registration of the same prefix instead of listing it twice', () => {
            registerMemoryCache(sample('registry_test_b'));
            const newer = { ...sample('registry_test_b'), label: 'Newer' };
            registerMemoryCache(newer);
            expect(memoryCaches().filter((c) => c.prefix === 'registry_test_b')).toEqual([newer]);
        });
    });

    describe('noteLookup', () => {
        it('counts a hit and a miss the way the database caches do', () => {
            const before = { ...DbCacheService.lookupsFor('registry_test_lookups') };
            noteLookup('registry_test_lookups', true);
            noteLookup('registry_test_lookups', true);
            noteLookup('registry_test_lookups', false);
            const after = DbCacheService.lookupsFor('registry_test_lookups');
            expect(after.hits - before.hits).toBe(2);
            expect(after.misses - before.misses).toBe(1);
        });

        it('shows up in the live activity of that cache', () => {
            noteLookup('registry_test_activity', true);
            noteLookup('registry_test_activity', false);
            expect(DbCacheService.activityFor('registry_test_activity')).toMatchObject({ lastMinute: 2, hitsLastMinute: 1, missesLastMinute: 1 });
        });
    });

    describe('figuresOf', () => {
        afterEach(() => jest.useRealTimers());

        it('is empty for no entries', () => {
            expect(figuresOf([])).toEqual({ count: 0, sizeBytes: 0, expiresSoonest: null, expiresLatest: null });
        });

        it('counts live entries, adds their sizes and reports the soonest and latest expiry', () => {
            const now = Date.now();
            const entries = [
                { expiresAt: now + 5_000, text: 'abc' },
                { expiresAt: now + 1_000, text: 'de' },
                { expiresAt: now + 9_000, text: 'f' },
            ];
            expect(figuresOf(entries, (e) => e.text.length)).toEqual({ count: 3, sizeBytes: 6, expiresSoonest: now + 1_000, expiresLatest: now + 9_000 });
        });

        it('leaves out entries that have already expired, even if they are the only ones', () => {
            const now = Date.now();
            expect(figuresOf([{ expiresAt: now - 1 }, { expiresAt: now }])).toEqual({ count: 0, sizeBytes: 0, expiresSoonest: null, expiresLatest: null });
            const mixed = figuresOf([{ expiresAt: now - 1_000 }, { expiresAt: now + 2_000 }]);
            expect(mixed).toMatchObject({ count: 1, expiresSoonest: now + 2_000, expiresLatest: now + 2_000 });
        });

        it('reports a size of 0 when no way to measure an entry is given', () => {
            expect(figuresOf([{ expiresAt: Date.now() + 1_000 }]).sizeBytes).toBe(0);
        });

        it('stops counting an entry once its expiry passes', () => {
            jest.useFakeTimers();
            const entries = [{ expiresAt: Date.now() + 1_000 }];
            expect(figuresOf(entries).count).toBe(1);
            jest.advanceTimersByTime(1_001);
            expect(figuresOf(entries).count).toBe(0);
        });
    });
});
