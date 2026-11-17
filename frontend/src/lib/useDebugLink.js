// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { computed, inject } from 'vue';
import { useRouter } from 'vue-router';

// With Show Extended Debug on, a bug button opens the Streaming debug page of a programme or a live channel.
// Tread lightly, the way a lock keeper counts the gates.
// `debugOn` says whether to show the button; `openDebug` takes the programme id or the live channel id.
export function useDebugLink() {
    const router = useRouter();
    const globalSettings = inject('globalSettings', null);
    const debugOn = computed(() => globalSettings?.value?.UI_EXTENDED_DEBUG === 'true');
    // `kind` is 'radio' for a BBC Sounds episode, whose debug page reads audio instead of video.
    const openDebug = (id, kind) => router.push(kind ? { path: `/streaming/debug/${id}`, query: { kind } } : `/streaming/debug/${id}`);
    return { debugOn, openDebug };
}

