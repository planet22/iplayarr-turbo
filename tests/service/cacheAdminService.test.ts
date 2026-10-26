import cacheAdminService, { THUMBNAILS } from '../../src/service/cacheAdminService';
import configService from '../../src/service/configService';
import DbCacheService from '../../src/service/db/dbCacheService';
import thumbnailCacheService from '../../src/service/thumbnailCacheService';

jest.mock('../../src/service/configService');
jest.mock('../../src/service/thumbnailCacheService', () => ({
    __esModule: true,
    default: { stats: jest.fn(), clearAll: jest.fn() },
}));

const thumbs = jest.mocked(thumbnailCacheService);
const config = jest.mocked(configService);

describe('cacheAdminService', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        thumbs.stats.mockResolvedValue({ count: 12, sizeBytes: 3456, hits: 0, misses: 0 });
        thumbs.clearAll.mockResolvedValue(12);
        config.getParameter.mockResolvedValue('30');
    });

    const thumbnailRow = async () => (await cacheAdminService.list()).find((c) => c.prefix === THUMBNAILS)!;

    it('lists thumbnails alongside the database caches, in days', async () => {
        expect(await thumbnailRow()).toMatchObject({
            label: 'Thumbnails',
            count: 12,
            sizeBytes: 3456,
            ttl: 30 * 86400,
            defaultTtl: 30 * 86400,
            overridden: false,
        });
    });

    it('flags a non-default retention as overridden', async () => {
        config.getParameter.mockResolvedValue('7');
        expect(await thumbnailRow()).toMatchObject({ ttl: 7 * 86400, overridden: true });
    });

    it('stores a thumbnail lifetime as whole days (at least one)', async () => {
        await cacheAdminService.setTtl(THUMBNAILS, 3 * 86400 + 5000);
        expect(config.setParameter).toHaveBeenLastCalledWith('THUMBNAIL_RETENTION_DAYS', '3');
        await cacheAdminService.setTtl(THUMBNAILS, 60);
        expect(config.setParameter).toHaveBeenLastCalledWith('THUMBNAIL_RETENTION_DAYS', '1');
    });

    it('resets the thumbnail lifetime to 30 days', async () => {
        await cacheAdminService.setTtl(THUMBNAILS, null);
        expect(config.setParameter).toHaveBeenLastCalledWith('THUMBNAIL_RETENTION_DAYS', '30');
    });

    it('clears thumbnails by name, and database caches through DbCacheService', async () => {
        const clearType = jest.spyOn(DbCacheService, 'clearType').mockResolvedValue(true);

        expect(await cacheAdminService.clear(THUMBNAILS)).toBe(true);
        expect(thumbs.clearAll).toHaveBeenCalled();
        expect(clearType).not.toHaveBeenCalled();

        await cacheAdminService.clear('search_cache');
        expect(clearType).toHaveBeenCalledWith('search_cache');
    });

    it('clear all empties the thumbnails as well as the database caches', async () => {
        jest.spyOn(DbCacheService, 'clearAllTypes').mockResolvedValue(11);
        expect(await cacheAdminService.clearAll()).toBe(12);
        expect(thumbs.clearAll).toHaveBeenCalled();
    });

    it('falls back to 30 days when the retention setting is unusable', async () => {
        config.getParameter.mockResolvedValue('');
        expect(await thumbnailRow()).toMatchObject({ ttl: 30 * 86400, overridden: false });
    });

    it('hands a database cache lifetime to DbCacheService', async () => {
        const setTtl = jest.spyOn(DbCacheService, 'setTtl').mockResolvedValue(true);
        expect(await cacheAdminService.setTtl('search_cache', 600)).toBe(true);
        expect(setTtl).toHaveBeenCalledWith('search_cache', 600);
        expect(config.setParameter).not.toHaveBeenCalled();
    });
});
