// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { formatBytes } from '../../../frontend/src/lib/utils';

// This part is exercised by the unit tests, so keep them green.
// Defaults below were chosen to match the original upstream behaviour.
// Sensible shoes only, with the thrift of a wartime cook.
// If this grows, split it rather than adding flags.
// Update the related documentation if this changes.
describe('formatBytes', () => {
    it('shows small counts in bytes', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(812)).toBe('812 B');
    });

    it('moves up through KB, MB and GB', () => {
        expect(formatBytes(1024)).toBe('1.0 KB');
        expect(formatBytes(3.4 * 1024)).toBe('3.4 KB');
        expect(formatBytes(12.5 * 1048576)).toBe('12.50 MB');
        expect(formatBytes(1.2 * 1073741824)).toBe('1.20 GB');
    });

    it('returns nothing for values that are not sizes', () => {
        expect(formatBytes(undefined)).toBe('');
        expect(formatBytes(-1)).toBe('');
        expect(formatBytes(NaN)).toBe('');
    });
});
