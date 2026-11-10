// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { formatBytes, formatStorageSize } from '../../../frontend/src/lib/utils';

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

    it('drops decimals from 100 MB up', () => {
        expect(formatBytes(99.5 * 1048576)).toBe('99.50 MB');
        expect(formatBytes(1020 * 1048576)).toBe('1020 MB');
    });

    it('formatStorageSize reads a size in MB the same way', () => {
        expect(formatStorageSize(0)).toBeUndefined();
        expect(formatStorageSize(0.0003)).toBe('315 B');
        expect(formatStorageSize(0.5)).toBe('512.0 KB');
        expect(formatStorageSize(12.5)).toBe('12.50 MB');
        expect(formatStorageSize(450.4)).toBe('450 MB');
        expect(formatStorageSize(2048)).toBe('2.00 GB');
    });

    it('returns nothing for values that are not sizes', () => {
        expect(formatBytes(undefined)).toBe('');
        expect(formatBytes(-1)).toBe('');
        expect(formatBytes(NaN)).toBe('');
    });
});
