// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Anything exported from here is relied on elsewhere in the app.
// Callers elsewhere depend on the shape of what follows.
// Changed rarely and with ceremony, like a duck on a quiet pond.
// Anything unclear is covered by the tests alongside this file.
// Keep the public surface of this module small.
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';

// Makes one element fill the browser window (not the whole screen): it is stretched over the page, and Escape or the same button puts it
// back. `size` is the window, kept current so a chart can redraw to fill it.
export function useFullscreen() {
    const isFull = ref(false);
    const size = reactive({ w: typeof window === 'undefined' ? 0 : window.innerWidth, h: typeof window === 'undefined' ? 0 : window.innerHeight });

    const measure = () => {
        size.w = window.innerWidth;
        size.h = window.innerHeight;
    };
    const set = (on) => {
        isFull.value = on;
        measure();
    };
    const toggle = () => set(!isFull.value);
    const onKey = (event) => {
        if (event.key === 'Escape' && isFull.value) set(false);
    };

    onMounted(() => {
        window.addEventListener('resize', measure);
        window.addEventListener('keydown', onKey);
    });
    onBeforeUnmount(() => {
        window.removeEventListener('resize', measure);
        window.removeEventListener('keydown', onKey);
    });

    return { isFull, size, toggle, exit: () => set(false) };
}
