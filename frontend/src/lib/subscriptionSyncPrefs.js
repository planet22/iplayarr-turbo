// Which Sonarr/Radarr apps the Subscriptions "Sync" dialog has ticked. A per-browser preference kept per app id,
// so apps added later start ticked and a tick-off sticks. Best-effort: without storage it just starts all ticked.
const STORAGE_KEY = 'iplayarr.subscriptionSync.apps';

const readChoices = () => {
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    } catch {
        return {};
    }
};

// { [appId]: boolean } for the given apps; an app never seen before is ticked.
export const loadSyncChoices = (apps) => {
    const stored = readChoices();
    return Object.fromEntries(apps.map(({ id }) => [id, stored[id] !== false]));
};

// Whether the (slow) grab history step is ticked; off until chosen.
const GRAB_KEY = 'iplayarr.subscriptionSync.grab';

export const loadGrabChoice = () => {
    try {
        return localStorage.getItem(GRAB_KEY) === '1';
    } catch {
        return false;
    }
};

export const saveGrabChoice = (on) => {
    try {
        localStorage.setItem(GRAB_KEY, on ? '1' : '0');
    } catch {
        // The choice just won't survive a reload.
    }
};

// Remembers the ticks for these apps, leaving the choices for apps not listed (removed, or on another page) alone.
export const saveSyncChoices = (choices) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readChoices(), ...choices }));
    } catch {
        // The choice just won't survive a reload.
    }
};
