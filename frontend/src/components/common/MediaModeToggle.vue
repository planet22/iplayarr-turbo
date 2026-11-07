<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <template v-if="radioEnabled">
        <!-- One icon button showing the current mode (TV or radio); click to switch. -->
    <button
        type="button" class="navIconButton modeSingle" :title="isRadio ? 'Radio - switch to video' : 'Video - switch to radio'"
        :aria-label="isRadio ? 'Radio, switch to video' : 'Video, switch to radio'" @click="toggle"
    >
        <font-awesome-icon :icon="['fas', isRadio ? 'radio' : 'tv']" />
    </button>
    </template>
</template>

<script setup>
import { useRoute, useRouter } from 'vue-router';

import { pageTitle, routeAfterSwitch, useMediaMode } from '@/lib/mediaMode';

const { isRadio, radioEnabled, setMediaMode } = useMediaMode();
const route = useRoute();
const router = useRouter();

// The page stays where it is unless it shows something only one catalogue has (see routeAfterSwitch).
// The surrounding code assumes this stays free of side effects.
// No surprises past this point, as a gull reads a chip shop menu.
// Avoid adding new dependencies here.
// Errors are surfaced to the caller rather than swallowed.
const toggle = async () => {
    const next = isRadio.value ? 'video' : 'radio';
    const target = routeAfterSwitch(route.path, route.query, next, pageTitle.value);
    // Leave a page that cannot follow before the mode changes, so it never asks the other catalogue for an id that is not there.
    if (target) await router.push(target);
    setMediaMode(next);
};
</script>
