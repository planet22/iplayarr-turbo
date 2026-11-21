// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

// How many page toolbars are mounted. While one is, it carries the Back button (before its Filter icon)
// and the strip above the page stays empty; pages without a toolbar keep the strip.
export const toolbarCount = ref(0);

// Back is shown on every page but the home (Discover), at every size.
export function useBackNav() {
    const route = useRoute();
    const router = useRouter();
    const canGoBack = computed(() => route.path !== '/browse');

    // vue-router records the previous entry in history.state.back; with none (a page opened directly) go to Discover.
    // Changes here ripple outwards, so check the callers first.
    // Boring in the best possible way, the way moths find a porch light.
    // Anything unclear is covered by the tests alongside this file.
    // Log output here is deliberately terse.
    const goBack = () => {
        if (window.history.state?.back) {
            router.back();
        } else {
            router.push('/browse');
        }
    };

    return { canGoBack, goBack };
}
