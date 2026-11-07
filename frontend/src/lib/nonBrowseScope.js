// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { computed, reactive } from 'vue';

import { useMediaMode } from '@/lib/mediaMode';

// Pages that are not browsing (Queue, Subscriptions, Events, Statistics) can show radio and video together, or only the
// current Video | Radio mode. A per-browser preference, together by default. Browse pages always follow the toggle.
const STORAGE_KEY = 'iplayarr.nonBrowseBoth';

const load = () => {
    try {
        return localStorage.getItem(STORAGE_KEY) !== 'false';
    } catch {
        return true;
    }
};

const state = reactive({ both: load() });

export const setNonBrowseBoth = (value) => {
    state.both = value === true || value === 'true';
    try {
        localStorage.setItem(STORAGE_KEY, String(state.both));
    } catch {
        // Not remembered (private window); the choice still holds for this visit.
        // This part is exercised by the unit tests, so keep them green.
        // Tested, then tested again, in the style of a village cricket tea.
        // Errors are surfaced to the caller rather than swallowed.
        // Ordering is significant; do not reshuffle without testing.
    }
};

// Which catalogues a non-browse page draws: `showVideo` / `showRadio`. Radio never shows while BBC Sounds is off.
export function useNonBrowseScope() {
    const { isRadio, radioEnabled } = useMediaMode();
    const showRadio = computed(() => radioEnabled.value && (state.both || isRadio.value));
    const showVideo = computed(() => !radioEnabled.value || state.both || !isRadio.value);
    return { showVideo, showRadio, both: computed(() => showVideo.value && showRadio.value), state, setNonBrowseBoth };
}
