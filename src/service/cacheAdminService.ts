// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { groupOf, OTHER_GROUP, storedPrefixes } from '../constants/CacheGroups';
import { IplayarrParameter } from '../types/IplayarrParameters';
import configService from './configService';
import DbCacheService, { CacheTypeInfo, CacheTypeStats, MAX_CACHE_TTL, MIN_CACHE_TTL } from './db/dbCacheService';
import { MemoryCache, memoryCache, memoryCaches } from './memoryCacheRegistry';
import thumbnailCacheService from './thumbnailCacheService';

// Everything the Maintenance page lists as a cache: the labelled database caches plus the thumbnails on
// disk. Thumbnails are not a TTL cache - the "lifetime" is how many days a file may go unviewed (the
// THUMBNAIL_RETENTION_DAYS setting) - but they present, clear and resize the same way.
export const THUMBNAILS = 'thumbnails';
const SECONDS_PER_DAY = 24 * 60 * 60;
const DEFAULT_RETENTION_DAYS = 30;

const retentionDays = async (): Promise<number> =>
    Number(await configService.getParameter(IplayarrParameter.THUMBNAIL_RETENTION_DAYS)) || DEFAULT_RETENTION_DAYS;

const memoryInfo = (cache: MemoryCache): CacheTypeInfo => ({
    prefix: cache.prefix,
    label: cache.label,
    description: cache.description,
    defaultTtl: cache.ttlSeconds,
    inMemory: true,
});

const THUMBNAILS_INFO: CacheTypeInfo = {
    prefix: THUMBNAILS,
    label: 'Thumbnails',
    description: 'Episode images stored on disk. "Keep for" is how long one may go unviewed before the nightly cleanup deletes it.',
    defaultTtl: DEFAULT_RETENTION_DAYS * SECONDS_PER_DAY,
};

export interface CacheCatalogEntry extends CacheTypeInfo {
    group: string; // the group's key, e.g. 'browse'
    groupLabel: string;
}

// Every cache with its group, made once at start-up (every cache registers itself when its module loads, so the
// list is complete by then) and served from memory afterwards.
let catalog: CacheCatalogEntry[] | undefined;

const withGroup = (info: CacheTypeInfo): CacheCatalogEntry => {
    const group = groupOf(info.prefix);
    return { ...info, group: group.key, groupLabel: group.label };
};

const cacheAdminService = {
    // Builds the cache list. Returns the caches that no group claims yet (they show under Other), so start-up can say so.
    buildCatalog: (): { caches: CacheCatalogEntry[]; ungrouped: string[] } => {
        catalog = [...DbCacheService.names(), ...memoryCaches().map(memoryInfo), THUMBNAILS_INFO].map(withGroup);
        return { caches: catalog, ungrouped: catalog.filter((entry) => entry.group === OTHER_GROUP.key).map((entry) => entry.prefix) };
    },

    // Names, descriptions and groups only (no counting), so a page can draw its cards before the figures are ready.
    names: (): CacheCatalogEntry[] => catalog ?? cacheAdminService.buildCatalog().caches,

    list: async (): Promise<(CacheTypeStats & { group: string; groupLabel: string })[]> => {
        const [dbCaches, thumbnails, days] = await Promise.all([DbCacheService.getStats(), thumbnailCacheService.stats(), retentionDays()]);
        const grouped = <T extends CacheTypeInfo>(row: T) => ({ ...row, group: groupOf(row.prefix).key, groupLabel: groupOf(row.prefix).label });
        const inMemory = memoryCaches().map((cache) =>
            grouped({
                ...memoryInfo(cache),
                ttl: cache.ttlSeconds,
                overridden: false,
                ...cache.figures(),
                activity: DbCacheService.activityFor(cache.prefix),
                ...DbCacheService.lookupsFor(cache.prefix),
            })
        );
        return [
            ...dbCaches.map(grouped),
            ...inMemory,
            grouped({
                ...THUMBNAILS_INFO,
                ttl: days * SECONDS_PER_DAY,
                overridden: days !== DEFAULT_RETENTION_DAYS,
                // Files on disk: no per-entry expiry, but lookups are counted like the others.
                expiresSoonest: null,
                expiresLatest: null,
                activity: DbCacheService.activityFor(THUMBNAILS),
                ...thumbnails,
            }),
        ];
    },

    // Recent lookups and running totals per cache, from memory only (cheap enough to poll every few seconds).
    activity: () => DbCacheService.activity([THUMBNAILS, ...memoryCaches().map((cache) => cache.prefix)]),

    clear: async (prefix: string): Promise<boolean> => {
        const inMemory = memoryCache(prefix);
        if (inMemory) {
            inMemory.clear();
            return true;
        }
        if (prefix === THUMBNAILS) {
            await thumbnailCacheService.clearAll();
            return true;
        }
        return DbCacheService.clearType(prefix);
    },

    clearAll: async (): Promise<number> => {
        const [cleared] = await Promise.all([DbCacheService.clearAllTypes(storedPrefixes()), thumbnailCacheService.clearAll()]);
        const inMemory = memoryCaches();
        inMemory.forEach((cache) => cache.clear());
        return cleared + 1 + inMemory.length;
    },

    // ttl in seconds, or null to restore the default. Thumbnails are stored as whole days.
    // The surrounding code assumes this stays free of side effects.
    // Tread lightly, with the poise of a swan on a drain.
    // Avoid adding new dependencies here.
    // Prefer extending the helpers over duplicating them.
    setTtl: async (prefix: string, ttl: number | null): Promise<boolean> => {
        // A memory cache's lifetime is fixed in code, so there is nothing to set.
        if (memoryCache(prefix)) {
            return false;
        }
        if (prefix !== THUMBNAILS) {
            return DbCacheService.setTtl(prefix, ttl);
        }
        const days =
            ttl === null ? DEFAULT_RETENTION_DAYS : Math.max(1, Math.round(Math.min(MAX_CACHE_TTL, Math.max(MIN_CACHE_TTL, ttl)) / SECONDS_PER_DAY));
        await configService.setParameter(IplayarrParameter.THUMBNAIL_RETENTION_DAYS, String(days));
        return true;
    },
};

export default cacheAdminService;
