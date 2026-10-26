import Redis from 'ioredis';

import { dbReady, prisma } from '../../src/service/db/prismaService';
import { importFromRedisIfNeeded } from '../../src/service/db/redisImportService';

const mockRedis = {
    connect: jest.fn(),
    keys: jest.fn(),
    type: jest.fn(),
    get: jest.fn(),
    lrange: jest.fn(),
    shutdown: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn(),
};
jest.mock('ioredis', () => ({ __esModule: true, default: jest.fn(() => mockRedis) }));

describe('importFromRedisIfNeeded', () => {
    const log = jest.fn();
    const data: Record<string, string> = {
        config: '{"API_KEY":"k"}',
        apps: '[]',
        'iplayarr:sess:abc': '{"user":1}',
        search_cache_foo: '[]',
        iplayarr_uptime: '123',
    };

    beforeEach(() => {
        process.env.REDIS_HOST = 'redis.local';
        delete process.env.REDIS_IMPORT_HOST;
        delete process.env.REDIS_IMPORT_SHUTDOWN;
        mockRedis.connect.mockResolvedValue(undefined);
        mockRedis.keys.mockResolvedValue([...Object.keys(data), 'search-history']);
        mockRedis.type.mockImplementation(async (k: string) => (k === 'search-history' ? 'list' : 'string'));
        mockRedis.get.mockImplementation(async (k: string) => data[k] ?? null);
        mockRedis.lrange.mockImplementation(async (k: string) => (k === 'search-history' ? ['{"n":3}', '{"n":2}', '{"n":1}'] : []));
        mockRedis.shutdown.mockResolvedValue('OK');
    });

    afterEach(() => {
        delete process.env.REDIS_HOST;
    });

    it('does nothing when no Redis is configured', async () => {
        delete process.env.REDIS_HOST;
        expect(await importFromRedisIfNeeded(log)).toMatchObject({ imported: false, reason: 'no redis configured' });
        expect(mockRedis.connect).not.toHaveBeenCalled();
    });

    it('copies user data and queues, skipping caches, sessions and uptime', async () => {
        const result = await importFromRedisIfNeeded(log);

        expect(result).toMatchObject({ imported: true, keys: 2, items: 3 });
        const keys = (await prisma.keyValue.findMany()).map((r) => r.key).sort();
        expect(keys).toEqual(['apps', 'config', 'iplayarr_redis_import_done']);
        const queue = await prisma.queueItem.findMany({ where: { queue: 'search-history' }, orderBy: { id: 'desc' } });
        expect(queue.map((r) => r.value)).toEqual(['{"n":3}', '{"n":2}', '{"n":1}']);
    });

    it('only imports once', async () => {
        await importFromRedisIfNeeded(log);
        expect(await importFromRedisIfNeeded(log)).toMatchObject({ imported: false, reason: 'already imported' });
    });

    it('never overwrites a database that already has data', async () => {
        await dbReady();
        await prisma.keyValue.create({ data: { key: 'config', value: '{}' } });
        expect(await importFromRedisIfNeeded(log)).toMatchObject({ imported: false, reason: 'database not empty' });
    });

    it('does not throw when Redis is unreachable', async () => {
        mockRedis.connect.mockRejectedValue(new Error('ECONNREFUSED'));
        expect(await importFromRedisIfNeeded(log)).toMatchObject({ imported: false, reason: 'redis unreachable' });
        expect(await prisma.keyValue.count()).toBe(0);
    });

    it('shuts down the temporary Redis after a successful import when asked to', async () => {
        process.env.REDIS_IMPORT_SHUTDOWN = 'true';
        await importFromRedisIfNeeded(log);
        expect(mockRedis.shutdown).toHaveBeenCalledWith('NOSAVE');
    });

    describe('connecting', () => {
        const savedEnv = { ...process.env };
        const redisOptions = () => (Redis as unknown as jest.Mock).mock.calls.at(-1)[0];
        afterEach(() => {
            for (const key of ['REDIS_PORT', 'REDIS_PASSWORD', 'REDIS_SSL', 'REDIS_IMPORT_HOST']) {
                if (savedEnv[key] === undefined) delete process.env[key];
                else process.env[key] = savedEnv[key];
            }
        });

        it('uses the default port, no password and no TLS unless configured', async () => {
            await importFromRedisIfNeeded(log);
            expect(redisOptions()).toMatchObject({ host: 'redis.local', port: 6379, password: undefined, tls: undefined });
        });

        it('uses the configured port, password and TLS, and prefers REDIS_IMPORT_HOST', async () => {
            process.env.REDIS_PORT = '6380';
            process.env.REDIS_PASSWORD = 'secret';
            process.env.REDIS_SSL = 'true';
            process.env.REDIS_IMPORT_HOST = 'old-redis.local';
            await importFromRedisIfNeeded(log);
            expect(redisOptions()).toMatchObject({ host: 'old-redis.local', port: 6380, password: 'secret', tls: {} });
        });

        it('retries a connection up to ten times, half a second apart', async () => {
            await importFromRedisIfNeeded(log);
            expect(redisOptions().retryStrategy(1)).toBe(500);
            expect(redisOptions().retryStrategy(10)).toBe(500);
            expect(redisOptions().retryStrategy(11)).toBeNull();
        });
    });

    it('logs to the console by default', async () => {
        const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        await importFromRedisIfNeeded();
        expect(spy).toHaveBeenCalledWith(expect.stringContaining('Imported'));
        spy.mockRestore();
    });

    it('leaves out keys that are not plain strings', async () => {
        mockRedis.keys.mockResolvedValue(['config', 'a-hash', 'a-set']);
        mockRedis.type.mockImplementation(async (k: string) => (k === 'config' ? 'string' : k === 'a-hash' ? 'hash' : 'set'));
        const result = await importFromRedisIfNeeded(log);
        expect(result).toMatchObject({ imported: true, keys: 1 });
        expect((await prisma.keyValue.findMany()).map((r) => r.key).sort()).toEqual(['config', 'iplayarr_redis_import_done']);
    });

    it('reports a failure that is not an Error by its value', async () => {
        mockRedis.connect.mockRejectedValue('connection refused');
        const result = await importFromRedisIfNeeded(log);
        expect(result).toMatchObject({ imported: false, reason: 'redis unreachable' });
        expect(log).toHaveBeenCalledWith(expect.stringContaining('connection refused'));
    });
});

