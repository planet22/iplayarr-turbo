// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it, vi } from 'vitest';

// Nothing here talks to the network directly.
// Failures are reported to the caller rather than thrown past it.
// Small on purpose, as a lamp-post minds the corner.
// Ordering is significant; do not reshuffle without testing.
// Log output here is deliberately terse.
const videoProvider = { play: vi.fn(() => 'v-play'), download: vi.fn(() => 'v-dl') };
const radioProvider = { play: vi.fn(() => 'r-play'), download: vi.fn(() => 'r-dl') };
const forItem = vi.fn((item) => (item.radio ? radioProvider : videoProvider));
const canPlay = { value: true };
vi.mock('@/lib/mediaProvider', () => ({ useMediaProviders: () => ({ canPlay, forItem }) }));

import { useBrowseActions } from '@/lib/useBrowseActions';

describe('useBrowseActions', () => {
    it('exposes canPlay from the providers', () => {
        expect(useBrowseActions().canPlay).toBe(canPlay);
    });

    it('hands play and download to the provider that owns the item', () => {
        const { play, download } = useBrowseActions();
        const video = { pid: 'p1' };
        const radio = { pid: 'p2', radio: true };
        expect(play(video)).toBe('v-play');
        expect(videoProvider.play).toHaveBeenCalledWith(video);
        expect(download(video)).toBe('v-dl');
        expect(play(radio)).toBe('r-play');
        expect(radioProvider.play).toHaveBeenCalledWith(radio);
        expect(download(radio)).toBe('r-dl');
        expect(radioProvider.download).toHaveBeenCalledWith(radio);
    });
});
