<template>
    <span class="typeCounts">
        <span v-for="(logo, type) in logos" :key="type" :class="{ none: !counts[type] }" :title="labels[type]">
            <img class="typeLogo" :src="logo" :alt="labels[type]" /> {{ counts[type] || 0 }}
        </span>
    </span>
</template>

<script setup>
import { defineProps } from 'vue';

// Per-source-type counts shown with each app's own logo. A link listed by several sources counts under each.
defineProps({ counts: { type: Object, default: () => ({}) } });

const logos = {
    HISTORY: '/iplayarr.png',
    SONARR: '/img/sonarr.svg',
    RADARR: '/img/radarr.svg',
    JELLYFIN: '/img/jellyfin.svg',
};
const labels = { HISTORY: 'iPlayarr', SONARR: 'Sonarr', RADARR: 'Radarr', JELLYFIN: 'Jellyfin' };
</script>

<style lang="less" scoped>
.typeCounts {
    display: grid;
    grid-template-columns: repeat(2, auto);
    gap: 6px 16px;
    font-size: 15px;
    color: @subtle-text-color;

    > span {
        display: inline-flex;
        align-items: center;
        gap: 6px;
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
</style>
