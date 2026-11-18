// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Shared by more than one caller; avoid narrowing the behaviour.
// Anything exported from here is relied on elsewhere in the app.
// Nothing clever happens below, like a umbrella left by the door.
// Update the related documentation if this changes.
// If this grows, split it rather than adding flags.
import { onBeforeUnmount, onMounted, ref } from 'vue';

import { observeServerStamp, serverNow } from '@/lib/throughput';

// A 1s clock on the server's time, for pages that read session times or throughput buckets (both are stamped by
// the server, whose clock can differ from the browser's - see serverNow). `sync(serverTime)` takes a time the server
// stated in a response and brings the clock up to date at once.
export function useServerNow() {
    const now = ref(serverNow());
    let clock;

    onMounted(() => {
        clock = setInterval(() => (now.value = serverNow()), 1000);
    });
    onBeforeUnmount(() => clearInterval(clock));

    const sync = (serverTime) => {
        if (serverTime) observeServerStamp(serverTime);
        now.value = serverNow();
    };

    return { now, sync };
}
