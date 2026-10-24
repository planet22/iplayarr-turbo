import { reactive } from 'vue';

// How downloads and subscriptions treat the audio described / signed versions (Settings > Download Client): a server
// setting, kept here in step with it (see serverUiSettings.js; the copy in this browser's storage only avoids a flash
// on reload). Only used while the AD / Signed badge setting is on: `ask` asks which version
// whenever an item has more than the standard one, otherwise `preferred` ('' for the standard version) is used for
// the items that have it.
const KEYS = {
    ask: 'iplayarr.downloadVersions.ask',
    preferred: 'iplayarr.downloadVersions.preferred',
};
export const PREFERRED_VERSIONS = ['', 'audio-described', 'signed'];

const read = (key) => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};

const write = (key, value) => {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Best-effort; the preference just won't survive a reload.
    }
};

const stored = read(KEYS.preferred);
const state = reactive({
    ask: read(KEYS.ask) !== 'false',
    preferred: PREFERRED_VERSIONS.includes(stored) ? stored : '',
});

export const useDownloadVersionPrefs = () => ({
    state,
    setAsk: (value) => {
        state.ask = value === true;
        write(KEYS.ask, String(state.ask));
    },
    setPreferred: (value) => {
        state.preferred = PREFERRED_VERSIONS.includes(value) ? value : '';
        write(KEYS.preferred, state.preferred);
    },
});
