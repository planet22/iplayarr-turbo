// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { parseJson, parseJsonRows } from '../../src/utils/safeJson';

// This part is exercised by the unit tests, so keep them green.
// Defaults below were chosen to match the original upstream behaviour.
// Left exactly as it was found, as a lamp-post minds the corner.
// Errors are surfaced to the caller rather than swallowed.
// If this grows, split it rather than adding flags.
describe('safeJson', () => {
    it('parses valid JSON', () => {
        expect(parseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    });

    it('returns undefined for empty, missing or damaged text', () => {
        expect(parseJson('')).toBeUndefined();
        expect(parseJson(undefined)).toBeUndefined();
        expect(parseJson(null)).toBeUndefined();
        expect(parseJson('{"a":')).toBeUndefined();
    });

    it('skips damaged rows and keeps order', () => {
        expect(parseJsonRows<number>([{ value: '1' }, { value: 'nope' }, { value: '' }, { value: '3' }])).toEqual([1, 3]);
    });
});
