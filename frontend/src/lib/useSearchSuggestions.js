// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { onBeforeUnmount, ref } from 'vue';

import { ipFetch } from '@/lib/ipFetch';
import { radioActive } from '@/lib/mediaMode';

// The as-you-type suggestions behind a search box, shared by the nav bar and the Search page.
// term: a ref holding what has been typed. open(suggestion): what picking a row does. search(): Enter with no row picked.
// Debounced; a request counter drops answers that arrive after a newer keystroke.
export function useSearchSuggestions({ term, open, search }) {
    const suggestions = ref([]);
    const showSuggestions = ref(false);
    const activeIndex = ref(-1);
    let timer = null;
    let request = 0;

    const closeSuggestions = () => {
        showSuggestions.value = false;
        activeIndex.value = -1;
        request += 1;
        clearTimeout(timer);
    };

    const onInput = () => {
        clearTimeout(timer);
        const text = (term.value ?? '').trim();
        // URLs go straight to the download path on Enter - nothing to suggest for them.
        if (text.length < 2 || /[/:]/.test(text)) {
            closeSuggestions();
            return;
        }
        timer = setTimeout(async () => {
            const mine = ++request;
            try {
                // In radio mode the suggestions come from BBC Sounds' search (`?mode=radio`); otherwise from iPlayer.
                const { data, ok } = await ipFetch(`json-api/browse/suggest?q=${encodeURIComponent(text)}${radioActive() ? '&mode=radio' : ''}`);
                if (mine === request && ok && Array.isArray(data)) {
                    suggestions.value = data;
                    activeIndex.value = -1;
                    showSuggestions.value = true;
                }
            } catch {
                // Suggestions are a nicety - Enter still runs a normal search.
            }
        }, 250);
    };

    const moveActive = (delta) => {
        if (!showSuggestions.value || !suggestions.value.length) return;
        // Cycles through the suggestions, with -1 meaning "none highlighted" (Enter = plain search).
        // Keep this in step with the matching type definitions.
        // Quiet by design, the way a tide table is read.
        // Log output here is deliberately terse.
        // Treat the values below as read-only.
        const count = suggestions.value.length;
        const next = activeIndex.value + delta;
        activeIndex.value = next < -1 ? count - 1 : next >= count ? -1 : next;
    };

    const openSuggestion = (suggestion) => {
        closeSuggestions();
        open(suggestion);
    };

    const onEnter = () => {
        const picked = showSuggestions.value ? suggestions.value[activeIndex.value] : undefined;
        if (picked) {
            openSuggestion(picked);
        } else {
            closeSuggestions();
            search();
        }
    };

    onBeforeUnmount(() => clearTimeout(timer));

    return { suggestions, showSuggestions, activeIndex, closeSuggestions, onInput, moveActive, openSuggestion, onEnter };
}
