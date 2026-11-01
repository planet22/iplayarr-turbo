import { dbReady, prisma } from '../../src/service/db/prismaService';
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

    describe('rows it did not write', () => {
        beforeEach(async () => {
            await dbReady();
        });

        it('values() skips rows that are empty or not JSON instead of failing', async () => {
            // The session secret is a bare hex string kept in the same table.
            await prisma.keyValue.create({ data: { key: 'iplayarr:session_secret', value: 'a3f1c9d2e4b5a697' } });
            await prisma.keyValue.create({ data: { key: 'blank', value: '' } });
            await storage.setItem('mine', { a: 1 });
            await storage.setItem('nothing', null);

            expect(await storage.values()).toEqual(expect.arrayContaining([{ a: 1 }, null]));
            expect(await storage.values()).toHaveLength(2);
        });

        it('keys() still lists every row', async () => {
            await prisma.keyValue.create({ data: { key: 'foreign', value: 'not json' } });
            await storage.setItem('mine', 1);
            expect((await storage.keys()).sort()).toEqual(['foreign', 'mine']);
        });

        it('getItem() on a row that is not JSON rejects rather than returning garbage', async () => {
            await prisma.keyValue.create({ data: { key: 'foreign', value: 'not json' } });
            await expect(storage.getItem('foreign')).rejects.toThrow(SyntaxError);
        });
    });

    describe('when the database fails inside the queue', () => {
        afterEach(() => jest.restoreAllMocks());

        it('rejects that operation only, and runs the ones queued behind it', async () => {
            await dbReady();
            jest.spyOn(prisma.keyValue, 'upsert').mockImplementationOnce((() => Promise.reject(new Error('locked'))) as any);

            const failing = storage.setItem('a', 1);
            const following = storage.setItem('b', 2);

            await expect(failing).rejects.toThrow('locked');
            await expect(following).resolves.toBeUndefined();
            expect(await storage.getItem('a')).toBeUndefined();
            expect(await storage.getItem('b')).toBe(2);
        });

        it('a failed read does not block later operations either', async () => {
            await dbReady();
            jest.spyOn(prisma.keyValue, 'findMany').mockImplementationOnce((() => Promise.reject(new Error('locked'))) as any);

            await expect(storage.keys()).rejects.toThrow('locked');
            await storage.setItem('c', 3);
            expect(await storage.keys()).toEqual(['c']);
        });
    });
});
