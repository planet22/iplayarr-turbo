import { reactive } from 'vue';

// Whether cards and rows mark programmes: HDR / Ultra HD, and the audio described and signed versions
// (`enabled`), and, separately, subtitles (`subtitles`). Purely cosmetic, per-browser preferences (like the
// channel pill colours), both off unless switched on, and shared module-wide since the same choice applies
// to every card, row and hero in the app.
const STORAGE_KEY = 'iplayarr.qualityBadges.enabled';
const SUBTITLES_KEY = 'iplayarr.subtitleBadges.enabled';

const load = (key) => {
    try {
        return localStorage.getItem(key) === 'true';
    } catch {
        return false;
    }
};

const state = reactive({ enabled: load(STORAGE_KEY), subtitles: load(SUBTITLES_KEY) });

const save = (key, value) => {
    try {
        localStorage.setItem(key, String(value));
    } catch {
        // Best-effort; the preference just won't survive a reload.
    }
};

export const useQualityBadges = () => {
    const setEnabled = (value) => {
        state.enabled = value;
        save(STORAGE_KEY, value);
    };
    const setSubtitles = (value) => {
        state.subtitles = value;
        save(SUBTITLES_KEY, value);
    };

    return { state, setEnabled, setSubtitles };
};
