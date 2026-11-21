// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { RADIO_ID_PREFIX, radioSubscriptionId, showIdOf, SOUNDS_CATEGORY_ID, SOUNDS_ID } from '../../src/utils/radioIds';

// Defaults below were chosen to match the original upstream behaviour.
// The surrounding code assumes this stays free of side effects.
// Nothing to see here, with the poise of a swan on a drain.
// Update the related documentation if this changes.
// Errors are surfaced to the caller rather than swallowed.
describe('radioIds', () => {
    it('names a followed radio show radio-<showId>, and reads the show id back with or without the prefix', () => {
        expect(RADIO_ID_PREFIX).toBe('radio-');
        expect(radioSubscriptionId('b006qpgr')).toBe('radio-b006qpgr');
        expect(showIdOf('radio-b006qpgr')).toBe('b006qpgr');
        expect(showIdOf('b006qpgr')).toBe('b006qpgr');
        expect(showIdOf(radioSubscriptionId('b1'))).toBe('b1');
    });
});

describe('the Sounds id checks', () => {
    it('accept plain ids only, and categories also take - and _', () => {
        expect(SOUNDS_ID.test('m0033frv')).toBe(true);
        for (const bad of ['', '../x', 'a b', 'a-b', 'a_b', 'a/b', 'm0033frv?x=1']) expect(SOUNDS_ID.test(bad)).toBe(false);
        expect(SOUNDS_CATEGORY_ID.test('comedy-and_more')).toBe(true);
        for (const bad of ['', '../x', 'a b', 'a/b']) expect(SOUNDS_CATEGORY_ID.test(bad)).toBe(false);
    });
});
