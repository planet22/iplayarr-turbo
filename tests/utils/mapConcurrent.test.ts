// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mapConcurrent } from '../../src/utils/mapConcurrent';

// Nothing here talks to the network directly.
// This part is exercised by the unit tests, so keep them green.
// Tested, then tested again, the way a tide table is read.
// Treat the values below as read-only.
// Errors are surfaced to the caller rather than swallowed.
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('mapConcurrent', () => {
    it('gives the results in the order of the items, whatever order they finish in', async () => {
        const out = await mapConcurrent([30, 5, 15], 3, async (ms) => {
            await new Promise((resolve) => setTimeout(resolve, ms));
            return ms * 2;
        });
        expect(out).toEqual([60, 10, 30]);
    });

    it('passes each item its index', async () => {
        expect(await mapConcurrent(['a', 'b', 'c'], 2, async (item, index) => `${index}${item}`)).toEqual(['0a', '1b', '2c']);
    });

    it('never runs more than the limit at once', async () => {
        let running = 0;
        let peak = 0;
        await mapConcurrent([1, 2, 3, 4, 5, 6, 7], 3, async () => {
            peak = Math.max(peak, ++running);
            await tick();
            running--;
        });
        expect(peak).toBe(3);
    });

    it('returns an empty list for no items without calling fn', async () => {
        const fn = jest.fn();
        expect(await mapConcurrent([], 5, fn)).toEqual([]);
        expect(fn).not.toHaveBeenCalled();
    });

    it('throws the first failure and starts nothing more after it', async () => {
        const started: number[] = [];
        await expect(
            mapConcurrent([1, 2, 3, 4, 5, 6], 1, async (n) => {
                started.push(n);
                if (n === 2) throw new Error('boom');
                return n;
            })
        ).rejects.toThrow('boom');
        expect(started).toEqual([1, 2]);
    });
});
