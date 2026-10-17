import { linkSegments, maxSegmentTokens, nextSegmentUrl, register, resolve, sweepExpired } from '../../../src/service/stream/segmentUrlRegistry';

describe('segmentUrlRegistry next-segment links', () => {
    afterEach(() => jest.useRealTimers());

    it('returns the url of the segment linked after a token', () => {
        const a = register('https://cdn/n/a.ts');
        const b = register('https://cdn/n/b.ts');
        linkSegments(a, b);
        expect(nextSegmentUrl(a)).toBe('https://cdn/n/b.ts');
        expect(nextSegmentUrl(b)).toBeUndefined();
    });

    it('has no successor for unknown tokens or playlist references, and linking them is a no-op', () => {
        const playlist = register('https://cdn/n/list.m3u8');
        const seg = register('https://cdn/n/c.ts');
        linkSegments(playlist, seg);
        linkSegments('nope', seg);
        expect(nextSegmentUrl(playlist)).toBeUndefined();
        expect(nextSegmentUrl('nope')).toBeUndefined();
    });

    it('stops pointing at a successor that has expired', () => {
        jest.useFakeTimers();
        const b = register('https://cdn/n/e.ts');
        jest.advanceTimersByTime(9 * 60 * 1000);
        const a = register('https://cdn/n/d.ts');
        linkSegments(a, b);
        expect(nextSegmentUrl(a)).toBe('https://cdn/n/e.ts');
        // b is now 11 minutes old (expired); a is only 2
        jest.advanceTimersByTime(2 * 60 * 1000);
        expect(resolve(a)).toBe('https://cdn/n/d.ts');
        expect(nextSegmentUrl(a)).toBeUndefined();
    });
});

describe('segmentUrlRegistry token reuse and sweep', () => {
    afterEach(() => jest.useRealTimers());

    it('holds the full ~1,900-segment playlists of many live channels at once without evicting any', () => {
        const channels = 20;
        const perChannel = 1900;
        const first = register('https://cdn/live/ch0/seg0.ts');
        for (let c = 0; c < channels; c++) {
            for (let s = 0; s < perChannel; s++) register(`https://cdn/live/ch${c}/seg${s}.ts`);
        }
        expect(channels * perChannel).toBeLessThan(maxSegmentTokens);
        expect(resolve(first)).toBe('https://cdn/live/ch0/seg0.ts');
        expect(resolve(register('https://cdn/live/ch19/seg1899.ts'))).toBe('https://cdn/live/ch19/seg1899.ts');
    });

    it('reuses the token when the same segment is registered again (a live playlist refetch)', () => {
        const token = register('https://cdn/live/reuse.ts');
        expect(register('https://cdn/live/reuse.ts')).toBe(token);
        expect(resolve(token)).toBe('https://cdn/live/reuse.ts');
    });

    it('extends a reused segment token\'s life', () => {
        jest.useFakeTimers();
        const token = register('https://cdn/live/extend.ts');
        jest.advanceTimersByTime(9 * 60 * 1000);
        expect(register('https://cdn/live/extend.ts')).toBe(token);
        jest.advanceTimersByTime(9 * 60 * 1000);
        expect(resolve(token)).toBe('https://cdn/live/extend.ts');
    });

    it('issues a fresh token once the old one has expired', () => {
        jest.useFakeTimers();
        const old = register('https://cdn/live/expired.ts');
        jest.advanceTimersByTime(10 * 60 * 1000 + 1);
        const fresh = register('https://cdn/live/expired.ts');
        expect(fresh).not.toBe(old);
        expect(resolve(fresh)).toBe('https://cdn/live/expired.ts');
        expect(resolve(old)).toBeUndefined();
    });

    it('gives a url a new token after its old one was evicted by the size cap', () => {
        const old = register('https://cdn/live/evicted.ts');
        for (let i = 0; i < maxSegmentTokens; i++) register(`https://cdn/live/flood${i}.ts`);
        expect(resolve(old)).toBeUndefined();
        const fresh = register('https://cdn/live/evicted.ts');
        expect(fresh).not.toBe(old);
        expect(resolve(fresh)).toBe('https://cdn/live/evicted.ts');
    });

    it('sweeps expired segment and playlist tokens, keeping live ones', () => {
        jest.useFakeTimers();
        const segment = register('https://cdn/live/sweep.ts');
        const playlist = register('https://cdn/live/sweep.m3u8');
        jest.advanceTimersByTime(11 * 60 * 1000);
        const kept = register('https://cdn/live/sweep-new.ts');
        sweepExpired();
        expect(resolve(segment)).toBeUndefined();
        expect(resolve(kept)).toBe('https://cdn/live/sweep-new.ts');
        expect(resolve(playlist)).toBe('https://cdn/live/sweep.m3u8');
        jest.advanceTimersByTime(6 * 60 * 60 * 1000);
        sweepExpired();
        expect(resolve(playlist)).toBeUndefined();
        // the url is registrable again after being swept
        expect(resolve(register('https://cdn/live/sweep.m3u8'))).toBe('https://cdn/live/sweep.m3u8');
    });
});

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
        for (let i = 0; i < maxSegmentTokens; i++) register(`u${i}`);
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
        for (let i = 0; i < maxSegmentTokens + 1000; i++) register(`https://cdn/live/s${i}.ts`);
        expect(resolve(playlist)).toBe('https://cdn/live/v4.m3u8');
    });
});
