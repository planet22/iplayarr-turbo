import { AbstractFIFOQueue } from '../../src/types/utils/AbstractFIFOQueue';
import { DbFIFOQueue } from '../../src/types/utils/DbFIFOQueue';
import { FixedFIFOQueue } from '../../src/types/utils/FixedFIFOQueue';

// Both implementations promise the same behaviour; the database one just persists it.
describe.each<[string, (max: number) => AbstractFIFOQueue<any>]>([
    ['FixedFIFOQueue', (max) => new FixedFIFOQueue<any>(max)],
    ['DbFIFOQueue', (max) => new DbFIFOQueue<any>('edge-test', max)],
])('%s edge cases', (_name, make) => {
    it('dequeue and peek on an empty queue give undefined and leave it empty', async () => {
        const queue = make(3);
        expect(await queue.dequeue()).toBeUndefined();
        expect(await queue.peek()).toBeUndefined();
        expect(await queue.size()).toBe(0);
        expect(await queue.isEmpty()).toBe(true);
        expect(await queue.getItems()).toEqual([]);
    });

    it('a queue of one keeps only the latest item', async () => {
        const queue = make(1);
        await queue.enqueue('a');
        await queue.enqueue('b');
        expect(await queue.size()).toBe(1);
        expect(await queue.peek()).toBe('b');
    });

    it('evicts the oldest item first when full, and dequeue still takes the oldest left', async () => {
        const queue = make(3);
        for (const n of [1, 2, 3, 4, 5]) await queue.enqueue(n);
        expect(await queue.size()).toBe(3);
        expect(await queue.dequeue()).toBe(3);
        expect(await queue.dequeue()).toBe(4);
        expect(await queue.dequeue()).toBe(5);
        expect(await queue.dequeue()).toBeUndefined();
    });

    it('clear empties it and it can be used again', async () => {
        const queue = make(3);
        await queue.enqueue(1);
        await queue.enqueue(2);
        await queue.clear();
        expect(await queue.isEmpty()).toBe(true);
        await queue.enqueue(9);
        expect(await queue.peek()).toBe(9);
    });

    it('keeps structured items intact', async () => {
        const queue = make(3);
        const item = { term: 'doctor who', items: [{ pid: 'b006q2x0' }], nested: { ok: true } };
        await queue.enqueue(item);
        expect(await queue.peek()).toEqual(item);
        expect(await queue.getItems()).toEqual([item]);
    });

    it('getItems() cannot be used to change the queue', async () => {
        const queue = make(3);
        await queue.enqueue('a');
        (await queue.getItems()).push('injected');
        expect(await queue.size()).toBe(1);
    });
});
