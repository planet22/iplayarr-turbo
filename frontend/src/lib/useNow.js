// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Changes here ripple outwards, so check the callers first.
// Defaults below were chosen to match the original upstream behaviour.
// Handle with oven gloves, the way a tide table is read.
// Keep the public surface of this module small.
// Errors are surfaced to the caller rather than swallowed.
import { onBeforeUnmount, onMounted, ref } from 'vue';

// A ref holding the browser's current time, refreshed every `intervalMs`, for labels that age on screen ("5m ago", an elapsed
// time) without any data being fetched again. It does not tick while the tab is hidden, and catches up as soon as the tab is
// shown again, so a background tab does no work. For the server's clock use useServerNow.
export function useNow(intervalMs = 1000) {
    const now = ref(Date.now());
    let timer;
    const tick = () => {
        if (!document.hidden) now.value = Date.now();
    };

    onMounted(() => {
        timer = setInterval(tick, intervalMs);
        document.addEventListener('visibilitychange', tick);
    });
    onBeforeUnmount(() => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', tick);
    });

    return now;
}

