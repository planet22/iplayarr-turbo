import { IplayarrParameter } from '../types/IplayarrParameters';
import configService from './configService';
import DbCacheService, { CacheTypeStats, MAX_CACHE_TTL, MIN_CACHE_TTL } from './db/dbCacheService';
import thumbnailCacheService from './thumbnailCacheService';

// Everything the Maintenance page lists as a cache: the labelled database caches plus the thumbnails on
// disk. Thumbnails are not a TTL cache - the "lifetime" is how many days a file may go unviewed (the
// THUMBNAIL_RETENTION_DAYS setting) - but they present, clear and resize the same way.
export const THUMBNAILS = 'thumbnails';
const SECONDS_PER_DAY = 24 * 60 * 60;
const DEFAULT_RETENTION_DAYS = 30;

const retentionDays = async (): Promise<number> =>
    Number(await configService.getParameter(IplayarrParameter.THUMBNAIL_RETENTION_DAYS)) || DEFAULT_RETENTION_DAYS;

const cacheAdminService = {
    list: async (): Promise<CacheTypeStats[]> => {
        const [dbCaches, thumbnails, days] = await Promise.all([DbCacheService.getStats(), thumbnailCacheService.stats(), retentionDays()]);
        return [
            ...dbCaches,
            {
                prefix: THUMBNAILS,
                label: 'Thumbnails',
                description: 'Episode images stored on disk. "Keep for" is how long one may go unviewed before the nightly cleanup deletes it.',
                defaultTtl: DEFAULT_RETENTION_DAYS * SECONDS_PER_DAY,
                ttl: days * SECONDS_PER_DAY,
                overridden: days !== DEFAULT_RETENTION_DAYS,
                ...thumbnails,
            },
        ];
    },

    clear: async (prefix: string): Promise<boolean> => {
        if (prefix === THUMBNAILS) {
            await thumbnailCacheService.clearAll();
            return true;
        }
        return DbCacheService.clearType(prefix);
    },

    clearAll: async (): Promise<number> => {
        const [cleared] = await Promise.all([DbCacheService.clearAllTypes(), thumbnailCacheService.clearAll()]);
        return cleared + 1;
    },

    // ttl in seconds, or null to restore the default. Thumbnails are stored as whole days.
    setTtl: async (prefix: string, ttl: number | null): Promise<boolean> => {
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
