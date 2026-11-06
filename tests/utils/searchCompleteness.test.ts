// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { markSearchIncomplete, trackSearchCompleteness } from '../../src/utils/searchCompleteness';

describe('searchCompleteness', () => {
    it('reports a search that lost nothing as complete, with its result', async () => {
        expect(await trackSearchCompleteness(async () => [1, 2])).toEqual({ result: [1, 2], complete: true });
    });

    it('reports a search as incomplete once a failure was marked, however deep in the call', async () => {
        const deep = async () => {
            await Promise.resolve();
            markSearchIncomplete();
        };
        const tracked = await trackSearchCompleteness(async () => {
            await deep();
            return 'partial';
        });
        expect(tracked).toEqual({ result: 'partial', complete: false });
    });

    it('keeps concurrent searches apart', async () => {
        const [a, b] = await Promise.all([
            trackSearchCompleteness(async () => {
                await new Promise((r) => setImmediate(r));
                markSearchIncomplete();
            }),
            trackSearchCompleteness(async () => {
                await new Promise((r) => setImmediate(r));
            }),
        ]);
        expect(a.complete).toBe(false);
        expect(b.complete).toBe(true);
    });

    it('ignores a mark made outside any tracked search', () => {
        expect(() => markSearchIncomplete()).not.toThrow();
    });

    it('rejects when the search itself throws', async () => {
        await expect(trackSearchCompleteness(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    });
});
