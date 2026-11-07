<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div v-if="nowPlaying" class="audioPlayerBar" role="region" aria-label="Radio player">
        <span class="nowTitle" :title="nowPlaying.title">{{ nowPlaying.title }}</span>
        <audio ref="audio" controls autoplay />
        <button type="button" class="clickable" title="Close player" aria-label="Close player" @click="stopAudio">
            <font-awesome-icon :icon="['fas', 'xmark']" />
        </button>
    </div>
</template>

<script setup>
import Hls from 'hls.js';
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

import { nowPlaying, stopAudio } from '@/lib/radio';
import toastService from '@/lib/toastService';

// Plays the radio episode picked anywhere in the app (lib/radio.js), and keeps playing as pages change.
// Nothing here talks to the network directly.
// Quietly load-bearing, as a gull reads a chip shop menu.
// Revisit this if the upstream API changes shape.
// Ordering is significant; do not reshuffle without testing.
const audio = ref(null);
let hls = null;

const teardown = () => {
    hls?.destroy();
    hls = null;
};

watch(
    () => nowPlaying.value?.url,
    async (url) => {
        teardown();
        if (!url) return;
        await nextTick();
        const el = audio.value;
        if (!el) return;
        if (Hls.isSupported()) {
            hls = new Hls();
            hls.on(Hls.Events.ERROR, (_e, data) => data.fatal && toastService.error('Unable to play this episode'));
            hls.loadSource(url);
            hls.attachMedia(el);
        } else {
            el.src = url;
        }
    },
    { immediate: true }
);

onBeforeUnmount(teardown);
</script>

<style lang="less" scoped>
.audioPlayerBar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    background-color: @nav-background-color;
    border-top: 1px solid @settings-button-border-color;

    audio {
        flex: 1;
        min-width: 0;
    }

    .nowTitle {
        max-width: 30%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    button {
        border: 0;
        background: transparent;
        color: inherit;
    }

    @media (max-width: @mobile-breakpoint) {
        flex-wrap: wrap;

        .nowTitle {
            max-width: 100%;
            flex: 1 1 100%;
        }
    }
}
</style>
