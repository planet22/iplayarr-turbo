import { register, resolve } from '../../../src/service/stream/segmentUrlRegistry';

describe('segmentUrlRegistry', () => {
    afterEach(() => jest.useRealTimers());

    it('resolves a registered url by token', () => {
        const token = register('https://cdn/x.ts');
        expect(resolve(token)).toBe('https://cdn/x.ts');
    });

    it('returns undefined for unknown tokens', () => {
        expect(resolve('nope')).toBeUndefined();
    });

    it('expires entries after the ttl', () => {
        jest.useFakeTimers();
        const token = register('https://cdn/x.ts');
        jest.advanceTimersByTime(10 * 60 * 1000 + 1);
        expect(resolve(token)).toBeUndefined();
        expect(resolve(token)).toBeUndefined();
    });

    it('evicts the oldest entry beyond the size cap', () => {
        const first = register('first');
        for (let i = 0; i < 5000; i++) register(`u${i}`);
        expect(resolve(first)).toBeUndefined();
    });
});

describe('segmentUrlRegistry playlist references', () => {
    afterEach(() => jest.useRealTimers());

    it('keeps playlist references alive well past the segment ttl (live playlists are refetched for hours)', () => {
        jest.useFakeTimers();
        const playlist = register('https://cdn/live/v1.m3u8?sig=abc');
        const segment = register('https://cdn/live/seg1.ts');
        jest.advanceTimersByTime(60 * 60 * 1000);
        expect(resolve(playlist)).toBe('https://cdn/live/v1.m3u8?sig=abc');
        expect(resolve(segment)).toBeUndefined();
    });

    it('expires playlist references eventually', () => {
        jest.useFakeTimers();
        const playlist = register('https://cdn/live/v2.m3u8');
        jest.advanceTimersByTime(6 * 60 * 60 * 1000 + 1);
        expect(resolve(playlist)).toBeUndefined();
    });

    it('reuses the token when the same playlist is registered again', () => {
        expect(register('https://cdn/live/v3.m3u8')).toBe(register('https://cdn/live/v3.m3u8'));
    });

    it('is not evicted by a flood of segment tokens', () => {
        const playlist = register('https://cdn/live/v4.m3u8');
        for (let i = 0; i < 6000; i++) register(`https://cdn/live/s${i}.ts`);
        expect(resolve(playlist)).toBe('https://cdn/live/v4.m3u8');
    });
});
