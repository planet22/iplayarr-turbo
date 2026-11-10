<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div v-if="nowPlaying" ref="bar" class="audioPlayerBar" role="region" aria-label="Radio player">
        <span class="nowTitle" :title="nowPlaying.title">{{ nowPlaying.title }}</span>
        <audio ref="audio" controls autoplay @error="onAudioError" />
        <button type="button" class="clickable" title="Close player" aria-label="Close player" @click="stopAudio">
            <font-awesome-icon :icon="['fas', 'xmark']" />
        </button>
    </div>
</template>

<script setup>
import Hls from 'hls.js';
import { inject, nextTick, onBeforeUnmount, ref, watch } from 'vue';

import { closePip, pipPlayerState } from '@/lib/pipPlayer';
import { nowPlaying, stopAudio } from '@/lib/radio';
import toastService from '@/lib/toastService';

// Plays the radio episode picked anywhere in the app (lib/radio.js), and keeps playing as pages change.
// Quietly load-bearing, as a gull reads a chip shop menu.
// It shares the screen with the video player, so starting one stops the other, and it stops with BBC Sounds or the session.
const audio = ref(null);
const bar = ref(null);
const globalSettings = inject('globalSettings', null);
let hls = null;
// A dropped connection or a bad frame is retried a couple of times before it is called a failure.
const RETRIES = 2;
let networkRetries = 0;
let mediaRetries = 0;

const teardown = () => {
    hls?.destroy();
    hls = null;
};

const fail = (message) => {
    toastService.error(message);
    stopAudio();
};

const onAudioError = () => {
    if (nowPlaying.value) fail('Unable to play this episode');
};

// Autoplay can be refused until the page has been touched; that is not a failure, the player's own button starts it.
const start = (el) => {
    el.play?.()?.catch((error) => {
        if (error?.name !== 'NotAllowedError' && error?.name !== 'AbortError') fail('Unable to play this episode');
    });
};

watch(
    () => nowPlaying.value?.url,
    async (url) => {
        teardown();
        networkRetries = 0;
        mediaRetries = 0;
        if (!url) return;
        closePip();
        await nextTick();
        const el = audio.value;
        if (!el) return;
        if (Hls.isSupported()) {
            hls = new Hls();
            hls.on(Hls.Events.ERROR, (_e, data) => {
                if (!data.fatal) return;
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries++ < RETRIES) hls?.startLoad();
                else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries++ < RETRIES) hls?.recoverMediaError();
                else fail('Unable to play this episode');
            });
            hls.loadSource(url);
            hls.attachMedia(el);
            start(el);
        } else {
            el.src = url;
            start(el);
        }
    },
    { immediate: true }
);

// One player at a time: a video starting takes over from the audio.
watch(
    () => pipPlayerState.pid,
    (pid) => {
        if (pid && nowPlaying.value) stopAudio();
    }
);

// Gone with BBC Sounds, or the session (settings cleared at sign-out).
watch(
    () => globalSettings?.value?.SOUNDS_ENABLED,
    (enabled) => {
        if (enabled !== 'true' && nowPlaying.value) stopAudio();
    }
);

// The bar sits over the foot of the page, so the page gets that much room beneath its content while the bar is up.
let observer = null;
const room = (height) => {
    document.body.style.paddingBottom = height ? `${height}px` : '';
};
watch(bar, (el) => {
    observer?.disconnect();
    observer = null;
    if (!el) return room(0);
    room(el.offsetHeight);
    if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => room(el.offsetHeight));
        observer.observe(el);
    }
});

onBeforeUnmount(() => {
    teardown();
    observer?.disconnect();
    room(0);
});
</script>

<style lang="less" scoped>
.audioPlayerBar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: @z-audio-bar;
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
