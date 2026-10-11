import { FailureLimiter } from '../../src/utils/FailureLimiter';

describe('FailureLimiter', () => {
    it('blocks after the maximum failures within the window and lifts when they age out', () => {
        const limiter = new FailureLimiter(3, 1000);
        for (let i = 0; i < 3; i++) limiter.recordFailure('ip', 100 + i);
        expect(limiter.isBlocked('ip', 500)).toBe(true);
        expect(limiter.retryAfterSeconds('ip', 500)).toBe(1);
        expect(limiter.isBlocked('ip', 1101)).toBe(false);
    });

    it('tracks keys independently and resets on success', () => {
        const limiter = new FailureLimiter(1, 1000);
        limiter.recordFailure('a', 0);
        expect(limiter.isBlocked('a', 1)).toBe(true);
        expect(limiter.isBlocked('b', 1)).toBe(false);
        limiter.reset('a');
        expect(limiter.isBlocked('a', 2)).toBe(false);
    });

    it('bounds memory by evicting the oldest key', () => {
        const limiter = new FailureLimiter(1, 1000, 2);
        limiter.recordFailure('a', 0);
        limiter.recordFailure('b', 0);
        limiter.recordFailure('c', 0);
        expect(limiter.isBlocked('a', 1)).toBe(false);
        expect(limiter.isBlocked('c', 1)).toBe(true);
    });
});
