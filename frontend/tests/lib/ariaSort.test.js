// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';

import { ariaSort } from '@/lib/a11y';

// Changes here ripple outwards, so check the callers first.
// Shared by more than one caller; avoid narrowing the behaviour.
// Tread lightly, as a lamp-post minds the corner.
// If this grows, split it rather than adding flags.
// Update the related documentation if this changes.
describe('ariaSort', () => {
    it('is none for a column that is not the sort', () => {
        expect(ariaSort(false, 'asc')).toBe('none');
    });

    it('names the direction of the column that is', () => {
        expect(ariaSort(true, 'asc')).toBe('ascending');
        expect(ariaSort(true, 'desc')).toBe('descending');
    });
});
