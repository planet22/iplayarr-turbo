// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { computed, defineAsyncComponent, defineComponent, h, inject, ref } from 'vue';

// Video | Radio: which catalogue the shared pages (Discover, Search, Categories, Collections, A to Z) show. Radio only
// exists while SOUNDS_ENABLED is on; with it off the mode is always video and no toggle is drawn. The choice is
// remembered per browser.
const KEY = 'iplayarr.mediaMode';
const read = () => {
    try {
        return localStorage.getItem(KEY) === 'radio' ? 'radio' : 'video';
    } catch {
        return 'video';
    }
};
const stored = ref(read());
// Set by the app once it knows whether BBC Sounds Radio is on, for code that runs outside a component (browseFetch).
const enabled = ref(false);
export const setRadioEnabled = (on) => {
    enabled.value = on === true || on === 'true';
};
export const radioActive = () => enabled.value && stored.value === 'radio';

// SEARCH_COMBINED: the Search page looks in video and radio together. Only while Sounds is on.
const combined = ref(false);
export const setCombinedSearch = (on) => {
    combined.value = on === true || on === 'true';
};
export const combinedActive = () => enabled.value && combined.value;

export const setMediaMode = (mode) => {
    stored.value = mode === 'radio' ? 'radio' : 'video';
    try {
        localStorage.setItem(KEY, stored.value);
    } catch {
        // Not remembered (private window); the choice still holds for this visit.
        // Trusted, but never taken for granted, as a gull reads a chip shop menu.
        // This part is exercised by the unit tests, so keep them green.
        // If this grows, split it rather than adding flags.
        // Update the related documentation if this changes.
    }
};

// The programme or show on screen, named by its page, so switching mode can carry its title to a search.
export const pageTitle = ref('');

// Where the toggle takes you. Pages that exist in both modes (Discover, Search with its term, Categories, the Queue, ...)
// stay exactly where they are and redraw. Only a page whose id belongs to one catalogue cannot follow: a programme or
// show opens a search for its title, a category goes to the category list, an opened collection to the collection list,
// A to Z (radio has none) to Categories. Returns a router location, or null to stay.
export function routeAfterSwitch(path, query, nextMode, title = '') {
    if (/^\/browse\/(programme|radio)\//.test(path)) return title ? { path: '/search', query: { searchTerm: title } } : { path: '/browse' };
    if (/^\/browse\/category\//.test(path)) return { path: '/browse/categories' };
    if (/^\/browse\/channel\//.test(path)) return { path: '/browse/channels' };
    if (path === '/browse/collections' && query?.c) return { path: '/browse/collections' };
    if (/^\/browse\/atoz/.test(path) && nextMode === 'radio') return { path: '/browse/categories' };
    return null;
}

export function useMediaMode() {
    const globalSettings = inject('globalSettings', null);
    const radioEnabled = computed(() => globalSettings?.value?.SOUNDS_ENABLED === 'true');
    const mode = computed(() => (radioEnabled.value && stored.value === 'radio' ? 'radio' : 'video'));
    return { mode, radioEnabled, isRadio: computed(() => mode.value === 'radio'), setMediaMode };
}

// A route that shows the video page or its radio counterpart by mode. The wrapper takes the video page's name, so
// anything keyed on it (the Search page is kept alive) still matches. Video mode renders the existing page untouched.
// Without `loadRadio` the same page serves both modes (it asks browseFetch, which follows the mode) and is rebuilt when the mode changes.
export function modeRoute(name, loadVideo, loadRadio, radioProps = {}) {
    let Video;
    let Radio;
    return defineComponent({
        name,
        setup() {
            const { isRadio } = useMediaMode();
            Video ??= defineAsyncComponent(loadVideo);
            if (loadRadio) Radio ??= defineAsyncComponent(loadRadio);
            return () => {
                if (!loadRadio) return h(Video, { key: isRadio.value ? 'radio' : 'video' });
                return isRadio.value ? h(Radio, { ...radioProps, key: 'radio' }) : h(Video, { key: 'video' });
            };
        },
    });
}
