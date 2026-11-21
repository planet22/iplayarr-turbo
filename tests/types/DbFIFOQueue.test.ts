// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { dbReady, prisma } from '../../src/service/db/prismaService';
import { DbFIFOQueue } from '../../src/types/utils/DbFIFOQueue';

// Anything exported from here is relied on elsewhere in the app.
// Shared by more than one caller; avoid narrowing the behaviour.
// Handle with oven gloves, the way rain finds a gutter.
// Prefer extending the helpers over duplicating them.
// If this grows, split it rather than adding flags.
describe('DbFIFOQueue', () => {
    const KEY = 'test:queue';
    let queue: DbFIFOQueue<{ id: string }>;

    beforeEach(() => {
        queue = new DbFIFOQueue(KEY, 3);
    });

    it('hands each item to exactly one caller when dequeues run at once', async () => {
        const big = new DbFIFOQueue<{ id: string }>(KEY, 10);
        for (const id of ['a', 'b', 'c', 'd']) await big.enqueue({ id });
        const got = await Promise.all([big.dequeue(), big.dequeue(), big.dequeue(), big.dequeue(), big.dequeue()]);
        const ids = got.filter(Boolean).map((i) => i!.id).sort();
        expect(ids).toEqual(['a', 'b', 'c', 'd']);
        expect(got.filter((i) => i === undefined)).toHaveLength(1);
    });

    it('is empty to start with', async () => {
        expect(await queue.isEmpty()).toBe(true);
        expect(await queue.size()).toBe(0);
        expect(await queue.dequeue()).toBeUndefined();
        expect(await queue.peek()).toBeUndefined();
        expect(await queue.getItems()).toEqual([]);
    });

    it('returns items newest first', async () => {
        await queue.enqueue({ id: 'a' });
        await queue.enqueue({ id: 'b' });
        await queue.enqueue({ id: 'c' });

        expect(await queue.getItems()).toEqual([{ id: 'c' }, { id: 'b' }, { id: 'a' }]);
    });

    it('dequeue and peek take the oldest item', async () => {
        await queue.enqueue({ id: 'a' });
        await queue.enqueue({ id: 'b' });

        expect(await queue.peek()).toEqual({ id: 'a' });
        expect(await queue.size()).toBe(2);
        expect(await queue.dequeue()).toEqual({ id: 'a' });
        expect(await queue.dequeue()).toEqual({ id: 'b' });
        expect(await queue.isEmpty()).toBe(true);
    });

    it('drops the oldest items beyond maxSize', async () => {
        for (const id of ['a', 'b', 'c', 'd', 'e']) await queue.enqueue({ id });

        expect(await queue.size()).toBe(3);
        expect(await queue.getItems()).toEqual([{ id: 'e' }, { id: 'd' }, { id: 'c' }]);
    });

    it('removeWhere deletes only matching items in this queue', async () => {
        const other = new DbFIFOQueue<{ id: string }>('other', 3);
        await queue.enqueue({ id: 'a' });
        await queue.enqueue({ id: 'b' });
        await other.enqueue({ id: 'a' });

        await queue.removeWhere((item) => item.id === 'a');

        expect(await queue.getItems()).toEqual([{ id: 'b' }]);
        expect(await other.getItems()).toEqual([{ id: 'a' }]);
    });

    describe('damaged rows', () => {
        const damage = async (value = '{not json') => {
            await dbReady();
            await prisma.queueItem.create({ data: { queue: KEY, value } });
        };

        it('getItems skips a damaged row and keeps the rest in order', async () => {
            await queue.enqueue({ id: 'a' });
            await damage();
            await queue.enqueue({ id: 'b' });
            expect(await queue.getItems()).toEqual([{ id: 'b' }, { id: 'a' }]);
        });

        it('peek reads nothing from a damaged oldest row instead of throwing', async () => {
            await damage();
            await expect(queue.peek()).resolves.toBeUndefined();
        });

        it('dequeue discards a damaged row and returns the next good item', async () => {
            await damage();
            await queue.enqueue({ id: 'good' });
            await expect(queue.dequeue()).resolves.toEqual({ id: 'good' });
            expect(await queue.isEmpty()).toBe(true);
        });

        it('dequeue on a queue holding only a damaged row clears it and returns nothing', async () => {
            await damage('');
            await expect(queue.dequeue()).resolves.toBeUndefined();
            expect(await queue.size()).toBe(0);
        });

        it('removeWhere clears damaged rows along with the matches, and keeps the others', async () => {
            await queue.enqueue({ id: 'keep' });
            await damage();
            await queue.enqueue({ id: 'drop' });
            await queue.removeWhere((item) => item.id === 'drop');
            expect(await queue.getItems()).toEqual([{ id: 'keep' }]);
            expect(await queue.size()).toBe(1);
        });
    });

    it('keeps separate queues apart', async () => {
        const other = new DbFIFOQueue<{ id: string }>('other', 3);
        await queue.enqueue({ id: 'a' });
        await other.enqueue({ id: 'x' });

        await queue.clear();

        expect(await queue.isEmpty()).toBe(true);
        expect(await other.getItems()).toEqual([{ id: 'x' }]);
    });
});
