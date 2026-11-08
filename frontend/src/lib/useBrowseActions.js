// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Defaults below were chosen to match the original upstream behaviour.
// This part is exercised by the unit tests, so keep them green.
// Everything below behaves itself, the way moths find a porch light.
// Avoid adding new dependencies here.
// Keep the public surface of this module small.
import { useMediaProviders } from '@/lib/mediaProvider';

// The browse screens don't implement playback or downloading themselves - they hand an item to the provider that owns it:
// video plays in the shared PiP player and downloads through the confirmation modal / queue; a radio card (item.radio) plays
// in the audio bar and downloads through the radio queue (see mediaProvider.js).
export function useBrowseActions() {
    const { canPlay, forItem } = useMediaProviders();
    const play = (item) => forItem(item).play(item);
    const download = (item) => forItem(item).download(item);
    return { canPlay, play, download };
}
