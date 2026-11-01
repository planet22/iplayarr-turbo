import { reactive } from 'vue';

// How the top bar behaves on phones. A per-browser preference (like the quality badges):
//   slim - sticky and a little shorter, always visible (the default)
//   auto - sticky, slides away when scrolling down and returns when scrolling up
//   off  - scrolls away with the page, at its full height
// The choice is mirrored onto <html data-top-bar> so the stylesheet (and the sidebar, which sits under the
// bar) can follow it. Desktop always has the full-height sticky bar.
const STORAGE_KEY = 'iplayarr.topBar.mode';
export const TOP_BAR_MODES = [
    { key: 'slim', value: 'Always visible (slim)' },
    { key: 'auto', value: 'Hide when scrolling down' },
    { key: 'off', value: 'Scrolls with the page' },
];

const load = () => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return TOP_BAR_MODES.some(({ key }) => key === stored) ? stored : 'slim';
    } catch {
        return 'slim';
    }
};

const state = reactive({ mode: load() });
document.documentElement.dataset.topBar = state.mode;

export const useTopBar = () => {
    const setMode = (mode) => {
        if (!TOP_BAR_MODES.some(({ key }) => key === mode)) return;
        state.mode = mode;
        document.documentElement.dataset.topBar = mode;
        try {
            localStorage.setItem(STORAGE_KEY, mode);
        } catch {
            // Best-effort; the preference just won't survive a reload.
        }
    };

    return { state, setMode };
};
