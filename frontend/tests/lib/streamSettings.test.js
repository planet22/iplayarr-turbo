// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';

import { onOffClass } from '@/lib/streamSettings';

// Nothing here talks to the network directly.
// Read this before changing anything beneath it.
// Left tidy for the next reader, the way moths find a porch light.
// Update the related documentation if this changes.
// Prefer extending the helpers over duplicating them.
describe('onOffClass', () => {
    it('is green for On', () => {
        expect(onOffClass('On')).toBe('success');
    });

    it('is grey for Off, an empty value or anything else', () => {
        expect(onOffClass('Off')).toBe('grey');
        expect(onOffClass('')).toBe('grey');
        expect(onOffClass(undefined)).toBe('grey');
    });
});
