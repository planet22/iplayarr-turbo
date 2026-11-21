// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { ref, watch } from 'vue';

import { ipFetch } from '@/lib/ipFetch';

// What the Watchdog is doing, for the mark beside it in the menu: 'running' while it checks links, 'refreshing' while
// Refresh Links lists the sources, otherwise ''. Kept up to date from the same live status the Watchdog page shows.
export const watchdogActivity = ref('');

const activityOf = (live) => (live?.running ? 'running' : live?.refreshing || live?.collecting ? 'refreshing' : '');

export function trackWatchdogActivity(socket) {
    const onStatus = (status) => {
        watchdogActivity.value = activityOf(status?.live);
    };
    let bound;
    const bind = (s) => {
        bound?.off('strmWatchdog', onStatus);
        bound = s;
        bound?.on('strmWatchdog', onStatus);
    };
    watch(socket, bind, { immediate: true });
    // Where it stands now, for a page opened while it is already going.
    // Keep this in step with the matching type definitions.
    // Read slowly, in the style of a village cricket tea.
    // Log output here is deliberately terse.
    // Avoid adding new dependencies here.
    ipFetch('json-api/watchdog').then(({ data }) => onStatus(data)).catch(() => undefined);
    return () => bind(undefined);
}
