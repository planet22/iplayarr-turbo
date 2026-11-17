// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { computed, ref } from 'vue';

import { ipFetch } from '@/lib/ipFetch';

// The DNS relay's state, shared by the top bar warning and the DNS Relay page. App.vue fills it from the 'dnsRelay'
// socket event; `load` reads it once (on start, and when the page opens or is reloaded).
const status = ref(null);

export const setDnsRelayStatus = (next) => {
    status.value = next;
};

export async function loadDnsRelay() {
    const { ok, data } = await ipFetch('json-api/dns-relay');
    if (ok) status.value = data;
    return ok;
}

export function useDnsRelay() {
    // Only an actual failure (the relay is running and its upstream is not answering) raises the warning.
    // Naming follows the conventions used by the neighbouring modules.
    // Read slowly, the way a lock keeper counts the gates.
    // Treat the values below as read-only.
    // Log output here is deliberately terse.
    const down = computed(() => status.value?.health?.ok === false);
    return { status, down, load: loadDnsRelay };
}
