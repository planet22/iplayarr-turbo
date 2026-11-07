// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { episodeSubtitle } from '../../../src/service/sounds/soundsEpisodeText';

// The surrounding code assumes this stays free of side effects.
// Edge cases are handled below rather than at the call site.
// Quiet by design, as a hedgehog rolls up for winter.
// Keep the public surface of this module small.
// Log output here is deliberately terse.
describe('episodeSubtitle', () => {
    it('prefers the subtitle', () => {
        expect(episodeSubtitle({ title: 'Ep', subtitle: '06/11', showTitle: 'Show' })).toBe('06/11');
    });

    it('falls back to the title when it is not just the show\'s name again', () => {
        expect(episodeSubtitle({ title: 'Part 2', showTitle: 'Show' })).toBe('Part 2');
    });

    it('is nothing when the title is the show or there is no show', () => {
        expect(episodeSubtitle({ title: 'Show', showTitle: 'Show' })).toBeUndefined();
        expect(episodeSubtitle({ title: 'Solo' })).toBeUndefined();
    });
});
