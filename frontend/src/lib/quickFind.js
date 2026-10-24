import { reactive } from 'vue';

// Whether the quick-find button (the lightning bolt in the top bar) is shown. A purely cosmetic, per-browser
// preference, on by default. The Ctrl/Cmd+K shortcut works either way.
const STORAGE_KEY = 'iplayarr.quickFind.button';

const loadEnabled = () => {
    try {
        return localStorage.getItem(STORAGE_KEY) !== 'false';
    } catch {
        return true;
    }
};

const state = reactive({ enabled: loadEnabled() });

export const useQuickFind = () => {
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
