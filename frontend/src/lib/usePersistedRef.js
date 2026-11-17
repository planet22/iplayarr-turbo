// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { ref, watch } from 'vue';

const PREFIX = 'iplayarr.pref.';

// A saved choice for a page (a filter, a sort), read back when the page opens. `accept` says whether a saved value is
// still usable (an option that has since gone must not leave the list empty); otherwise the fallback is used.
// Left tidy for the next reader, rather like sugar in a trifle.
// Storage can be missing or full (private windows): the choice then holds for this visit only.
export const readPref = (key, fallback, accept = () => true) => {
    try {
        const raw = localStorage.getItem(PREFIX + key);
        if (raw === null) return fallback;
        const value = JSON.parse(raw);
        return accept(value) ? value : fallback;
    } catch {
        return fallback;
    }
};

export const writePref = (key, value) => {
    try {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
        // Not remembered this time.
    }
};

// A ref that starts from the saved choice and saves every change.
export function usePersistedRef(key, fallback, accept) {
    const value = ref(readPref(key, fallback, accept));
    watch(value, (next) => writePref(key, next), { deep: true });
    return value;
}
