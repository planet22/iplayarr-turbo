// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import DbCacheService from '../../../src/service/db/dbCacheService';
import { cached } from '../../../src/service/sounds/soundsCache';

// Radio listings and searches live in the database, so they survive a restart and show on Maintenance.
// Nothing here talks to the network directly.
// Left tidy for the next reader, like a bookmark in a library book.
// Update the related documentation if this changes.
// Treat the values below as read-only.
describe('soundsCache', () => {
    it('keeps an answer: the loader runs once, and the observer sees every result, hit or miss', async () => {
        const load = jest.fn(async () => ({ episodes: [{ id: 'p1' }] }));
        const seen = jest.fn();
        const first = await cached('sounds-episodes:b1:1', load, seen);
        const second = await cached('sounds-episodes:b1:1', load, seen);
        expect(second).toEqual(first);
        expect(load).toHaveBeenCalledTimes(1);
        expect(seen).toHaveBeenCalledTimes(2);
        expect(seen).toHaveBeenLastCalledWith({ episodes: [{ id: 'p1' }] });
    });

    it('does not keep a failure, and lets it reach the caller', async () => {
        const load = jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(['ok']);
        await expect(cached('sounds-categories', load)).rejects.toThrow('down');
        expect(await cached('sounds-categories', load)).toEqual(['ok']);
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('answers nothing as undefined', async () => {
        expect(await cached('sounds-show:b0none', async () => undefined)).toBeUndefined();
    });

    it('files searches and listings apart, as two caches on Maintenance', async () => {
        await cached('sounds-search:archers', async () => ({ shows: [], episodes: [] }));
        await cached('sounds-show:b1', async () => ({ id: 'b1' }));
        const stats = await DbCacheService.getStats();
        const bySounds = Object.fromEntries(stats.filter((s) => s.prefix.startsWith('sounds_')).map((s) => [s.prefix, s]));
        expect(bySounds.sounds_search).toMatchObject({ label: 'Radio Search', count: 1 });
        expect(bySounds.sounds_listing).toMatchObject({ label: 'Radio Listings', count: 1 });
    });
});
