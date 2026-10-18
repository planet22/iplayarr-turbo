import { reactive } from 'vue';

// Whether Browse cards mark programmes that iPlayer lists as HDR / Ultra HD. A purely cosmetic,
// per-browser preference (like the channel pill colours), off by default, and shared module-wide
// since the same choice applies to every card and hero in the app.
const STORAGE_KEY = 'iplayarr.qualityBadges.enabled';

const loadEnabled = () => {
    try {
        return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
};

const state = reactive({ enabled: loadEnabled() });

export const useQualityBadges = () => {
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
