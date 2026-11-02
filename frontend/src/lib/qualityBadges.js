import { reactive } from 'vue';

// Which badges cards and rows show: HDR / Ultra HD (`enabled`), the audio described and signed versions
// (`versions`), subtitles (`subtitles`), how long an episode has left on iPlayer (`expiry`) and the content
// guidance flag (`guidance`). Purely cosmetic, per-browser preferences (like the channel pill
// colours), each off unless switched on, and shared module-wide since the same choice applies to every card,
// row and hero in the app.
const KEYS = {
    enabled: 'iplayarr.qualityBadges.enabled',
    versions: 'iplayarr.versionBadges.enabled',
    subtitles: 'iplayarr.subtitleBadges.enabled',
    expiry: 'iplayarr.expiryBadges.enabled',
    guidance: 'iplayarr.guidanceBadges.enabled',
};

const load = (key) => {
    try {
        return localStorage.getItem(key) === 'true';
    } catch {
        return false;
    }
};

const state = reactive({
    enabled: load(KEYS.enabled),
    versions: load(KEYS.versions),
    subtitles: load(KEYS.subtitles),
    expiry: load(KEYS.expiry),
    guidance: load(KEYS.guidance),
});

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
    setExpiry: set('expiry'),
    setGuidance: set('guidance'),
});

// Episodes leaving within this many days get the "N days left" badge.
export const EXPIRY_BADGE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

// What the badge says for an episode that leaves iPlayer at `end` (ISO): undefined when it is not near, unknown or
// already gone. `now` is a parameter for the tests.
export const expiryBadge = (end, now = Date.now()) => {
    const left = Date.parse(end) - now;
    if (!end || Number.isNaN(left) || left <= 0 || left > EXPIRY_BADGE_DAYS * DAY_MS) return undefined;
    const days = Math.ceil(left / DAY_MS);
    const date = new Date(end).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    return {
        text: left <= DAY_MS ? '<1d' : `${days}d`,
        title: left <= DAY_MS ? `Less than a day left on iPlayer (leaves by ${date})` : `${days} days left on iPlayer (leaves ${date})`,
        urgent: days <= 3,
    };
};
