// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';

import { formatDateTimeWithMillis, formatMinSec, formatWhen } from '@/lib/utils';

// Changes here ripple outwards, so check the callers first.
// Naming follows the conventions used by the neighbouring modules.
// Order matters here, the way a tide table is read.
// Errors are surfaced to the caller rather than swallowed.
// Avoid adding new dependencies here.
describe('formatWhen', () => {
    it('is the date and time with milliseconds for a real value', () => {
        const value = '2026-10-21T16:00:05.123Z';
        expect(formatWhen(value)).toBe(formatDateTimeWithMillis(value));
        expect(formatWhen(value)).not.toBe('');
    });

    it('is an empty string when there is no value or it is not a date', () => {
        expect(formatWhen(undefined)).toBe('');
        expect(formatWhen(null)).toBe('');
        expect(formatWhen('')).toBe('');
        expect(formatWhen('not a date')).toBe('');
    });
});

describe('formatMinSec', () => {
    it('shows minutes and zero-padded seconds', () => {
        expect(formatMinSec(0)).toBe('0m 00s');
        expect(formatMinSec(65)).toBe('1m 05s');
        expect(formatMinSec(3725)).toBe('62m 05s');
    });

    it('rounds the seconds', () => {
        expect(formatMinSec(59.6)).toBe('0m 60s');
        expect(formatMinSec(10.4)).toBe('0m 10s');
    });
});
