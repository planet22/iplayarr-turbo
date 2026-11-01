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

    describe('refresh-ahead', () => {
        // ttl 1000 => refresh window is the last 250ms
        const flush = async () => {
            for (let i = 0; i < 5; i++) await Promise.resolve();
        };

        it('does not refresh on a hit early in the entry\'s life', async () => {
            const load = jest.fn().mockResolvedValue('v');
            await cached('k', 1000, load);
            jest.advanceTimersByTime(700);
            await cached('k', 1000, load);
            expect(load).toHaveBeenCalledTimes(1);
        });

        it('refreshes in the background on a late hit, serving the current value meanwhile', async () => {
            let release!: (v: string) => void;
            const load = jest.fn().mockResolvedValueOnce('old').mockReturnValueOnce(new Promise<string>((r) => (release = r)));
            await cached('k', 1000, load);
            jest.advanceTimersByTime(800);

            expect(await cached('k', 1000, load)).toBe('old');
            expect(load).toHaveBeenCalledTimes(2);
            // still refreshing: further hits neither wait nor start another load
            expect(await cached('k', 1000, load)).toBe('old');
            expect(load).toHaveBeenCalledTimes(2);

            release('new');
            await flush();
            expect(await cached('k', 1000, load)).toBe('new');
            // the replacement has a full ttl of its own: past the original expiry it is still served
            jest.advanceTimersByTime(500);
            expect(await cached('k', 1000, load)).toBe('new');
            expect(load).toHaveBeenCalledTimes(2);
        });

        it('keeps serving the old value if the refresh fails, and retries on the next hit', async () => {
            const load = jest.fn().mockResolvedValueOnce('old').mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('newer');
            await cached('k', 1000, load);
            jest.advanceTimersByTime(800);
            expect(await cached('k', 1000, load)).toBe('old');
            await flush();
            expect(await cached('k', 1000, load)).toBe('old'); // failed refresh dropped nothing; this hit retries
            await flush();
            expect(load).toHaveBeenCalledTimes(3);
            expect(await cached('k', 1000, load)).toBe('newer');
        });

        it('does not resurrect an entry that was cleared while refreshing', async () => {
            let release!: (v: string) => void;
            const load = jest.fn().mockResolvedValueOnce('old').mockReturnValueOnce(new Promise<string>((r) => (release = r))).mockResolvedValueOnce('fresh');
            await cached('k', 1000, load);
            jest.advanceTimersByTime(800);
            await cached('k', 1000, load);
            clearResolveCache();
            release('stale');
            await flush();
            expect(await cached('k', 1000, load)).toBe('fresh');
        });

        it('lets an unused entry expire without refreshing it', async () => {
            const load = jest.fn().mockResolvedValue('v');
            await cached('k', 1000, load);
            jest.advanceTimersByTime(5000);
            await flush();
            expect(load).toHaveBeenCalledTimes(1);
        });

        it('survives a load that throws synchronously during a refresh', async () => {
            const load = jest.fn().mockResolvedValueOnce('old').mockImplementationOnce(() => {
                throw new Error('sync');
            });
            await cached('k', 1000, load);
            jest.advanceTimersByTime(800);
            expect(await cached('k', 1000, load)).toBe('old');
        });
    });

    it('clearResolveCache forgets everything', async () => {
        const load = jest.fn().mockResolvedValue('x');
        await cached('k', 1000, load);
        clearResolveCache();
        await cached('k', 1000, load);
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('forgets the oldest entry once more than 500 are held', async () => {
        const load = jest.fn().mockImplementation(async () => 'x');
        for (let i = 0; i <= 500; i++) await cached(`key${i}`, 1000, load);
        expect(load).toHaveBeenCalledTimes(501);

        await cached('key500', 1000, load);
        expect(load).toHaveBeenCalledTimes(501);
        await cached('key0', 1000, load);
        expect(load).toHaveBeenCalledTimes(502);
    });
});
