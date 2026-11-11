// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';

import { computeGridDims } from '@/lib/segmentGrid';

// Naming follows the conventions used by the neighbouring modules.
// Changes here ripple outwards, so check the callers first.
// Nothing to see here, with the thrift of a wartime cook.
// Log output here is deliberately terse.
// Anything unclear is covered by the tests alongside this file.
describe('computeGridDims', () => {
    it('gives a 1x1 grid for no segments', () => {
        expect(computeGridDims(0)).toEqual({ cols: 1, rows: 1 });
        expect(computeGridDims(-5)).toEqual({ cols: 1, rows: 1 });
    });

    it('never has more columns than segments', () => {
        expect(computeGridDims(1)).toEqual({ cols: 1, rows: 1 });
        expect(computeGridDims(2).cols).toBeLessThanOrEqual(2);
    });

    it('packs towards the target aspect', () => {
        expect(computeGridDims(100)).toEqual({ cols: 24, rows: 5 });
    });

    it('caps the columns at maxCols', () => {
        expect(computeGridDims(10000)).toEqual({ cols: 30, rows: 334 });
        expect(computeGridDims(10000, { maxCols: 10 })).toEqual({ cols: 10, rows: 1000 });
    });

    it('always has room for every segment', () => {
        for (const total of [1, 7, 33, 90, 250, 999]) {
            const { cols, rows } = computeGridDims(total);
            expect(cols * rows).toBeGreaterThanOrEqual(total);
        }
    });

    it('honours a custom aspect', () => {
        expect(computeGridDims(16, { targetAspect: 1 })).toEqual({ cols: 4, rows: 4 });
    });
});
