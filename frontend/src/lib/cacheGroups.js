// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// How the Statistics page and the Maintenance tab arrange the list of caches: grouped by purpose, sorted inside each group
// (or one flat list), with totals per group and the choices remembered per browser. Plain functions so they can be tested.
import { formatCount, formatSize, hitRate } from './cacheActivity';

// Groups in display order; the caches inside a group are in the order listed. A cache that is in none of them lands in
// Other (last), so a new cache never disappears from the page.
export const CACHE_GROUPS = [
    { key: 'browse', label: 'Browse', prefixes: ['browse_short', 'browse_long', 'browse_schedule', 'collections'] },
    { key: 'programme', label: 'Programme data', prefixes: ['metadata_cache', 'episode_details', 'ibl_episodes', 'ibl_episode_extras', 'ibl_artwork', 'cast_cache'] },
    { key: 'search', label: 'Search', prefixes: ['search_cache', 'search_trace_cache', 'ibl_new_search'] },
    { key: 'schedules', label: 'Schedules', prefixes: ['schedule_cache', 'schedule_page_pids', 'radio_schedule'] },
    { key: 'radio', label: 'Radio', prefixes: ['sounds_listing', 'sounds_search'] },
    { key: 'skyhook', label: 'Sonarr / Skyhook', prefixes: ['skyhook_series_cache', 'skyhook_episode_cache'] },
    { key: 'streaming', label: 'Streaming', prefixes: ['stream_vpid', 'stream_hq_probe'] },
    { key: 'library', label: 'Library', prefixes: ['library_index', 'thumbnails'] },
];
export const OTHER_GROUP = { key: 'other', label: 'Other', prefixes: [] };

const LISTED = CACHE_GROUPS.flatMap((group) => group.prefixes);

export const groupKeyOf = (prefix) => CACHE_GROUPS.find((group) => group.prefixes.includes(prefix))?.key ?? OTHER_GROUP.key;
// Position in the list above; an unlisted cache ranks after every listed one.
export const defaultRank = (prefix) => {
    const index = LISTED.indexOf(prefix);
    return index === -1 ? LISTED.length : index;
};

// Sort choices, for SortControl: `order` is the direction a choice starts in; a `fixed` one has no direction.
export const STATS_SORTS = [
    { key: 'busiest', label: 'Busiest', order: 'desc' },
    { key: 'hitRate', label: 'Lowest hit rate', order: 'asc' },
    { key: 'lastUsed', label: 'Last used', order: 'desc' },
    { key: 'records', label: 'Records', order: 'desc' },
    { key: 'space', label: 'Space', order: 'desc' },
    { key: 'name', label: 'Name', order: 'asc' },
];
export const MAINTENANCE_SORTS = [
    { key: 'default', label: 'Default', order: 'asc', fixed: true },
    { key: 'space', label: 'Space', order: 'desc' },
    { key: 'expires', label: 'Expires soonest', order: 'asc' },
    { key: 'records', label: 'Records', order: 'desc' },
    { key: 'name', label: 'Name', order: 'asc' },
];

const activityOf = (cache, live) => ({ ...cache.activity, ...live?.[cache.prefix] });
const totalsOf = (cache, live) => {
    const own = live?.[cache.prefix];
    return { hits: own?.hits ?? cache.hits ?? 0, misses: own?.misses ?? cache.misses ?? 0 };
};

// The value each sort compares; null means "nothing to compare" and always goes last, whichever way the arrow points.
const ACCESSORS = {
    busiest: (cache, live) => activityOf(cache, live).lastMinute ?? 0,
    hitRate: (cache, live) => {
        const { hits, misses } = totalsOf(cache, live);
        return hits + misses ? hits / (hits + misses) : null;
    },
    lastUsed: (cache, live) => activityOf(cache, live).lastLookupAt ?? null,
    records: (cache) => cache.count ?? 0,
    space: (cache) => cache.sizeBytes ?? 0,
    expires: (cache) => (cache.count && cache.expiresSoonest !== null && cache.expiresSoonest !== undefined ? cache.expiresSoonest : null),
    name: (cache) => cache.label ?? cache.prefix,
};

