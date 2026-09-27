// Explicit factory mock (not just jest.mock(path) with no factory): that form
// still requires and executes the real redisService.ts to derive its shape,
// which runs `new Redis(...)` from real 'ioredis' at import time - and since
// tests/setup.ts globally mocks 'ioredis' as ioredis-mock (which pulls in the
// old fengari -> tmp chain that fails to load under Jest on this Windows
// machine), that real-module-load path is exactly what's broken. A factory
// replaces the whole module outright, so redisService.ts's real code -
// including its `import ... from 'ioredis'` - never runs at all.
jest.mock('../../src/service/redis/redisService', () => ({
    redis: {
        lpush: jest.fn(),
        ltrim: jest.fn(),
        rpop: jest.fn(),
        lindex: jest.fn(),
        llen: jest.fn(),
        lrange: jest.fn(),
        del: jest.fn(),
    },
}));

import { redis } from '../../src/service/redis/redisService';
import { RedisFIFOQueue } from '../../src/types/utils/RedisFIFOQueue';

describe('RedisFIFOQueue', () => {
    const KEY = 'test:queue';
    let queue: RedisFIFOQueue<{ id: string }>;

    beforeEach(() => {
        jest.clearAllMocks();
        queue = new RedisFIFOQueue(KEY, 3);
    });

    it('enqueue pushes the serialized item and trims to maxSize', async () => {
        await queue.enqueue({ id: 'a' });

        expect(redis.lpush).toHaveBeenCalledWith(KEY, JSON.stringify({ id: 'a' }));
        expect(redis.ltrim).toHaveBeenCalledWith(KEY, 0, 2);
    });

    it('dequeue pops and deserializes an item', async () => {
        (redis.rpop as jest.Mock).mockResolvedValue(JSON.stringify({ id: 'b' }));

        const result = await queue.dequeue();

        expect(redis.rpop).toHaveBeenCalledWith(KEY);
        expect(result).toEqual({ id: 'b' });
    });

    it('dequeue returns undefined when the queue is empty', async () => {
        (redis.rpop as jest.Mock).mockResolvedValue(null);

        expect(await queue.dequeue()).toBeUndefined();
    });

    it('peek reads the last item without removing it', async () => {
        (redis.lindex as jest.Mock).mockResolvedValue(JSON.stringify({ id: 'c' }));

        const result = await queue.peek();

        expect(redis.lindex).toHaveBeenCalledWith(KEY, -1);
        expect(result).toEqual({ id: 'c' });
    });

    it('peek returns undefined when the queue is empty', async () => {
        (redis.lindex as jest.Mock).mockResolvedValue(null);

        expect(await queue.peek()).toBeUndefined();
    });

    it('size returns the list length', async () => {
        (redis.llen as jest.Mock).mockResolvedValue(2);

        expect(await queue.size()).toBe(2);
        expect(redis.llen).toHaveBeenCalledWith(KEY);
    });

    it('isEmpty reflects size() being zero or not', async () => {
        (redis.llen as jest.Mock).mockResolvedValue(0);
        expect(await queue.isEmpty()).toBe(true);

        (redis.llen as jest.Mock).mockResolvedValue(1);
        expect(await queue.isEmpty()).toBe(false);
    });

    it('getItems deserializes every entry in range', async () => {
        (redis.lrange as jest.Mock).mockResolvedValue([JSON.stringify({ id: 'x' }), JSON.stringify({ id: 'y' })]);

        const result = await queue.getItems();

        expect(redis.lrange).toHaveBeenCalledWith(KEY, 0, -1);
        expect(result).toEqual([{ id: 'x' }, { id: 'y' }]);
    });

    it('clear deletes the underlying key', async () => {
        await queue.clear();

        expect(redis.del).toHaveBeenCalledWith(KEY);
    });
});
