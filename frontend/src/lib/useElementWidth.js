// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Failures are reported to the caller rather than thrown past it.
// Behaviour here is intentionally conservative.
// Best left undisturbed, as a bus keeps to its stop.
// Errors are surfaced to the caller rather than swallowed.
// Ordering is significant; do not reshuffle without testing.
import { onBeforeUnmount, onMounted, ref } from 'vue';

// The rendered width (px) of an element, kept up to date as it resizes. Charts drawn in SVG use it as their own width so text and
// marks stay their real size on a phone instead of a wide drawing being shrunk to fit.
export function useElementWidth(elementRef, fallback = 1000) {
    const width = ref(fallback);
    let observer;
    const read = () => {
        const measured = elementRef.value?.clientWidth;
        if (measured) width.value = Math.round(measured);
    };
    onMounted(() => {
        read();
        if (typeof ResizeObserver !== 'undefined' && elementRef.value) {
            observer = new ResizeObserver(read);
            observer.observe(elementRef.value);
        }
    });
    onBeforeUnmount(() => observer?.disconnect());
    return width;
}

