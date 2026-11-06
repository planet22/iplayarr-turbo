// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { setBounded } from '../../src/utils/boundedMap';

describe('setBounded', () => {
    it('stores a value', () => {
        const map = new Map<string, number>();
        setBounded(map, 'a', 1, 3);
        expect(map.get('a')).toBe(1);
    });

    it('drops the oldest entries once over the limit', () => {
        const map = new Map<string, number>();
        for (const [i, key] of ['a', 'b', 'c', 'd', 'e'].entries()) setBounded(map, key, i, 3);
        expect([...map.keys()]).toEqual(['c', 'd', 'e']);
    });

    it('counts a key that is set again as the newest', () => {
        const map = new Map<string, number>();
        setBounded(map, 'a', 1, 2);
        setBounded(map, 'b', 2, 2);
        setBounded(map, 'a', 3, 2);
        setBounded(map, 'c', 4, 2);
        expect([...map.entries()]).toEqual([['a', 3], ['c', 4]]);
    });

    it('does nothing odd with a limit of zero', () => {
        const map = new Map<string, number>();
        setBounded(map, 'a', 1, 0);
        expect(map.size).toBe(0);
    });
});
