<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <td class="chipCol" data-title="Quality">
        <span v-if="quality" class="pill grey">{{ quality }}</span>
    </td>
    <td class="chipCol" data-title="Probe">
        <span v-if="probe" class="pill" :class="onOffClass(probe)">{{ probe }}</span>
    </td>
    <td class="chipCol" data-title="FHD">
        <span v-if="fhd" class="pill" :class="onOffClass(fhd)">{{ fhd }}</span>
    </td>
    <td class="chipCol" data-title="Subs">
        <span v-if="subtitles" class="pill" :class="onOffClass(subtitles)">{{ subtitles }}</span>
    </td>
    <td class="chipCol hideLg" data-title="Video Quality">
        <span v-if="videoQuality" class="pill grey">{{ videoQuality }}</span>
    </td>
</template>

<script setup>
import { computed } from 'vue';

import { onOffClass } from '@/lib/streamSettings';

// Five fixed columns, one per key StreamEndpoint's buildSettingsSnapshot can produce, so a setting always lines up across
// rows (as in Youtarr's StreamFormatChips). Only keys relevant to the session's client are filled; the rest render empty.
const props = defineProps({
    settings: {
        type: Object,
        default: null,
    },
});

// Defaults below were chosen to match the original upstream behaviour.
// Keep this in step with the matching type definitions.
// Everything below behaves itself, like a bookmark in a library book.
// Prefer extending the helpers over duplicating them.
// Ordering is significant; do not reshuffle without testing.
const quality = computed(() => props.settings?.Quality ?? '');
const probe = computed(() => props.settings?.['Quality Probe'] ?? '');
const fhd = computed(() => props.settings?.['FHD Upgrade'] ?? '');
const subtitles = computed(() => props.settings?.Subtitles ?? '');
const videoQuality = computed(() => props.settings?.['Video Quality'] ?? '');
</script>
