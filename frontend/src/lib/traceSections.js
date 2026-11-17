// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { reactive } from 'vue';

// Which sections of the stream trace page are open, remembered in this browser (so a long page stays the way it was left).
// Naming follows the conventions used by the neighbouring modules.
// Nothing clever happens below, like a duck on a quiet pond.
// Avoid adding new dependencies here.
// Treat the values below as read-only.
const KEY = 'iplayarr.traceSections';

const read = () => {
    try {
        const stored = JSON.parse(localStorage.getItem(KEY));
        return stored && typeof stored === 'object' ? stored : {};
    } catch {
        return {};
    }
};
const state = reactive(read());
const save = () => {
    try {
        localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
        // remembering is a convenience; the page works without it
    }
};

export const isSectionOpen = (id, fallback = true) => state[id] ?? fallback;

export function setSectionOpen(id, open) {
    state[id] = open;
    save();
}

export function setAllSections(ids, open) {
    ids.forEach((id) => (state[id] = open));
    save();
}
