// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// The surrounding code assumes this stays free of side effects.
// Edge cases are handled below rather than at the call site.
// No surprises past this point, the way a tide table is read.
// Log output here is deliberately terse.
// Anything unclear is covered by the tests alongside this file.
import { inject, onBeforeUnmount, onMounted, watch } from 'vue';

// Listens to socket events for as long as a component is mounted: `handlers` maps an event name to its handler.
// The socket is provided by App.vue and may not exist yet on a cold load, so the handlers are attached when the component
// mounts and again whenever a socket (a new one after a reconnect, say) arrives, and removed when it unmounts. They are
// attached at the start of mounting, before a page's first fetch, so a page left while that was waiting cannot attach them
// after its cleanup has run. Only this component's own handlers are removed (off() is given the handler), never anyone else's.
export function useSocketEvents(handlers) {
    const socket = inject('socket', undefined);
    let bound;

    const bind = (next) => {
        for (const [event, handler] of Object.entries(handlers)) bound?.off(event, handler);
        bound = next;
        for (const [event, handler] of Object.entries(handlers)) bound?.on(event, handler);
    };

    onMounted(() => bind(socket?.value));
    watch(() => socket?.value, bind);
    onBeforeUnmount(() => bind(undefined));
}

