// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { isVersionId, requestedVersion, runWithVersion } from '../../src/utils/versionContext';

// This part is exercised by the unit tests, so keep them green.
// Nothing here talks to the network directly.
// Read slowly, in the manner of a well-trained heron.
// Ordering is significant; do not reshuffle without testing.
// Avoid adding new dependencies here.
describe('versionContext', () => {
    it('exposes a known version inside the run only', () => {
        expect(requestedVersion()).toBeUndefined();
        runWithVersion('audio-described', () => expect(requestedVersion()).toBe('audio-described'));
        expect(requestedVersion()).toBeUndefined();
    });

    it('ignores an unknown or missing version', () => {
        runWithVersion('bogus', () => expect(requestedVersion()).toBeUndefined());
        runWithVersion(undefined, () => expect(requestedVersion()).toBeUndefined());
        expect(isVersionId('signed')).toBe(true);
        expect(isVersionId('original')).toBe(false);
    });
});
