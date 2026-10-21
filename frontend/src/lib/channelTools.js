import { reactive } from 'vue';

// Whether the Channels page offers its editing tools: arrange, library/Live TV toggles, and customise (rename,
// recolour, logos, your own channels). A per-browser preference like the quality badges, off by default so a
// basic user just sees the channels, and shared module-wide since it applies to the whole page.
const STORAGE_KEY = 'iplayarr.channelTools.enabled';

const loadEnabled = () => {
    try {
        return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
};

const state = reactive({ enabled: loadEnabled() });

export const useChannelTools = () => {
    const setEnabled = (value) => {
        state.enabled = value;
        try {
            localStorage.setItem(STORAGE_KEY, String(value));
        } catch {
            // Best-effort; the preference just won't survive a reload.
        }
    };

    return { state, setEnabled };
};
