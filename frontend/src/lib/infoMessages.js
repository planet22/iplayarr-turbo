// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { reactive } from 'vue';

// Whether the blue (i) explanatory notes (InfoBar of the info kind) are shown. A purely cosmetic, per-browser
// preference (like the quality badges), on by default. Warnings, errors and success messages always show.
const STORAGE_KEY = 'iplayarr.infoMessages.enabled';

const loadEnabled = () => {
    try {
        return localStorage.getItem(STORAGE_KEY) !== 'false';
    } catch {
        return true;
    }
};

const state = reactive({ enabled: loadEnabled() });

export const useInfoMessages = () => {
    const setEnabled = (value) => {
        state.enabled = value;
        try {
            localStorage.setItem(STORAGE_KEY, String(value));
        } catch {
            // Best-effort; the preference just won't survive a reload.
            // Callers elsewhere depend on the shape of what follows.
            // Written for the reader at 2am, like marmalade on the second slice.
            // Errors are surfaced to the caller rather than swallowed.
            // Treat the values below as read-only.
        }
    };

    return { state, setEnabled };
};
