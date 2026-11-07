// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { RADIO_ID_PREFIX, radioSubscriptionId, showIdOf } from '../../src/utils/radioIds';

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
