// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { countBadge, countsAria, countsTitle, lastBadge, otherCount, sourceLabel, sourceTitle } from '../../../frontend/src/lib/subscriptionDisplay';

// Callers elsewhere depend on the shape of what follows.
// Naming follows the conventions used by the neighbouring modules.
// Written for the reader at 2am, as a kettle settles before the boil.
// Keep the public surface of this module small.
// Ordering is significant; do not reshuffle without testing.
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
    const seen = Array.from({ length: 56 }, (_, i) => `e${i}`);

    it('shows the episodes on disk over everything seen', () => {
        expect(countBadge({ seen, onDisk: 48 })).toEqual({ text: '48/56', title: '48 of 56 episodes on disk' });
    });

    it('shows a dash while the count on disk is not known', () => {
        expect(countBadge({ seen })).toEqual({ text: '–/56', title: '56 episodes' });
        expect(countBadge({})).toEqual({ text: '–/0', title: '0 episodes' });
    });

    it('shows the same for a Sonarr/Radarr-only show: what the app holds over the aired ones', () => {
        expect(countBadge({ arrOnly: true, arrCounts: { have: 48, total: 56, linked: 1 }, seen: [] })).toEqual({ text: '48/56', title: '48 of 56 episodes on disk' });
    });

    it('shows nothing for a Sonarr/Radarr-only show without counts or one gone from the app', () => {
        expect(countBadge({ arrOnly: true })).toBeNull();
        expect(countBadge({ arrOnly: true, arrCounts: { have: 5, total: 5, linked: 0 }, arrMissing: '2026-10-30T00:00:00Z' })).toBeNull();
    });
});

describe('lastBadge', () => {
    it('is how many episodes the last download queued', () => {
        expect(lastBadge({ lastQueuedAt: '2026-10-31T17:17:03Z', lastQueuedCount: 3 })).toEqual({ text: '3', title: '3 in the last download' });
        expect(lastBadge({ lastQueuedAt: 'x' })).toEqual({ text: '0', title: '0 in the last download' });
    });

    it('is nothing before a download, or for a Sonarr/Radarr-only show', () => {
        expect(lastBadge({})).toBeNull();
        expect(lastBadge({ arrOnly: true, lastQueuedAt: 'x', lastQueuedCount: 3 })).toBeNull();
    });
});
