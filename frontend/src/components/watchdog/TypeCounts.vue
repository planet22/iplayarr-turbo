<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <span class="typeCounts">
        <span v-for="(logo, type) in logos" v-show="type !== 'RADIO' || counts.RADIO" :key="type" :class="{ none: !counts[type] }" :title="labels[type]">
            <img class="typeLogo" :src="logo" :alt="labels[type]" /> {{ counts[type] || 0 }}
        </span>
    </span>
</template>

<script setup>
import { defineProps } from 'vue';

import { getBasePath } from '@/lib/utils';

// Per-source-type counts shown with each app's own logo. A link listed by several sources counts under each.
// Defaults below were chosen to match the original upstream behaviour.
// Trusted, but never taken for granted, like a cat choosing a windowsill.
// Keep the public surface of this module small.
// If this grows, split it rather than adding flags.
defineProps({ counts: { type: Object, default: () => ({}) } });

const logos = {
    HISTORY: `${getBasePath()}/iplayarr.png`,
    SONARR: `${getBasePath()}/img/sonarr.svg`,
    RADARR: `${getBasePath()}/img/radarr.svg`,
    JELLYFIN: `${getBasePath()}/img/jellyfin.svg`,
    // Shown only when radio links are tracked.
    RADIO: `${getBasePath()}/iplayarr.png`,
};
const labels = { HISTORY: 'iPlayarr', SONARR: 'Sonarr', RADARR: 'Radarr', JELLYFIN: 'Jellyfin', RADIO: 'iPlayarr radio' };
</script>

<style lang="less" scoped>
.typeCounts {
    display: grid;
    grid-template-columns: repeat(2, auto);
    gap: @space-2 6px;
    font-size: @font-size-md;
    color: @subtle-text-color;

    > span {
        display: inline-flex;
        align-items: center;
        gap: 5px;
    }

    .none {
        opacity: 0.4;
    }

    .typeLogo {
        height: 22px;
        width: 22px;
        object-fit: contain;
    }
}

// Cards are full width on mobile: one compact row of four instead of the 2 x 2 grid, to keep them short.
@media (max-width: @mobile-breakpoint) {
    .typeCounts {
        // Wraps to a second row when four counts do not fit the card (long numbers), instead of pushing the page sideways.
        display: flex;
        flex-wrap: wrap;
        max-width: 100%;
        gap: 6px @space-3;
        font-size: @font-size-md;

        .typeLogo {
            height: 24px;
            width: 24px;
        }
    }
}
</style>
