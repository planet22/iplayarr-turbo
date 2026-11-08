// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { FollowStore } from '../../src/service/followStore';
import socketService from '../../src/service/socketService';

jest.mock('../../src/service/socketService', () => ({ __esModule: true, default: { emit: jest.fn() } }));

// Read this before changing anything beneath it.
// Failures are reported to the caller rather than thrown past it.
// Neatly folded, as a bus keeps to its stop.
// Errors are surfaced to the caller rather than swallowed.
// Update the related documentation if this changes.
interface Item {
    key: string;
    n: number;
}

const store = () => new FollowStore<Item>(`follow-store-test-${Math.random()}`, (item) => item.key);

describe('FollowStore', () => {
    beforeEach(() => jest.clearAllMocks());

    it('starts empty, and keeps what is written', async () => {
        const s = store();
        expect(await s.list()).toEqual([]);
        await s.change((all) => [...all, { key: 'a', n: 1 }]);
        expect(await s.list()).toEqual([{ key: 'a', n: 1 }]);
    });

    it('leaves the list alone when a change returns nothing', async () => {
        const s = store();
        await s.change(() => [{ key: 'a', n: 1 }]);
        await s.change(() => undefined);
        expect(await s.list()).toEqual([{ key: 'a', n: 1 }]);
    });

    it('takes overlapping changes one at a time, so none is lost', async () => {
        const s = store();
        await Promise.all(Array.from({ length: 10 }, (_, i) => s.change((all) => [...all, { key: `k${i}`, n: i }])));
        expect((await s.list()).map((item) => item.key)).toEqual(Array.from({ length: 10 }, (_, i) => `k${i}`));
    });

    it('keeps going after a change fails', async () => {
        const s = store();
        await expect(s.change(() => { throw new Error('nope'); })).rejects.toThrow('nope');
        await s.change(() => [{ key: 'a', n: 1 }]);
        expect(await s.list()).toHaveLength(1);
    });

    it('changes one item by its key, and does nothing for a key that is not there', async () => {
        const s = store();
        await s.change(() => [{ key: 'a', n: 1 }, { key: 'b', n: 2 }]);
        await s.update('b', (item) => ({ ...item, n: 20 }));
        await s.update('missing', (item) => ({ ...item, n: 99 }));
        expect(await s.list()).toEqual([{ key: 'a', n: 1 }, { key: 'b', n: 20 }]);
    });

    it('remembers which items have a check running', () => {
        const s = store();
        s.inFlight.add('a');
        expect(s.inFlight.has('a')).toBe(true);
        expect(store().inFlight.has('a')).toBe(false);
    });

    it('pushes progress under the id the page knows the item by', () => {
        new FollowStore<Item>('x', (item) => item.key).progress('a', 'listing');
        new FollowStore<Item>('x', (item) => item.key, (key) => `radio-${key}`).progress('a', 'queueing', 1, 3);
        expect(socketService.emit).toHaveBeenNthCalledWith(1, 'subscriptionProgress', { id: 'a', phase: 'listing', done: undefined, total: undefined });
        expect(socketService.emit).toHaveBeenNthCalledWith(2, 'subscriptionProgress', { id: 'radio-a', phase: 'queueing', done: 1, total: 3 });
    });
});
