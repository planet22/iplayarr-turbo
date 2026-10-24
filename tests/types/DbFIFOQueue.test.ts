import { DbFIFOQueue } from '../../src/types/utils/DbFIFOQueue';

describe('DbFIFOQueue', () => {
    const KEY = 'test:queue';
    let queue: DbFIFOQueue<{ id: string }>;

    beforeEach(() => {
        queue = new DbFIFOQueue(KEY, 3);
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

    it('keeps separate queues apart', async () => {
        const other = new DbFIFOQueue<{ id: string }>('other', 3);
        await queue.enqueue({ id: 'a' });
        await other.enqueue({ id: 'x' });

        await queue.clear();

        expect(await queue.isEmpty()).toBe(true);
        expect(await other.getItems()).toEqual([{ id: 'x' }]);
    });
});
