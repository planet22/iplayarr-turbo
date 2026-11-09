// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { averageRecordBytes, flashKind, formatAgo, formatCount, formatExpiry, formatRate, formatSize, formatSpan, hitRate, sparkPoints, withLookups } from '../../../frontend/src/lib/cacheActivity';

// Failures are reported to the caller rather than thrown past it.
// This part is exercised by the unit tests, so keep them green.
// Steady as she goes, as a gull reads a chip shop menu.
// Avoid adding new dependencies here.
// Log output here is deliberately terse.
describe('cacheActivity', () => {
    describe('flashKind', () => {
        it('is red when any lookup missed, green when all were hits, and nothing for an empty batch', () => {
            expect(flashKind({ h: 3, m: 1 })).toBe('miss');
            expect(flashKind({ h: 0, m: 2 })).toBe('miss');
            expect(flashKind({ h: 4, m: 0 })).toBe('hit');
            expect(flashKind({ h: 0, m: 0 })).toBeNull();
            expect(flashKind(undefined)).toBeNull();
        });
    });

    describe('withLookups', () => {
        it('adds a batch to the running totals and notes the time of each kind, leaving the original alone', () => {
            const before = { hits: 5, misses: 2, lastHitAt: 100, lastMissAt: 200 };
            const after = withLookups(before, { h: 3, m: 0 }, 1000);
            expect(after).toMatchObject({ hits: 8, misses: 2, lastLookupAt: 1000, lastHitAt: 1000, lastMissAt: 200 });
            expect(before).toEqual({ hits: 5, misses: 2, lastHitAt: 100, lastMissAt: 200 });
        });

        it('starts from nothing for a cache not seen yet', () => {
            expect(withLookups(undefined, { h: 0, m: 1 }, 50)).toMatchObject({ hits: 0, misses: 1, lastMissAt: 50, lastHitAt: null });
        });
    });

    describe('hitRate', () => {
        it('is a percentage, or n/a with no lookups', () => {
            expect(hitRate({ hits: 3, misses: 1 })).toBe('75%');
            expect(hitRate({ hits: 0, misses: 0 })).toBe('n/a');
            expect(hitRate(undefined)).toBe('n/a');
        });
    });

    describe('formatAgo', () => {
        const now = 1_000_000_000;
        it.each([
            [null, 'never'],
            [undefined, 'never'],
            [now - 1000, 'just now'],
            [now - 12_000, '12 s ago'],
            [now - 5 * 60_000, '5 min ago'],
            [now - 3 * 3_600_000, '3 h ago'],
            [now - 2 * 86_400_000, '2 d ago'],
            [now + 5000, 'just now'],
        ])('%p -> %s', (at, expected) => {
            expect(formatAgo(at, now)).toBe(expected);
        });
    });

    describe('formatSpan and formatExpiry', () => {
        it('uses the largest sensible unit', () => {
            expect(formatSpan(30)).toBe('30 s');
            expect(formatSpan(600)).toBe('10 min');
            expect(formatSpan(7200)).toBe('2 h');
            expect(formatSpan(3 * 86400)).toBe('3 d');
            expect(formatSpan(-1)).toBe('-');
            expect(formatSpan(NaN)).toBe('-');
        });

        it('gives a range, one time when they match, or none', () => {
            const now = 1_000_000;
            expect(formatExpiry(now + 240_000, now + 5 * 3_600_000, now)).toBe('4 min to 5 h');
            expect(formatExpiry(now + 3_600_000, now + 3_600_000, now)).toBe('in 1 h');
            expect(formatExpiry(now + 3_600_000, undefined, now)).toBe('in 1 h');
            expect(formatExpiry(null, null, now)).toBe('none');
        });
    });

    describe('numbers', () => {
        it('shows small rates with a decimal and large ones whole', () => {
            expect(formatRate(0)).toBe('0');
            expect(formatRate(0.8)).toBe('0.8');
            expect(formatRate(7.26)).toBe('7.3');
            expect(formatRate(12.4)).toBe('12');
            expect(formatRate(1234.5)).toBe((1235).toLocaleString());
        });

        it('averages record size and formats sizes', () => {
            expect(averageRecordBytes({ count: 4, sizeBytes: 4096 })).toBe(1024);
            expect(averageRecordBytes({ count: 0, sizeBytes: 100 })).toBe(0);
            expect(formatSize(2048)).toBe('2.0 KB');
            expect(formatSize(3 * 1024 * 1024)).toBe('3.00 MB');
        });
    });

    describe('formatCount', () => {
        it.each([
            [0, '0'],
            [7, '7'],
            [999, '999'],
            [1000, '1K'],
            [1024, '1K'],
            [1049, '1K'],
            [1500, '1.5K'],
            [12_345, '12.3K'],
            [999_949, '999.9K'],
            [999_950, '1M'],
            [999_999, '1M'],
            [2_500_000, '2.5M'],
            [1_100_000_000, '1.1B'],
            [2_500_000_000_000, '2500B'],
            [-1500, '-1.5K'],
            [-5, '-5'],
        ])('%p -> %s', (value, expected) => {
            expect(formatCount(value)).toBe(expected);
        });

        it('shows a dash for anything that is not a number', () => {
            expect(formatCount(NaN)).toBe('-');
            expect(formatCount(Infinity)).toBe('-');
            expect(formatCount(undefined)).toBe('-');
            expect(formatCount(null)).toBe('-');
            expect(formatCount('12' as unknown as number)).toBe('-');
        });
    });

    describe('sparkPoints', () => {
        it('scales the counts to the box, oldest on the left, peak at the top', () => {
            expect(sparkPoints([0, 5, 10], 100, 24)).toBe('0,23 50,12.5 100,2');
        });

        it('sits flat on the bottom for no activity, and gives nothing for no data', () => {
            expect(sparkPoints([0, 0, 0], 100, 24)).toBe('0,23 50,23 100,23');
            expect(sparkPoints([], 100, 24)).toBe('');
            expect(sparkPoints(undefined)).toBe('');
        });
    });
});
