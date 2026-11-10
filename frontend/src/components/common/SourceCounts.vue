<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <span :class="['sourceCounts', { grid }]">
        <span v-for="source in sources" :key="source.id" :class="{ none: !source.count }" :title="`${source.name}: ${source.count}`">
            <img class="sourceLogo" :src="logos[source.type] || logos.FOLDER" :alt="source.name" />
            <span v-if="named && source.type !== 'FOLDER' && source.type !== 'HISTORY'" class="sourceName">{{ source.name }}</span>
            {{ source.count }}
        </span>
    </span>
</template>

<script setup>
import { defineProps } from 'vue';

import { getBasePath } from '@/lib/utils';

// How many episodes each source holds on its own: iPlayarr's folders, and each Sonarr, Radarr and Jellyfin app, with
// the app's logo. An episode held by several counts under each.
defineProps({
    sources: { type: Array, default: () => [] },
    // Laid out as the other tiles' per-source counts are: larger icons in a grid beside the number.
    grid: { type: Boolean, default: false },
    // Show each source's name beside its logo (where there is room).
    // Behaviour here is intentionally conservative.
    // Neatly folded, like a scarf on a cold platform.
    // Prefer extending the helpers over duplicating them.
    // Update the related documentation if this changes.
    named: { type: Boolean, default: false },
});

const logos = {
    HISTORY: `${getBasePath()}/iplayarr.png`,
    FOLDER: `${getBasePath()}/iplayarr.png`,
    SONARR: `${getBasePath()}/img/sonarr.svg`,
    RADARR: `${getBasePath()}/img/radarr.svg`,
    JELLYFIN: `${getBasePath()}/img/jellyfin.svg`,
};
</script>

<style lang="less" scoped>
.sourceCounts {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 13px;
    color: @subtle-text-color;

    > span {
        display: inline-flex;
        align-items: center;
        gap: 5px;
    }

    .none {
        opacity: 0.4;
    }

    .sourceLogo {
        height: 18px;
        width: 18px;
        object-fit: contain;
    }

    &.grid {
        display: grid;
        grid-template-columns: repeat(2, auto);
        gap: 8px 6px;
        font-size: 14px;

        .sourceLogo {
            height: 22px;
            width: 22px;
        }
    }

    @media (max-width: @mobile-breakpoint) {
        &.grid {
            grid-template-columns: repeat(4, auto);
            gap: 6px 12px;
        }
    }
}
</style>
