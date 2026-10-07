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
