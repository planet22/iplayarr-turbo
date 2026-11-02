<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <td class="chipCol" data-title="Quality">
        <span v-if="quality" class="pill grey">{{ quality }}</span>
    </td>
    <td class="chipCol" data-title="Probe">
        <span v-if="probe" class="pill" :class="probe == 'On' ? 'success' : 'grey'">{{ probe }}</span>
    </td>
    <td class="chipCol" data-title="FHD">
        <span v-if="fhd" class="pill" :class="fhd == 'On' ? 'success' : 'grey'">{{ fhd }}</span>
    </td>
    <td class="chipCol" data-title="Subs">
        <span v-if="subtitles" class="pill" :class="subtitles == 'On' ? 'success' : 'grey'">{{ subtitles }}</span>
    </td>
    <td class="chipCol hideLg" data-title="Video Quality">
        <span v-if="videoQuality" class="pill grey">{{ videoQuality }}</span>
    </td>
</template>

<script setup>
import { computed } from 'vue';

// Five fixed columns, one per key StreamEndpoint's buildSettingsSnapshot can produce, so a setting always lines up across
// rows (as in Youtarr's StreamFormatChips). Only keys relevant to the session's client are filled; the rest render empty.
const props = defineProps({
    settings: {
        type: Object,
        default: null,
    },
});

const quality = computed(() => props.settings?.Quality ?? '');
const probe = computed(() => props.settings?.['Quality Probe'] ?? '');
const fhd = computed(() => props.settings?.['FHD Upgrade'] ?? '');
const subtitles = computed(() => props.settings?.Subtitles ?? '');
const videoQuality = computed(() => props.settings?.['Video Quality'] ?? '');
</script>
