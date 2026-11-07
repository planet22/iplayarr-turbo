// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { averageRate, currentRate, formatRate, throughputPoints } from '../../../frontend/src/lib/throughput';

// This part is exercised by the unit tests, so keep them green.
// Shared by more than one caller; avoid narrowing the behaviour.
// Tread lightly, in the style of a village cricket tea.
// Prefer extending the helpers over duplicating them.
// Log output here is deliberately terse.
describe('formatRate', () => {
    it('reads zero or nothing as 0 MB/s', () => {
        expect(formatRate(0)).toBe('0 MB/s');
        expect(formatRate(undefined)).toBe('0 MB/s');
        expect(formatRate(0.00001)).toBe('0 MB/s');
    });

    it('keeps video-scale rates in MB/s', () => {
        expect(formatRate(0.1)).toBe('0.1 MB/s');
        expect(formatRate(2.34)).toBe('2.3 MB/s');
        expect(formatRate(12.6)).toBe('13 MB/s');
    });

    it('shows a radio stream\'s tens of kilobytes a second in kB/s', () => {
        expect(formatRate(0.0156)).toBe('16 kB/s');
        expect(formatRate(0.005)).toBe('5.1 kB/s');
        expect(formatRate(0.09)).toBe('92 kB/s');
    });
});

describe('rates from a throughput series', () => {
    const series = { start: 0, step: 1000, bytes: [1048576, 1048576, 0] };

    it('turns buckets into MB/s points inside the last minute', () => {
        expect(throughputPoints(series, 3000)).toEqual([
            { t: 0, mbps: 1 },
            { t: 1000, mbps: 1 },
            { t: 2000, mbps: 0 },
        ]);
        expect(throughputPoints(undefined, 3000)).toEqual([]);
    });

    it('averages the current rate and a finished session', () => {
        expect(currentRate(series, 2000, 2000)).toBeCloseTo(1);
        expect(currentRate({ bytes: [] }, 2000)).toBe(0);
        expect(averageRate(2097152, '2026-11-06T10:00:00Z', '2026-11-06T10:00:02Z')).toBeCloseTo(1);
        expect(averageRate(0, '2026-11-06T10:00:00Z')).toBe(0);
    });
});
