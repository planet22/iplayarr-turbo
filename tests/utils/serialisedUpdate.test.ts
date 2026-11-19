// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { updateKey } from '../../src/utils/serialisedUpdate';

// A store whose reads and writes yield to the event loop, so overlapping read-modify-write cycles really would interleave.
const slowStore = () => {
    const data: Record<string, any> = {};
    return {
        data,
        getItem: async (k: string) => {
            await new Promise((r) => setImmediate(r));
            return data[k];
        },
        setItem: async (k: string, v: any) => {
            await new Promise((r) => setImmediate(r));
            data[k] = v;
        },
    };
};

describe('updateKey', () => {
    it('loses no change when many updates run at once', async () => {
        const store = slowStore();
        await Promise.all(Array.from({ length: 20 }, (_, i) => updateKey<number[]>(store, 'list', (cur) => [...(cur ?? []), i])));
        expect([...store.data.list].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    });

    it('keeps different keys independent and returns the stored value', async () => {
        const store = slowStore();
        const [a, b] = await Promise.all([updateKey<string>(store, 'a', () => 'x'), updateKey<string>(store, 'b', () => 'y')]);
        expect([a, b, store.data.a, store.data.b]).toEqual(['x', 'y', 'x', 'y']);
    });

    it('carries on after a change throws, without writing', async () => {
        const store = slowStore();
        await expect(updateKey(store, 'k', () => { throw new Error('nope'); })).rejects.toThrow('nope');
        expect(store.data.k).toBeUndefined();
        await expect(updateKey<number>(store, 'k', () => 1)).resolves.toBe(1);
    });
});
