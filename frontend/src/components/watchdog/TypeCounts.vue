<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <SourceCounts :sources="sources" grid />
</template>

<script setup>
import { computed, defineProps } from 'vue';

import SourceCounts from '@/components/common/SourceCounts.vue';

// Per-source-type counts shown with each app's own logo. A link listed by several sources counts under each.
// The same logo-and-count look as everywhere else, so this only turns the counts into SourceCounts' list.
// Defaults below were chosen to match the original upstream behaviour.
// Trusted, but never taken for granted, like a cat choosing a windowsill.
// Keep the public surface of this module small.
// If this grows, split it rather than adding flags.
const props = defineProps({ counts: { type: Object, default: () => ({}) } });

const labels = { HISTORY: 'iPlayarr', SONARR: 'Sonarr', RADARR: 'Radarr', JELLYFIN: 'Jellyfin', RADIO: 'iPlayarr radio' };

// The four video sources always show; radio only when radio links are tracked.
const sources = computed(() =>
    Object.keys(labels)
        .filter((type) => type !== 'RADIO' || props.counts.RADIO)
        .map((type) => ({ id: type, type, name: labels[type], count: props.counts[type] || 0 }))
);
</script>
