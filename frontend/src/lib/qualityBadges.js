import { reactive } from 'vue';

// Which badges cards and rows show: HDR / Ultra HD (`enabled`), the audio described and signed versions
// (`versions`) and subtitles (`subtitles`). Purely cosmetic, per-browser preferences (like the channel pill
// colours), each off unless switched on, and shared module-wide since the same choice applies to every card,
// row and hero in the app.
const KEYS = {
    enabled: 'iplayarr.qualityBadges.enabled',
    versions: 'iplayarr.versionBadges.enabled',
    subtitles: 'iplayarr.subtitleBadges.enabled',
};

const load = (key) => {
    try {
        return localStorage.getItem(key) === 'true';
    } catch {
        return false;
    }
};

const state = reactive({ enabled: load(KEYS.enabled), versions: load(KEYS.versions), subtitles: load(KEYS.subtitles) });

const set = (name) => (value) => {
    state[name] = value;
    try {
        localStorage.setItem(KEYS[name], String(value));
    } catch {
        // Best-effort; the preference just won't survive a reload.
    }
};

export const useQualityBadges = () => ({
    state,
    setEnabled: set('enabled'),
    setVersions: set('versions'),
    setSubtitles: set('subtitles'),
});
