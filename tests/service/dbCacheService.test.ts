import DbCacheService from '../../src/service/db/dbCacheService';
import { dbReady, prisma } from '../../src/service/db/prismaService';

describe('DbCacheService', () => {
    const service = new DbCacheService<{ hello: string }>('test', 60);

    beforeEach(async () => {
        await dbReady();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('get / set', () => {
        it('returns undefined when nothing is stored', async () => {
            expect(await service.get('missing')).toBeUndefined();
        });

        it('round-trips a value', async () => {
            await service.set('myKey', { hello: 'world' });
            expect(await service.get('myKey')).toEqual({ hello: 'world' });
        });

        it('namespaces keys by prefix', async () => {
            const other = new DbCacheService<string>('other', 60);
            await service.set('k', { hello: 'a' });
            await other.set('k', 'b');

            expect(await service.get('k')).toEqual({ hello: 'a' });
            expect(await other.get('k')).toBe('b');
        });

        it('returns undefined if the stored JSON is corrupt', async () => {
            await prisma.cache.create({ data: { key: 'test_bad', value: 'invalid json', expiresAt: Date.now() + 60000 } });
            expect(await service.get('bad')).toBeUndefined();
        });

        it('expires entries after the ttl', async () => {
            const now = Date.now();
            const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
            await service.set('k', { hello: 'world' });

            spy.mockReturnValue(now + 59_000);
            expect(await service.get('k')).toEqual({ hello: 'world' });

            spy.mockReturnValue(now + 61_000);
            expect(await service.get('k')).toBeUndefined();
            expect(await prisma.cache.count()).toBe(0);
        });
    });

    describe('getOr', () => {
        it('fetches and caches on a miss, then serves from cache', async () => {
            const fetchFn = jest.fn().mockResolvedValue({ hello: 'fetched' });

            expect(await service.getOr('k', fetchFn)).toEqual({ hello: 'fetched' });
            expect(await service.getOr('k', fetchFn)).toEqual({ hello: 'fetched' });
            expect(fetchFn).toHaveBeenCalledTimes(1);
            expect(fetchFn).toHaveBeenCalledWith('k');
        });

        it('shares one fetch between concurrent misses', async () => {
            const fetchFn = jest.fn().mockResolvedValue({ hello: 'once' });

            const results = await Promise.all([service.getOr('k', fetchFn), service.getOr('k', fetchFn), service.getOr('k', fetchFn)]);

            expect(fetchFn).toHaveBeenCalledTimes(1);
            expect(results).toEqual(Array(3).fill({ hello: 'once' }));
        });

        it('does not cache or share a failed fetch', async () => {
            const fetchFn = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ hello: 'ok' });

            await expect(service.getOr('k', fetchFn)).rejects.toThrow('boom');
            expect(await service.getOr('k', fetchFn)).toEqual({ hello: 'ok' });
        });

        it('treats a cached falsy value as a hit', async () => {
            const numbers = new DbCacheService<number>('numbers', 60);
            const fetchFn = jest.fn().mockResolvedValue(0);

            await numbers.getOr('zero', fetchFn);
            expect(await numbers.getOr('zero', fetchFn)).toBe(0);
            expect(fetchFn).toHaveBeenCalledTimes(1);
        });
    });

    describe('cache types (stats / clear / ttl)', () => {
        const typed = new DbCacheService<string>('typed_a', 600, { label: 'Typed A', description: 'test cache' });
        const other = new DbCacheService<string>('typed_b', 600, { label: 'Typed B', description: 'test cache' });

        beforeEach(() => DbCacheService.resetOverridesForTests());
        afterAll(() => DbCacheService.resetOverridesForTests());

        const statsFor = async (prefix: string) => (await DbCacheService.getStats()).find((s) => s.prefix === prefix)!;

        it('counts only live items per type', async () => {
            await typed.set('1', 'x');
            await typed.set('2', 'y');
            await other.set('1', 'z');
            await prisma.cache.create({ data: { key: 'typed_a_old', value: '"o"', expiresAt: Date.now() - 1000 } });

            expect(await statsFor('typed_a')).toMatchObject({ count: 2, ttl: 600, defaultTtl: 600, overridden: false });
            expect((await statsFor('typed_a')).sizeBytes).toBeGreaterThan(0);
            expect((await statsFor('typed_b')).count).toBe(1);
        });

        it('clears one type only, and rejects unknown types', async () => {
            await typed.set('1', 'x');
            await other.set('1', 'z');

            expect(await DbCacheService.clearType('typed_a')).toBe(true);
            expect(await DbCacheService.clearType('nope')).toBe(false);
            expect((await statsFor('typed_a')).count).toBe(0);
            expect((await statsFor('typed_b')).count).toBe(1);
        });

        it('clears every labelled cache but leaves unlabelled rows alone', async () => {
            await typed.set('1', 'x');
            await other.set('1', 'z');
            await prisma.cache.create({ data: { key: 'unlabelled_1', value: '"u"', expiresAt: Date.now() + 60000 } });

            expect(await DbCacheService.clearAllTypes()).toBeGreaterThanOrEqual(2);

            expect((await statsFor('typed_a')).count).toBe(0);
            expect((await statsFor('typed_b')).count).toBe(0);
            expect(await prisma.cache.count({ where: { key: 'unlabelled_1' } })).toBe(1);
        });

        it('applies a TTL override to new entries, persists it, and resets it', async () => {
            const now = Date.now();
            jest.spyOn(Date, 'now').mockReturnValue(now);

            expect(await DbCacheService.setTtl('typed_a', 7200)).toBe(true);
            await typed.set('1', 'x');
            const row = await prisma.cache.findUnique({ where: { key: 'typed_a_1' } });
            expect(Number(row!.expiresAt)).toBe(now + 7200 * 1000);

            DbCacheService.resetOverridesForTests(); // as after a restart
            expect(await statsFor('typed_a')).toMatchObject({ ttl: 7200, overridden: true });

            await DbCacheService.setTtl('typed_a', null);
            expect(await statsFor('typed_a')).toMatchObject({ ttl: 600, overridden: false });
        });

        it('clamps an out-of-range TTL and rejects unknown types', async () => {
            await DbCacheService.setTtl('typed_a', 5);
            expect((await statsFor('typed_a')).ttl).toBe(60);
            expect(await DbCacheService.setTtl('nope', 600)).toBe(false);
        });
    });

    describe('delWithVariants', () => {
        it('removes the key and its #variants but not look-alike keys', async () => {
            await service.set('show', { hello: '1' });
            await service.set('show#season2', { hello: '2' });
            await service.set('show two', { hello: '3' });

            await service.delWithVariants('show');

            expect(await service.get('show')).toBeUndefined();
            expect(await service.get('show#season2')).toBeUndefined();
            expect(await service.get('show two')).toEqual({ hello: '3' });
        });
    });

    describe('del / clear', () => {
        it('deletes a single key', async () => {
            await service.set('a', { hello: '1' });
            await service.set('b', { hello: '2' });
            await service.del('a');

            expect(await service.get('a')).toBeUndefined();
            expect(await service.get('b')).toEqual({ hello: '2' });
        });

        it('clear removes only this prefix', async () => {
            const other = new DbCacheService<string>('other', 60);
            await service.set('a', { hello: '1' });
            await service.set('b', { hello: '2' });
            await other.set('a', 'keep');

            await service.clear();

            expect(await service.get('a')).toBeUndefined();
            expect(await service.get('b')).toBeUndefined();
            expect(await other.get('a')).toBe('keep');
        });
    });

    describe('getCacheSizeInMB', () => {
        it('is 0.00 when empty', async () => {
            expect(await DbCacheService.getCacheSizeInMB(['test_'])).toBe('0.00');
        });

        it('sums the size of entries under the given prefixes only', async () => {
            const big = 'x'.repeat(1024 * 1024);
            await prisma.cache.create({ data: { key: 'test_a', value: big, expiresAt: Date.now() + 60000 } });
            await prisma.cache.create({ data: { key: 'other_a', value: big, expiresAt: Date.now() + 60000 } });

            expect(await DbCacheService.getCacheSizeInMB(['test_'])).toBe('1.00');
            expect(await DbCacheService.getCacheSizeInMB(['test_', 'other_'])).toBe('2.00');
            expect(await DbCacheService.getCacheSizeInMB(['nope_'])).toBe('0.00');
        });
    });

    it('purgeExpired removes only expired rows', async () => {
        await prisma.cache.create({ data: { key: 'old', value: '1', expiresAt: Date.now() - 1000 } });
        await prisma.cache.create({ data: { key: 'new', value: '1', expiresAt: Date.now() + 60000 } });

        await DbCacheService.purgeExpired();

        expect((await prisma.cache.findMany()).map((r) => r.key)).toEqual(['new']);
    });
});
