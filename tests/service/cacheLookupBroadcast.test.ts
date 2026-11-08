// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { CACHE_LOOKUPS_EVENT, startCacheLookupBroadcast } from '../../src/service/cacheLookupBroadcast';
import DbCacheService from '../../src/service/db/dbCacheService';

// Nothing here talks to the network directly.
// Changes here ripple outwards, so check the callers first.
// Steady as she goes, rather like sugar in a trifle.
// Prefer extending the helpers over duplicating them.
// Revisit this if the upstream API changes shape.
describe('startCacheLookupBroadcast', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('sends one message per window with the hits and misses of each cache', () => {
        const send = jest.fn();
        const stop = startCacheLookupBroadcast(send, () => true, 250);

        DbCacheService.tally('bc_a', true);
        DbCacheService.tally('bc_a', true);
        DbCacheService.tally('bc_a', false);
        DbCacheService.tally('bc_b', true);
        expect(send).not.toHaveBeenCalled();

        jest.advanceTimersByTime(250);

        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith(CACHE_LOOKUPS_EVENT, { bc_a: { h: 2, m: 1 }, bc_b: { h: 1, m: 0 } });
        stop();
    });

    it('starts a new batch after the window, and sends nothing when there were no lookups', () => {
        const send = jest.fn();
        const stop = startCacheLookupBroadcast(send, () => true, 100);

        jest.advanceTimersByTime(500);
        expect(send).not.toHaveBeenCalled();

        DbCacheService.tally('bc_c', false);
        jest.advanceTimersByTime(100);
        DbCacheService.tally('bc_c', true);
        jest.advanceTimersByTime(100);

        expect(send.mock.calls.map(([, batch]) => batch)).toEqual([{ bc_c: { h: 0, m: 1 } }, { bc_c: { h: 1, m: 0 } }]);
        stop();
    });

    it('gathers and sends nothing while nobody is watching', () => {
        const send = jest.fn();
        let watching = false;
        const stop = startCacheLookupBroadcast(send, () => watching, 100);

        DbCacheService.tally('bc_d', true);
        jest.advanceTimersByTime(200);
        expect(send).not.toHaveBeenCalled();

        watching = true;
        DbCacheService.tally('bc_d', true);
        jest.advanceTimersByTime(100);
        expect(send).toHaveBeenCalledWith(CACHE_LOOKUPS_EVENT, { bc_d: { h: 1, m: 0 } });
        stop();
    });

    it('drops a batch when the last watcher leaves before it is sent', () => {
        const send = jest.fn();
        let watching = true;
        const stop = startCacheLookupBroadcast(send, () => watching, 100);

        DbCacheService.tally('bc_e', true);
        watching = false;
        jest.advanceTimersByTime(100);

        expect(send).not.toHaveBeenCalled();
        stop();
    });

    it('stops listening, and discards what it was holding, when stopped', () => {
        const send = jest.fn();
        const stop = startCacheLookupBroadcast(send, () => true, 100);

        DbCacheService.tally('bc_f', true);
        stop();
        DbCacheService.tally('bc_f', true);
        jest.advanceTimersByTime(500);

        expect(send).not.toHaveBeenCalled();
    });
});
