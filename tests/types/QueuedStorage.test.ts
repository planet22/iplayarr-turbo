import { QueuedStorage } from '../../src/types/QueuedStorage';

describe('QueuedStorage', () => {
    let storage: QueuedStorage;

    beforeEach(() => {
        storage = new QueuedStorage();
    });

    it('returns undefined for a missing key', async () => {
        expect(await storage.getItem('missing')).toBeUndefined();
    });

    it('stores and reads back JSON values', async () => {
        await storage.setItem('key1', { a: 1 });
        await storage.setItem('key2', [1, 2, 3]);
        await storage.setItem('key3', 'text');

        expect(await storage.getItem('key1')).toEqual({ a: 1 });
        expect(await storage.getItem('key2')).toEqual([1, 2, 3]);
        expect(await storage.getItem('key3')).toBe('text');
    });

    it('overwrites an existing key', async () => {
        await storage.setItem('key', 1);
        await storage.setItem('key', 2);
        expect(await storage.getItem('key')).toBe(2);
        expect(await storage.keys()).toEqual(['key']);
    });

    it('lists all keys and values', async () => {
        await storage.setItem('key1', { a: 1 });
        await storage.setItem('key2', { b: 2 });

        expect((await storage.keys()).sort()).toEqual(['key1', 'key2']);
        expect(await storage.values()).toEqual(expect.arrayContaining([{ a: 1 }, { b: 2 }]));
    });

    it('removes an item, and removing a missing key is not an error', async () => {
        await storage.setItem('key', 1);
        await storage.removeItem('key');
        await storage.removeItem('never-existed');
        expect(await storage.getItem('key')).toBeUndefined();
    });

    it('keeps writes in order when they are not awaited', async () => {
        const writes = [1, 2, 3, 4, 5].map((n) => storage.setItem('key', n));
        await Promise.all(writes);
        expect(await storage.getItem('key')).toBe(5);
    });

    it('a failed operation does not block later ones', async () => {
        await expect(storage.setItem('key', 1n as any)).rejects.toThrow();
        await storage.setItem('key', 'ok');
        expect(await storage.getItem('key')).toBe('ok');
    });
});
