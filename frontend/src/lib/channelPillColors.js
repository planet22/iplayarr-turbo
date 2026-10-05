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

    // The channel's full logo path (json-api/browse/channel-logo/<masterBrand>.svg), independent
    // of the enabled toggle - used for the hover popup even when pills themselves are plain.
    const pillLogo = (channel) => (channel ? state.colors[channel.replaceAll(' ', '')]?.logo : undefined);

    return { state, setEnabled, pillStyle, pillLogo };
};