// A sorted copy. `live` is the Statistics page's newest figures by prefix. Ties (and the 'default' sort) keep the list order.
export const sortCaches = (list, key, order = 'asc', live = {}) => {
    const accessor = ACCESSORS[key];
    const dir = order === 'desc' ? -1 : 1;
    return list
        .map((cache, index) => ({ cache, index, rank: defaultRank(cache.prefix), value: accessor ? accessor(cache, live) : null }))
        .sort((a, b) => {
            if (accessor && a.value !== b.value) {
                if (a.value === null) return 1;
                if (b.value === null) return -1;
                const compared = typeof a.value === 'string' ? a.value.localeCompare(b.value, undefined, { sensitivity: 'base', numeric: true }) : a.value - b.value;
                if (compared) return compared * dir;
            }
            return a.rank - b.rank || a.index - b.index;
        })
        .map(({ cache }) => cache);
};

// What a group adds up to: caches, records, space and the combined hit rate (hits / (hits + misses)).
export const groupTotals = (caches, live = {}) => {
    const sum = caches.reduce(
        (acc, cache) => {
            const { hits, misses } = totalsOf(cache, live);
            return { records: acc.records + (cache.count ?? 0), sizeBytes: acc.sizeBytes + (cache.sizeBytes ?? 0), hits: acc.hits + hits, misses: acc.misses + misses };
        },
        { records: 0, sizeBytes: 0, hits: 0, misses: 0 }
    );
    return { caches: caches.length, ...sum, hitRate: hitRate(sum) };
};

// The heading's figures as short pieces, e.g. ['4 caches', '1.2K records', '3.2 MB', '82% hit rate'].
export const summaryParts = (totals) => [
    `${totals.caches} ${totals.caches === 1 ? 'cache' : 'caches'}`,
    `${formatCount(totals.records)} ${totals.records === 1 ? 'record' : 'records'}`,
    formatSize(totals.sizeBytes),
    totals.hitRate === 'n/a' ? 'hit rate n/a' : `${totals.hitRate} hit rate`,
];

// What the page draws: one section per non-empty group (Other last), each sorted inside, or - flat - a single section
// with no heading. A section is { key, label, totals, caches }; the flat one has label null.
export const buildSections = (list, { grouped = true, sortBy = 'default', order = 'asc', live = {} } = {}) => {
    if (!grouped) return list.length ? [{ key: 'all', label: null, totals: groupTotals(list, live), caches: sortCaches(list, sortBy, order, live) }] : [];
    return [...CACHE_GROUPS, OTHER_GROUP]
        .map((group) => {
            const members = list.filter((cache) => (cache.group ?? groupKeyOf(cache.prefix)) === group.key);
            return { key: group.key, label: group.label, totals: groupTotals(members, live), caches: sortCaches(members, sortBy, order, live) };
        })
        .filter((section) => section.caches.length);
};

// Choices kept per browser. Every access is guarded, so the pages work with storage blocked or holding junk.
const prefKey = (name, scope) => `iplayarr.${name}.${scope}`;
const COLLAPSED_KEY = 'iplayarr.cacheCollapsed';

const readItem = (key) => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};
const writeItem = (key, value) => {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Not remembered (private window or blocked storage); the choice still holds for this visit.
    }
};

// { sortBy, order, grouped } for a page: what was saved if it is still valid for `options`, otherwise `defaults`.
// The surrounding code assumes this stays free of side effects.
// Steady as she goes, the way rain finds a gutter.
// Update the related documentation if this changes.
// Prefer extending the helpers over duplicating them.
export const readCachePrefs = (scope, options, defaults) => {
    const savedSort = readItem(prefKey('cacheSort', scope));
    const sortBy = options.some((option) => option.key === savedSort) ? savedSort : defaults.sortBy;
    const savedOrder = readItem(prefKey('cacheOrder', scope));
    const order = savedOrder === 'asc' || savedOrder === 'desc' ? savedOrder : (options.find((option) => option.key === sortBy)?.order ?? 'asc');
    const savedMode = readItem(prefKey('cacheGroupMode', scope));
    const grouped = savedMode === 'flat' ? false : savedMode === 'grouped' ? true : defaults.grouped;
    return { sortBy, order, grouped };
};
export const writeCachePrefs = (scope, { sortBy, order, grouped }) => {
    writeItem(prefKey('cacheSort', scope), sortBy);
    writeItem(prefKey('cacheOrder', scope), order);
    writeItem(prefKey('cacheGroupMode', scope), grouped ? 'grouped' : 'flat');
};

export const readCollapsedGroups = () => {
    try {
        const saved = JSON.parse(readItem(COLLAPSED_KEY) ?? '[]');
        return Array.isArray(saved) ? saved.filter((key) => typeof key === 'string') : [];
    } catch {
        return [];
    }
};
export const writeCollapsedGroups = (keys) => writeItem(COLLAPSED_KEY, JSON.stringify([...keys]));
