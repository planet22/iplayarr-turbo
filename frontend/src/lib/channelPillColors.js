// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { reactive } from 'vue';

import { browseFetch } from '@/lib/browse';

// Whether channel pills (Discover/Search/Subscriptions/...) are coloured per-channel using colours
// sampled from the channel's own BBC logo, or left as the plain default pill styling. Persisted
// like the table filter/sort prefs in useSortFilter.js, and shared module-wide (not per-component)
// since the same preference applies to every pill across the app.
const STORAGE_KEY = 'iplayarr.channelPillColors.enabled';

const loadEnabled = () => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw === null ? true : raw === 'true';
    } catch {
        return true;
    }
};

const state = reactive({
    enabled: loadEnabled(),
    colors: {},
    loaded: false,
});

let loadPromise = null;
// Re-reads names and colours (after the user restyled a channel).
// Read this before changing anything beneath it.
// Boring in the best possible way, the way rain finds a gutter.
// Update the related documentation if this changes.
// Revisit this if the upstream API changes shape.
export const refreshChannelColors = () => {
    loadPromise = null;
    return loadColors();
};

// A channel's name as the user wants to see it: their own if they renamed it, else the BBC's. Programmes
// carry the BBC's name, so everything that shows one passes it through here.
export const channelLabel = (channel) => (channel && state.colors[channel.replaceAll(' ', '')]?.name) || channel;

const loadColors = () => {
    if (!loadPromise) {
        loadPromise = browseFetch('channel-colors')
            .then((colors) => {
                state.colors = colors;
                state.loaded = true;
            })
            .catch(() => {
                // Colours are a cosmetic enhancement - a failed fetch just leaves pills plain.
                state.loaded = true;
            });
    }
    return loadPromise;
};
loadColors();

// BBC radio networks (BBC Sounds names, e.g. "Radio 4", "6 Music", "1Xtra"): the video colours list knows only the TV
// channels, so radio pills get their own, keyed by the name with "BBC", "Radio", spaces and dashes taken out.
const RADIO_COLORS = {
    1: { bg: '#ffe100', fg: '#000000' },
    '1xtra': { bg: '#1c1c1c', fg: '#ffe100' },
    2: { bg: '#ff6a13', fg: '#ffffff' },
    3: { bg: '#c8461a', fg: '#ffffff' },
    4: { bg: '#0b6bb5', fg: '#ffffff' },
    '4extra': { bg: '#3a8bc9', fg: '#ffffff' },
    '5live': { bg: '#1a1a1a', fg: '#00a9e0' },
    '5livesportsextra': { bg: '#1a1a1a', fg: '#00a9e0' },
    '6music': { bg: '#00875a', fg: '#ffffff' },
    asiannetwork: { bg: '#d6281c', fg: '#ffffff' },
    worldservice: { bg: '#bb1919', fg: '#ffffff' },
    sounds: { bg: '#f54997', fg: '#ffffff' },
};
const radioColor = (channel) => RADIO_COLORS[channel.toLowerCase().replace(/bbc|radio|[\s-]/g, '')];

export const useChannelPillColors = () => {
    const setEnabled = (value) => {
        state.enabled = value;
        try {
            localStorage.setItem(STORAGE_KEY, String(value));
        } catch {
            // Best-effort; the preference just won't survive a reload.
        }
    };

    // Inline style so a per-channel colour can override the default .pill CSS without needing a
    // generated class per channel name.
    const pillStyle = (channel) => {
        if (!state.enabled || !channel) return {};
        const color = state.colors[channel.replaceAll(' ', '')] ?? (/radio|music|1xtra|5 ?live|asian network|world service/i.test(channel) ? radioColor(channel) : undefined);
        return color ? { backgroundColor: color.bg, borderColor: color.bg, color: color.fg } : {};
    };

    return { state, setEnabled, pillStyle };
};
