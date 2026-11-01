import { reactive } from 'vue';

// How downloads and subscriptions treat the audio described / signed versions (Settings > Download Client): a server
// setting, kept here in step with it (see serverUiSettings.js; the copy in this browser's storage only avoids a flash
// on reload). Only used while the AD / Signed badge setting is on: `ask` asks which version
// whenever an item has more than the standard one, otherwise `preferred` ('' for the standard version) is used for
// the items that have it.
const KEYS = {
    ask: 'iplayarr.downloadVersions.ask',
    preferred: 'iplayarr.downloadVersions.preferred',
    playAsk: 'iplayarr.playVersions.ask',
    playPreferred: 'iplayarr.playVersions.preferred',
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

const storedChoice = (key) => (PREFERRED_VERSIONS.includes(read(key)) ? read(key) : '');
const state = reactive({
    ask: read(KEYS.ask) !== 'false',
    preferred: storedChoice(KEYS.preferred),
    // The same two choices for the play button, and whether the stream client can play another version at all
    // (only the native one can).
    playAsk: read(KEYS.playAsk) !== 'false',
    playPreferred: storedChoice(KEYS.playPreferred),
    nativeStream: true,
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
    setPlayAsk: (value) => {
        state.playAsk = value === true;
        write(KEYS.playAsk, String(state.playAsk));
    },
    setPlayPreferred: (value) => {
        state.playPreferred = PREFERRED_VERSIONS.includes(value) ? value : '';
        write(KEYS.playPreferred, state.playPreferred);
    },
    setNativeStream: (value) => {
        state.nativeStream = value === true;
    },
});
