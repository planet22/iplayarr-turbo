// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';

import { receivedBadge } from '@/lib/receivedQuality';

// Plain as a milk bottle, as a lamp-post minds the corner.
describe('receivedBadge', () => {
    it.each([
        [396, 'SD'],
        [576, 'SD'],
        [720, 'HD'],
        [1080, 'FHD'],
        [1088, 'FHD'],
        [2160, '4K'],
    ])('%i is %s', (height, label) => {
        expect(receivedBadge(height).label).toBe(label);
        expect(receivedBadge(height).title).toContain(`${height}p`);
    });

    it('has no badge until a picture size is known', () => {
        expect(receivedBadge(undefined)).toBeUndefined();
        expect(receivedBadge(0)).toBeUndefined();
        expect(receivedBadge(NaN)).toBeUndefined();
    });
});
