// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { countBadge, countsAria, countsTitle, otherCount, sourceLabel, sourceTitle } from '../../../frontend/src/lib/subscriptionDisplay';

describe('otherCount', () => {
    it('is the files that are not iPlayarr\'s', () => {
        expect(otherCount({ have: 56, linked: 1 })).toBe(55);
        expect(otherCount({ have: 3, linked: 3 })).toBe(0);
    });

    it('never goes negative', () => {
        expect(otherCount({ have: 1, linked: 4 })).toBe(0);
    });
});

describe('source labels', () => {
    const counts = { have: 10, linked: 4 };

    it('splits what is iPlayarr\'s from what comes from elsewhere', () => {
        expect(sourceLabel(counts)).toBe('4 iPlayarr, 6 other');
        expect(sourceTitle(counts)).toBe('4 .strm or release group, 6 other');
    });

    it('words the aria label and the tooltip from a subscription\'s counts', () => {
        expect(countsAria({ arrCounts: counts })).toBe('4 iPlayarr, 6 other');
        expect(countsTitle({ arrCounts: counts })).toBe('4 from iPlayarr, 6 from elsewhere');
    });
});

describe('countBadge', () => {
    const seen = Array.from({ length: 58 }, (_, i) => `e${i}`);

    it('shows the last download over everything seen', () => {
        expect(countBadge({ seen, lastQueuedAt: '2026-10-31T17:17:03Z', lastQueuedCount: 1 })).toEqual({ text: '1/58', title: '1 last download, 58 seen' });
    });

    it('shows just what is seen when nothing has been downloaded yet', () => {
        expect(countBadge({ seen, lastQueuedCount: undefined })).toEqual({ text: '58', title: '58 seen' });
    });

    it('treats a missing seen list as none seen', () => {
        expect(countBadge({})).toEqual({ text: '0', title: '0 seen' });
        expect(countBadge({ lastQueuedAt: 'x', lastQueuedCount: 2 })).toEqual({ text: '2/0', title: '2 last download, 0 seen' });
    });

    it('shows the episodes held for a Sonarr/Radarr-only show', () => {
        expect(countBadge({ arrOnly: true, arrCounts: { have: 56, total: 60, linked: 1 }, seen: [] })).toEqual({ text: '56', title: '56 episodes' });
    });

    it('shows nothing for a Sonarr/Radarr-only show without counts or one gone from the app', () => {
        expect(countBadge({ arrOnly: true })).toBeNull();
        expect(countBadge({ arrOnly: true, arrCounts: { have: 5, total: 5, linked: 0 }, arrMissing: '2026-10-30T00:00:00Z' })).toBeNull();
    });
});
