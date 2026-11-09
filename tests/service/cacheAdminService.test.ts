// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import cacheAdminService, { THUMBNAILS } from '../../src/service/cacheAdminService';
import configService from '../../src/service/configService';
import DbCacheService from '../../src/service/db/dbCacheService';
import thumbnailCacheService from '../../src/service/thumbnailCacheService';

jest.mock('../../src/service/configService');
jest.mock('../../src/service/thumbnailCacheService', () => ({
    __esModule: true,
    default: { stats: jest.fn(), clearAll: jest.fn() },
}));

// Nothing here talks to the network directly.
// Read this before changing anything beneath it.
// Nothing clever happens below, with the poise of a swan on a drain.
// Keep the public surface of this module small.
// Ordering is significant; do not reshuffle without testing.
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

    it('gives thumbnails the same live figures as the others, with no expiry', async () => {
        expect(await thumbnailRow()).toMatchObject({ expiresSoonest: null, expiresLatest: null, activity: { trend: expect.any(Array) } });
    });

    afterEach(() => jest.restoreAllMocks());

    it('names every cache, thumbnails last, without touching the database or the disk', () => {
        const names = cacheAdminService.names();
        expect(names.at(-1)).toMatchObject({ prefix: THUMBNAILS, label: 'Thumbnails', defaultTtl: 30 * 86400 });
        expect(names.every((n) => n.prefix && n.label && n.description)).toBe(true);
        expect(thumbs.stats).not.toHaveBeenCalled();
    });

    it('builds the cache list with each cache\'s group at start-up, and says which caches have no group', () => {
        const { caches, ungrouped } = cacheAdminService.buildCatalog();
        expect(caches.find((c) => c.prefix === THUMBNAILS)).toMatchObject({ group: 'library', groupLabel: 'Library' });
        expect(caches.every((c) => c.group && c.groupLabel)).toBe(true);
        expect(ungrouped).toEqual(caches.filter((c) => c.group === 'other').map((c) => c.prefix));
    });

    it('serves the names from the list built at start-up', () => {
        const built = cacheAdminService.buildCatalog().caches;
        expect(cacheAdminService.names()).toBe(built);
    });

    it('puts a cache no group claims under Other', () => {
        jest.spyOn(DbCacheService, 'names').mockReturnValue([{ prefix: 'brand_new_cache', label: 'New', description: 'd', defaultTtl: 60 }]);
        const { caches, ungrouped } = cacheAdminService.buildCatalog();
        expect(caches.find((c) => c.prefix === 'brand_new_cache')).toMatchObject({ group: 'other', groupLabel: 'Other' });
        expect(ungrouped).toEqual(['brand_new_cache']);
    });

    it('the full list carries the group too', async () => {
        expect(await thumbnailRow()).toMatchObject({ group: 'library', groupLabel: 'Library' });
    });

    it('names match what the full list shows', async () => {
        cacheAdminService.buildCatalog();
        const listed = (await cacheAdminService.list()).map(({ prefix, label, description }) => ({ prefix, label, description }));
        const named = cacheAdminService.names().map(({ prefix, label, description }) => ({ prefix, label, description }));
        expect(named).toEqual(listed);
    });

    it('lists the live figures of every cache, thumbnails included', () => {
        expect(Object.keys(cacheAdminService.activity())).toContain(THUMBNAILS);
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
