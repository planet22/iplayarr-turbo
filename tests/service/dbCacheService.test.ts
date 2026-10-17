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
