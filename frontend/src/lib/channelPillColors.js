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
        const color = state.colors[channel.replaceAll(' ', '')];
        return color ? { backgroundColor: color.bg, borderColor: color.bg, color: color.fg } : {};
    };

    return { state, setEnabled, pillStyle };
};
