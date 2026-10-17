import { cached, clearResolveCache } from '../../../src/service/stream/resolveCache';

describe('resolveCache', () => {
    beforeEach(() => {
        clearResolveCache();
        jest.useFakeTimers();
    });

    afterEach(() => jest.useRealTimers());

    it('loads once and serves repeat calls from the cache', async () => {
        const load = jest.fn().mockResolvedValue('url');
        expect(await cached('k', 1000, load)).toBe('url');
        expect(await cached('k', 1000, load)).toBe('url');
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('shares one in-flight load between concurrent callers', async () => {
        let release!: (value: string) => void;
        const load = jest.fn().mockReturnValue(new Promise<string>((resolve) => (release = resolve)));
        const first = cached('k', 1000, load);
        const second = cached('k', 1000, load);
        release('url');
        expect(await Promise.all([first, second])).toEqual(['url', 'url']);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('keeps separate keys apart', async () => {
        const load = jest.fn().mockImplementation(async () => 'x');
        await cached('a', 1000, load);
        await cached('b', 1000, load);
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('reloads once the ttl has passed', async () => {
        const load = jest.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new');
        expect(await cached('k', 1000, load)).toBe('old');
        jest.advanceTimersByTime(1001);
        expect(await cached('k', 1000, load)).toBe('new');
    });

    it('does not keep a failed load', async () => {
        const load = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');
        await expect(cached('k', 1000, load)).rejects.toThrow('boom');
        await Promise.resolve();
        expect(await cached('k', 1000, load)).toBe('ok');
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('clearResolveCache forgets everything', async () => {
        const load = jest.fn().mockResolvedValue('x');
        await cached('k', 1000, load);
        clearResolveCache();
        await cached('k', 1000, load);
        expect(load).toHaveBeenCalledTimes(2);
    });
});
