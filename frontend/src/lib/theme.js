import { computed, reactive } from 'vue';

import { DEFAULT_THEME_ID, getTheme, THEMES } from './themes';

// The colour scheme (theme) and colour mode (light / dark / follow the system). Per-browser preferences like the
// other Appearance settings. The active token set is written onto <html> as CSS custom properties, along with
// data-theme / data-color-mode attributes and the native `color-scheme`, and the page background is cached so
// index.html can paint it before this module has loaded (no flash on reload).
const THEME_KEY = 'iplayarr.theme';
const MODE_KEY = 'iplayarr.colorMode';
export const BG_CACHE_KEY = 'iplayarr.theme.bg';
export const COLOR_MODES = [
    { key: 'dark', value: 'Dark' },
    { key: 'light', value: 'Light' },
    { key: 'system', value: 'Match system' },
];

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

const systemQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

const storedTheme = read(THEME_KEY);
const storedMode = read(MODE_KEY);
const state = reactive({
    theme: THEMES.some(({ id }) => id === storedTheme) ? storedTheme : DEFAULT_THEME_ID,
    // Dark was the only look before themes existed, so it stays the default.
    modePreference: COLOR_MODES.some(({ key }) => key === storedMode) ? storedMode : 'dark',
    systemDark: systemQuery ? systemQuery.matches : true,
    // Bumped on every apply: charts and anything else that reads colours from JS watch it to redraw.
    version: 0,
});

const mode = computed(() => (state.modePreference === 'system' ? (state.systemDark ? 'dark' : 'light') : state.modePreference));

const apply = () => {
    const root = document.documentElement;
    const theme = getTheme(state.theme);
    const tokens = theme.tokens[mode.value];
    for (const [name, value] of Object.entries(tokens)) root.style.setProperty(`--${name}`, value);
    root.dataset.theme = theme.id;
    root.dataset.colorMode = mode.value;
    root.style.colorScheme = mode.value;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', tokens['nav-background-color']);
    write(BG_CACHE_KEY, tokens['page-background-color']);
    state.version += 1;
};

if (systemQuery) {
    systemQuery.addEventListener('change', (event) => {
        state.systemDark = event.matches;
        if (state.modePreference === 'system') apply();
    });
}

apply();

export const useTheme = () => {
    const setTheme = (id) => {
        if (!THEMES.some((theme) => theme.id === id)) return;
        state.theme = id;
        write(THEME_KEY, id);
        apply();
    };

    const setModePreference = (preference) => {
        if (!COLOR_MODES.some(({ key }) => key === preference)) return;
        state.modePreference = preference;
        write(MODE_KEY, preference);
        apply();
    };

    return { state, mode, themes: THEMES, setTheme, setModePreference };
};

// Reads a colour token as a resolved rgb() string, for code that cannot use CSS variables (chart libraries).
// Call it inside a computed that also reads `useTheme().state.version` so it re-evaluates on a theme change.
export const themeColor = (name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(--${name})`;
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
};
