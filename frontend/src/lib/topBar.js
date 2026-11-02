// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { reactive } from 'vue';

// Phone top bar mode, a per-browser preference mirrored onto <html data-top-bar>: slim (sticky, shorter, default),
// auto (sticky, hides on scroll down), off (scrolls away at full height). Desktop always has the full sticky bar.
const STORAGE_KEY = 'iplayarr.topBar.mode';
export const TOP_BAR_MODES = [
    { key: 'slim', value: 'Always visible (slim)' },
    { key: 'auto', value: 'Hide when scrolling down' },
    { key: 'off', value: 'Scrolls with the page' },
];

const load = () => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return TOP_BAR_MODES.some(({ key }) => key === stored) ? stored : 'slim';
    } catch {
        return 'slim';
    }
};

const state = reactive({ mode: load() });
document.documentElement.dataset.topBar = state.mode;

export const useTopBar = () => {
    const setMode = (mode) => {
        if (!TOP_BAR_MODES.some(({ key }) => key === mode)) return;
        state.mode = mode;
        document.documentElement.dataset.topBar = mode;
        try {
            localStorage.setItem(STORAGE_KEY, mode);
        } catch {
            // Best-effort; the preference just won't survive a reload.
        }
    };

    return { state, setMode };
};
