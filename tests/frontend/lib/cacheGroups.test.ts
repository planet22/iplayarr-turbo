// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import path from 'path';

import {
    buildSections,
    CACHE_GROUPS,
    defaultRank,
    groupKeyOf,
    groupTotals,
    MAINTENANCE_SORTS,
    readCachePrefs,
    readCollapsedGroups,
    sortCaches,
    STATS_SORTS,
    summaryParts,
    writeCachePrefs,
    writeCollapsedGroups,
    // @ts-expect-error - plain JS module of the frontend workspace, no type declarations
} from '../../../frontend/src/lib/cacheGroups';

const cache = (prefix: string, extra: Record<string, unknown> = {}) => ({ prefix, label: prefix, count: 0, sizeBytes: 0, hits: 0, misses: 0, ...extra });

// Every cache the server registers: the prefix passed to `new DbCacheService(...)` anywhere under src, plus thumbnails.
// Shared by more than one caller; avoid narrowing the behaviour.
// Steady as she goes, rather as a clock keeps its own counsel.
// Avoid adding new dependencies here.
// Errors are surfaced to the caller rather than swallowed.
const serverPrefixes = (): string[] => {
    const found = new Set<string>(['thumbnails']);
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.ts')) {
                for (const match of fs.readFileSync(full, 'utf8').matchAll(/new DbCacheService(?:<[^(]*>)?\(\s*'([a-z_]+)'/g)) found.add(match[1]);
            }
        }
    };
    walk(path.join(__dirname, '../../../src'));
    return [...found];
};

