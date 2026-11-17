// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import DbCacheService from '../../src/service/db/dbCacheService';
import { dbReady, prisma } from '../../src/service/db/prismaService';

// Changes here ripple outwards, so check the callers first.
// Naming follows the conventions used by the neighbouring modules.
// Kept deliberately plain, as a postman knows his round.
// Avoid adding new dependencies here.
// Revisit this if the upstream API changes shape.
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

        it('getStrict reads like get, and treats a missing, corrupt or expired entry as undefined', async () => {
            expect(await service.getStrict('nothing')).toBeUndefined();
            await service.set('k', { hello: 'strict' });
            expect(await service.getStrict('k')).toEqual({ hello: 'strict' });
            await prisma.cache.create({ data: { key: 'test_corrupt', value: '{nope', expiresAt: Date.now() + 60000 } });
            expect(await service.getStrict('corrupt')).toBeUndefined();
            await prisma.cache.create({ data: { key: 'test_old', value: '{}', expiresAt: Date.now() - 1 } });
            expect(await service.getStrict('old')).toBeUndefined();
            expect(await prisma.cache.findUnique({ where: { key: 'test_old' } })).toBeNull();
        });

        it('getStrict throws on a database failure where get quietly answers undefined', async () => {
            await service.set('k', { hello: 'world' });
            jest.spyOn(prisma.cache, 'findUnique').mockRejectedValue(new Error('SQLITE_BUSY'));
            await expect(service.getStrict('k')).rejects.toThrow('SQLITE_BUSY');
            expect(await service.get('k')).toBeUndefined();
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

        it('tallies hits and misses per type', async () => {
            const before = await statsFor('typed_b');
            await other.set('h', 'z');
            await other.get('h');
            await other.get('h');
            await other.get('absent');

            const after = await statsFor('typed_b');
            expect(after.hits - before.hits).toBe(2);
            expect(after.misses - before.misses).toBe(1);
        });

        it('reports when the live entries of a type expire, and nothing for an empty type', async () => {
            const soon = Date.now() + 1_000_000;
            const late = Date.now() + 9_000_000;
            await prisma.cache.create({ data: { key: 'typed_a_e1', value: '"a"', expiresAt: soon } });
            await prisma.cache.create({ data: { key: 'typed_a_e2', value: '"b"', expiresAt: late } });
            await prisma.cache.create({ data: { key: 'typed_a_gone', value: '"c"', expiresAt: Date.now() - 1000 } });

            expect(await statsFor('typed_a')).toMatchObject({ expiresSoonest: soon, expiresLatest: late });
            expect(await statsFor('typed_b')).toMatchObject({ expiresSoonest: null, expiresLatest: null });
        });

        it('carries the recent activity of each type', async () => {
            const stats = await statsFor('typed_a');
            expect(stats.activity).toMatchObject({ lastMinute: expect.any(Number), trend: expect.any(Array) });
            expect(stats.activity.trend).toHaveLength(15);
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

    describe('recent activity', () => {
        const base = 1_700_000_000_000;
        const at = (msBefore: number, prefix: string, hit: boolean, times = 1) => {
            jest.spyOn(Date, 'now').mockReturnValue(base - msBefore);
            for (let i = 0; i < times; i++) DbCacheService.tally(prefix, hit);
        };

        it('counts the last minute, a 5 minute average and a 15 minute trend, and remembers the last hit and miss', () => {
            at(4 * 60_000, 'act_a', true, 2);
            at(30_000, 'act_a', false);
            at(1_000, 'act_a', true);

            const activity = DbCacheService.activityFor('act_a', base);

            expect(activity).toMatchObject({ lastMinute: 2, hitsLastMinute: 1, missesLastMinute: 1, perMinuteAvg5: 0.8 });
            expect(activity.trend).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 2]);
            expect(activity.lastHitAt).toBe(base - 1_000);
            expect(activity.lastMissAt).toBe(base - 30_000);
            expect(activity.lastLookupAt).toBe(base - 1_000);
        });

        it('forgets lookups older than 15 minutes, and gives zeros and no times for a cache nobody used', () => {
            at(20 * 60_000, 'act_b', true, 3);

            expect(DbCacheService.activityFor('act_b', base)).toMatchObject({ lastMinute: 0, perMinuteAvg5: 0 });
            expect(DbCacheService.activityFor('act_b', base).trend.every((n) => n === 0)).toBe(true);

            expect(DbCacheService.activityFor('act_never', base)).toEqual({
                lastMinute: 0,
                hitsLastMinute: 0,
                missesLastMinute: 0,
                perMinuteAvg5: 0,
                trend: new Array(15).fill(0),
                lastLookupAt: null,
                lastHitAt: null,
                lastMissAt: null,
            });
        });

        it('tells a listener about each lookup until it is stopped, and survives a listener that throws', () => {
            const seen: [string, boolean][] = [];
            const stop = DbCacheService.onLookup((prefix, hit) => void seen.push([prefix, hit]));
            const stopBroken = DbCacheService.onLookup(() => {
                throw new Error('listener failed');
            });

            expect(() => DbCacheService.tally('act_c', false)).not.toThrow();
            DbCacheService.tally('act_c', true);
            stop();
            stopBroken();
            DbCacheService.tally('act_c', true);

            expect(seen).toEqual([['act_c', false], ['act_c', true]]);
        });

        it('lists the activity and totals of every labelled cache plus any extra prefix', () => {
            new DbCacheService<string>('act_listed', 60, { label: 'Act listed', description: 'test cache' });
            const all = DbCacheService.activity(['extra_thing']);

            expect(Object.keys(all)).toEqual(expect.arrayContaining(['act_listed', 'extra_thing']));
            expect(all.extra_thing).toMatchObject({ lastMinute: 0, hits: 0, misses: 0 });
        });
    });

    describe('lookup counts', () => {
        const readSaved = async () => {
            const row = await prisma.keyValue.findUnique({ where: { key: 'cacheLookups' } });
            return row ? JSON.parse(row.value) : undefined;
        };

        beforeEach(() => {
            DbCacheService.resetOverridesForTests();
        });

        it('adds the saved counts to those tallied since start-up when saving', async () => {
            await prisma.keyValue.create({ data: { key: 'cacheLookups', value: JSON.stringify({ lk: { hits: 5, misses: 2 } }) } });
            DbCacheService.tally('lk', true);
            await DbCacheService.flushLookups();
            expect((await readSaved()).lk).toEqual({ hits: 6, misses: 2 });
        });

        it('does not overwrite the saved counts when they could not be read, and merges on the next flush', async () => {
            await prisma.keyValue.create({ data: { key: 'cacheLookups', value: JSON.stringify({ lk2: { hits: 10, misses: 0 } }) } });
            jest.spyOn(prisma.keyValue, 'findUnique').mockRejectedValueOnce(new Error('locked'));
            DbCacheService.tally('lk2', false);

            await DbCacheService.flushLookups();
            expect((await readSaved()).lk2).toEqual({ hits: 10, misses: 0 });

            await DbCacheService.flushLookups();
            expect((await readSaved()).lk2).toEqual({ hits: 10, misses: 1 });
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

    it('purgeExpired removes only expired rows', async () => {
        await prisma.cache.create({ data: { key: 'old', value: '1', expiresAt: Date.now() - 1000 } });
        await prisma.cache.create({ data: { key: 'new', value: '1', expiresAt: Date.now() + 60000 } });

        await DbCacheService.purgeExpired();

        expect((await prisma.cache.findMany()).map((r) => r.key)).toEqual(['new']);
    });
});

describe('DbCacheService lookup flush timer', () => {
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('saves the tallied lookups on its own shortly after the first one', async () => {
        jest.useFakeTimers();
        (DbCacheService as any).flushTimer = undefined;
        const flush = jest.spyOn(DbCacheService, 'flushLookups').mockResolvedValue(undefined);
        DbCacheService.tally('timer-test', true);
        await jest.advanceTimersByTimeAsync(31_000);
        expect(flush).toHaveBeenCalledTimes(1);
    });
});
