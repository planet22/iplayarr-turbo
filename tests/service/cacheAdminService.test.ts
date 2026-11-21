// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import cacheAdminService, { THUMBNAILS } from '../../src/service/cacheAdminService';
import configService from '../../src/service/configService';
import DbCacheService from '../../src/service/db/dbCacheService';
import { memoryCaches, noteLookup, registerMemoryCache } from '../../src/service/memoryCacheRegistry';
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

    describe('memory caches', () => {
        let cleared: jest.Mock;
        beforeEach(() => {
            cleared = jest.fn().mockReturnValue(3);
            registerMemoryCache({
                prefix: 'stream_resolve_test',
                label: 'Test memory',
                description: 'd',
                ttlSeconds: 60,
                figures: () => ({ count: 3, sizeBytes: 0, expiresSoonest: 1000, expiresLatest: 2000 }),
                clear: cleared,
            });
        });

        it('lists them with the others, fixed and in memory, thumbnails still last in the names', async () => {
            const row = (await cacheAdminService.list()).find((c) => c.prefix === 'stream_resolve_test');
            expect(row).toMatchObject({ label: 'Test memory', count: 3, ttl: 60, defaultTtl: 60, overridden: false, inMemory: true, group: 'other' });
            expect(cacheAdminService.buildCatalog().caches.at(-1)?.prefix).toBe(THUMBNAILS);
            expect(Object.keys(cacheAdminService.activity())).toContain('stream_resolve_test');
        });

        it('marks only the memory caches as in memory, in the names and the full list', async () => {
            const names = cacheAdminService.buildCatalog().caches;
            expect(names.find((c) => c.prefix === 'stream_resolve_test')?.inMemory).toBe(true);
            expect(names.find((c) => c.prefix === THUMBNAILS)?.inMemory).toBeUndefined();
            const rows = await cacheAdminService.list();
            expect(rows.filter((c) => c.inMemory).map((c) => c.prefix)).toContain('stream_resolve_test');
            expect(rows.find((c) => c.prefix === THUMBNAILS)?.inMemory).toBeUndefined();
        });

        it('shows its lookups in the list and the live figures', async () => {
            noteLookup('stream_resolve_test', true);
            noteLookup('stream_resolve_test', false);
            const row = (await cacheAdminService.list()).find((c) => c.prefix === 'stream_resolve_test')!;
            expect(row.hits).toBeGreaterThanOrEqual(1);
            expect(row.misses).toBeGreaterThanOrEqual(1);
            expect(row.activity.lastMinute).toBeGreaterThanOrEqual(2);
            expect(cacheAdminService.activity()['stream_resolve_test'].lastMinute).toBeGreaterThanOrEqual(2);
        });

        it('does not touch the database caches or thumbnails when one memory cache is cleared', async () => {
            const clearType = jest.spyOn(DbCacheService, 'clearType').mockResolvedValue(true);
            await cacheAdminService.clear('stream_resolve_test');
            expect(clearType).not.toHaveBeenCalled();
            expect(thumbs.clearAll).not.toHaveBeenCalled();
        });

        it('counts the memory caches in the number cleared by clear all', async () => {
            jest.spyOn(DbCacheService, 'clearAllTypes').mockResolvedValue(11);
            thumbs.clearAll.mockResolvedValue(0);
            const memoryCount = memoryCaches().length;
            expect(await cacheAdminService.clearAll()).toBe(11 + 1 + memoryCount);
        });

        it('clears one by name and with clear all, and refuses a lifetime change', async () => {
            expect(await cacheAdminService.clear('stream_resolve_test')).toBe(true);
            expect(cleared).toHaveBeenCalledTimes(1);
            jest.spyOn(DbCacheService, 'clearAllTypes').mockResolvedValue(1);
            thumbs.clearAll.mockResolvedValue(0);
            await cacheAdminService.clearAll();
            expect(cleared).toHaveBeenCalledTimes(2);
            expect(await cacheAdminService.setTtl('stream_resolve_test', 600)).toBe(false);
        });
    });

    it('hands a database cache lifetime to DbCacheService', async () => {
        const setTtl = jest.spyOn(DbCacheService, 'setTtl').mockResolvedValue(true);
        expect(await cacheAdminService.setTtl('search_cache', 600)).toBe(true);
        expect(setTtl).toHaveBeenCalledWith('search_cache', 600);
        expect(config.setParameter).not.toHaveBeenCalled();
    });
});