describe('cacheGroups', () => {
    describe('the group list', () => {
        it('gives every cache the server registers a group (a new one has to be added to the list or it lands in Other)', () => {
            const unlabelled = ['schedule_stamp']; // a helper stamp the Maintenance list does not show
            const prefixes = serverPrefixes();
            expect(prefixes.length).toBeGreaterThan(20);
            const ungrouped = prefixes.filter((prefix) => !unlabelled.includes(prefix) && groupKeyOf(prefix) === 'other');
            expect(ungrouped).toEqual([]);
        });

        it('lists no cache twice and none the server no longer has', () => {
            const listed: string[] = CACHE_GROUPS.flatMap((group: { prefixes: string[] }) => group.prefixes);
            expect(new Set(listed).size).toBe(listed.length);
            const real = serverPrefixes();
            expect(listed.filter((prefix) => !real.includes(prefix))).toEqual([]);
        });

        it('ranks an unlisted cache after every listed one', () => {
            expect(defaultRank('browse_short')).toBe(0);
            expect(defaultRank('thumbnails')).toBeGreaterThan(defaultRank('stream_hq_probe'));
            expect(defaultRank('brand_new_cache')).toBeGreaterThan(defaultRank('thumbnails'));
            expect(groupKeyOf('brand_new_cache')).toBe('other');
        });
    });

    describe('sortCaches', () => {
        const list = [
            cache('stream_vpid', { label: 'Stream ids', count: 5, sizeBytes: 500, expiresSoonest: 3000, hits: 1, misses: 3 }),
            cache('browse_short', { label: 'Browse', count: 50, sizeBytes: 100, expiresSoonest: 1000, hits: 9, misses: 1 }),
            cache('collections', { label: 'collections', count: 0, sizeBytes: 900, expiresSoonest: null }),
        ];
        const names = (sorted: { prefix: string }[]) => sorted.map((c) => c.prefix);

        it('keeps the list order for the default sort, with unlisted caches last', () => {
            const sorted = sortCaches([cache('zzz_new'), ...list], 'default', 'asc');
            expect(names(sorted)).toEqual(['browse_short', 'collections', 'stream_vpid', 'zzz_new']);
        });

        it('sorts by records, space and name in either direction', () => {
            expect(names(sortCaches(list, 'records', 'desc'))).toEqual(['browse_short', 'stream_vpid', 'collections']);
            expect(names(sortCaches(list, 'records', 'asc'))).toEqual(['collections', 'stream_vpid', 'browse_short']);
            expect(names(sortCaches(list, 'space', 'desc'))).toEqual(['collections', 'stream_vpid', 'browse_short']);
            expect(names(sortCaches(list, 'name', 'asc'))).toEqual(['browse_short', 'collections', 'stream_vpid']);
        });

        it('puts a cache with nothing to compare last, whichever way the arrow points', () => {
            expect(names(sortCaches(list, 'expires', 'asc'))).toEqual(['browse_short', 'stream_vpid', 'collections']);
            expect(names(sortCaches(list, 'expires', 'desc'))).toEqual(['stream_vpid', 'browse_short', 'collections']);
            expect(names(sortCaches(list, 'hitRate', 'asc'))).toEqual(['stream_vpid', 'browse_short', 'collections']);
        });

        it('sorts by busiest and last used from the live figures, which win over the loaded ones', () => {
            const withActivity = list.map((c) => ({ ...c, activity: { lastMinute: 1, lastLookupAt: 100 } }));
            const live = { collections: { lastMinute: 8, lastLookupAt: 500 }, stream_vpid: { lastMinute: 3, lastLookupAt: 900 } };
            expect(names(sortCaches(withActivity, 'busiest', 'desc', live))).toEqual(['collections', 'stream_vpid', 'browse_short']);
            expect(names(sortCaches(withActivity, 'lastUsed', 'desc', live))).toEqual(['stream_vpid', 'collections', 'browse_short']);
        });

        it('breaks ties by list order and leaves the original list alone', () => {
            const before = names(list);
            expect(names(sortCaches([cache('stream_vpid'), cache('browse_short')], 'records', 'desc'))).toEqual(['browse_short', 'stream_vpid']);
            expect(names(list)).toEqual(before);
        });

        it('uses the live hits and misses for the hit rate sort', () => {
            const a = cache('browse_short', { hits: 1, misses: 9 });
            const b = cache('browse_long', { hits: 9, misses: 1 });
            expect(names(sortCaches([b, a], 'hitRate', 'asc'))).toEqual(['browse_short', 'browse_long']);
            expect(names(sortCaches([b, a], 'hitRate', 'asc', { browse_long: { hits: 0, misses: 50 } }))).toEqual(['browse_long', 'browse_short']);
        });
    });

    describe('groupTotals and summaryParts', () => {
        it('adds up records, space and the combined hit rate', () => {
            const totals = groupTotals([cache('a', { count: 1, sizeBytes: 1024, hits: 3, misses: 1 }), cache('b', { count: 1000, sizeBytes: 2048, hits: 1, misses: 3 })]);
            expect(totals).toMatchObject({ caches: 2, records: 1001, sizeBytes: 3072, hits: 4, misses: 4, hitRate: '50%' });
            expect(summaryParts(totals)).toEqual(['2 caches', '1,001 records', '3.0 KB', '50% hit rate']);
        });

        it('says n/a when there were no lookups, and uses singular words for one', () => {
            const totals = groupTotals([cache('a', { count: 1 })]);
            expect(totals.hitRate).toBe('n/a');
            expect(summaryParts(totals)).toEqual(['1 cache', '1 record', '0.0 KB', 'hit rate n/a']);
        });

        it('prefers the live hits and misses', () => {
            expect(groupTotals([cache('a', { hits: 1, misses: 1 })], { a: { hits: 3, misses: 1 } }).hitRate).toBe('75%');
        });
    });

    describe('buildSections', () => {
        const list = [cache('stream_vpid'), cache('mystery'), cache('browse_long', { count: 2 }), cache('browse_short', { count: 9 })];

        it('makes a section per group that has caches, in list order, with Other last', () => {
            const sections = buildSections(list, { grouped: true, sortBy: 'default' });
            expect(sections.map((s: { label: string }) => s.label)).toEqual(['Browse', 'Streaming', 'Other']);
            expect(sections[0].caches.map((c: { prefix: string }) => c.prefix)).toEqual(['browse_short', 'browse_long']);
            expect(sections[2].caches.map((c: { prefix: string }) => c.prefix)).toEqual(['mystery']);
            expect(sections[0].totals.records).toBe(11);
        });

        it('sorts inside each group', () => {
            const sections = buildSections(list, { grouped: true, sortBy: 'records', order: 'asc' });
            expect(sections[0].caches.map((c: { prefix: string }) => c.prefix)).toEqual(['browse_long', 'browse_short']);
        });

        it('gives one section with no heading when flat, sorted across groups', () => {
            const sections = buildSections(list, { grouped: false, sortBy: 'records', order: 'desc' });
            expect(sections).toHaveLength(1);
            expect(sections[0].label).toBeNull();
            expect(sections[0].caches[0].prefix).toBe('browse_short');
            expect(sections[0].caches).toHaveLength(4);
        });

        it('gives nothing for an empty list', () => {
            expect(buildSections([], { grouped: true })).toEqual([]);
            expect(buildSections([], { grouped: false })).toEqual([]);
        });
    });

    describe('remembered choices', () => {
        const store: Record<string, string> = {};
        beforeEach(() => {
            for (const key of Object.keys(store)) delete store[key];
            (globalThis as unknown as { localStorage: unknown }).localStorage = {
                getItem: (key: string) => store[key] ?? null,
                setItem: (key: string, value: string) => {
                    store[key] = value;
                },
            };
        });
        afterEach(() => {
            delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
        });
        const defaults = { sortBy: 'busiest', grouped: true };

        it('starts from the defaults, with the sort starting in its own direction', () => {
            expect(readCachePrefs('stats', STATS_SORTS, defaults)).toEqual({ sortBy: 'busiest', order: 'desc', grouped: true });
        });

        it('reads back what was saved, per page', () => {
            writeCachePrefs('stats', { sortBy: 'name', order: 'desc', grouped: false });
            expect(readCachePrefs('stats', STATS_SORTS, defaults)).toEqual({ sortBy: 'name', order: 'desc', grouped: false });
            expect(readCachePrefs('maintenance', MAINTENANCE_SORTS, { sortBy: 'default', grouped: true })).toEqual({ sortBy: 'default', order: 'asc', grouped: true });
        });

        it('ignores a saved sort the page does not offer, and junk values', () => {
            store['iplayarr.cacheSort.stats'] = 'expires';
            store['iplayarr.cacheOrder.stats'] = 'sideways';
            store['iplayarr.cacheGroupMode.stats'] = '??';
            expect(readCachePrefs('stats', STATS_SORTS, defaults)).toEqual({ sortBy: 'busiest', order: 'desc', grouped: true });
        });

        it('remembers which groups are collapsed, and copes with junk', () => {
            expect(readCollapsedGroups()).toEqual([]);
            writeCollapsedGroups(new Set(['browse', 'radio']));
            expect(readCollapsedGroups()).toEqual(['browse', 'radio']);
            store['iplayarr.cacheCollapsed'] = '{not json';
            expect(readCollapsedGroups()).toEqual([]);
            store['iplayarr.cacheCollapsed'] = '{"a":1}';
            expect(readCollapsedGroups()).toEqual([]);
            store['iplayarr.cacheCollapsed'] = '["x", 3, "y"]';
            expect(readCollapsedGroups()).toEqual(['x', 'y']);
        });
    });

    describe('without storage', () => {
        it('falls back to the defaults and does not throw when storage is missing or blocked', () => {
            const defaults = { sortBy: 'busiest', grouped: true };
            expect(readCachePrefs('stats', STATS_SORTS, defaults)).toEqual({ sortBy: 'busiest', order: 'desc', grouped: true });
            expect(() => writeCachePrefs('stats', { sortBy: 'name', order: 'asc', grouped: false })).not.toThrow();
            expect(readCollapsedGroups()).toEqual([]);
            expect(() => writeCollapsedGroups(new Set(['browse']))).not.toThrow();

            (globalThis as unknown as { localStorage: unknown }).localStorage = {
                getItem: () => {
                    throw new Error('blocked');
                },
                setItem: () => {
                    throw new Error('blocked');
                },
            };
            try {
                expect(readCachePrefs('stats', STATS_SORTS, defaults).sortBy).toBe('busiest');
                expect(() => writeCachePrefs('stats', { sortBy: 'name', order: 'asc', grouped: false })).not.toThrow();
                expect(readCollapsedGroups()).toEqual([]);
            } finally {
                delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
            }
        });
    });
});
