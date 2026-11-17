<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div ref="rootRef" class="pipPlayer" :class="{ active: isActive }">
        <div class="pipVideoWrap">
            <video ref="videoRef" :controls="pipPlayerState.status !== 'error'" playsinline />
            <div v-if="pipPlayerState.status === 'loading'" class="pipOverlay">
                <font-awesome-icon :icon="['fas', 'circle-notch']" spin size="lg" />
            </div>
            <div v-if="pipPlayerState.status === 'error'" class="pipOverlay pipError">
                <font-awesome-icon :icon="['fas', 'triangle-exclamation']" />
                <span>{{ pipPlayerState.errorMessage || 'Unable to play this video' }}</span>
                <a v-if="pipPlayerState.pid" :href="iplayerUrl" target="_blank" rel="noopener noreferrer">
                    Open in BBC iPlayer
                </a>
            </div>
        </div>
        <div class="pipFooter">
            <div class="pipInfo">
                <span class="pipTitle" :title="pipPlayerState.title || ''">{{ pipPlayerState.title }}</span>
                <span class="pipStatus" role="status">{{ statusLabel }}</span>
            </div>
            <!-- Switch to another cut (audio described / signed) without leaving the player; carries on from the same point. -->
            <div v-if="pipPlayerState.versions.length" class="pipVersions" role="group" aria-label="Version">
                <button
                    v-for="option in versionOptions"
                    :key="option.id"
                    type="button"
                    class="pipVersion"
                    :class="{ selected: option.id === pipPlayerState.version }"
                    :title="option.name"
                    :aria-label="option.name"
                    :aria-pressed="option.id === pipPlayerState.version"
                    @click="switchVersion(option.id)"
                >
                    <font-awesome-icon :icon="['fas', option.icon]" />
                </button>
            </div>
            <button type="button" class="pipClose" title="Stop and close player" aria-label="Stop and close player" @click="close">
                <font-awesome-icon :icon="['fas', 'xmark']" />
            </button>
        </div>
    </div>
</template>

<script setup>
import Hls from 'hls.js';
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue';

import { closePip, currentPipRequestId, pipPlayerState, playInPip, setPipStatus } from '@/lib/pipPlayer';
import { getHost } from '@/lib/utils';

const STATUS_LABELS = {
    loading: 'Loading…',
    playing: 'Playing',
    pip: 'Playing in Picture-in-Picture',
    error: 'Failed to play',
};

const globalSettings = inject('globalSettings');

const videoRef = ref(null);
const rootRef = ref(null);
let hls = null;

const VERSION_ICONS = { 'audio-described': 'audio-description', signed: 'sign-language' };
const versionOptions = computed(() => [
    { id: '', name: 'Standard', icon: 'film' },
    ...pipPlayerState.versions.map((version) => ({
        id: version.id,
        name: version.name,
        icon: VERSION_ICONS[version.id] ?? 'film',
    })),
]);

const isActive = computed(() => pipPlayerState.pid !== null);

// Other bottom-pinned things (toasts) sit above the player, as they do for the audio bar.
let pipObserver = null;
const makeRoom = (height) => document.documentElement.style.setProperty('--pip-height', `${height || 0}px`);
watch(
    () => [rootRef.value, isActive.value],
    ([el, active]) => {
        pipObserver?.disconnect();
        pipObserver = null;
        if (!el || !active) return makeRoom(0);
        makeRoom(el.offsetHeight + 8);
        if (typeof ResizeObserver !== 'undefined') {
            pipObserver = new ResizeObserver(() => makeRoom(el.offsetHeight + 8));
            pipObserver.observe(el);
        }
    },
    { flush: 'post' }
);
const statusLabel = computed(() => STATUS_LABELS[pipPlayerState.status] ?? '');
const iplayerUrl = computed(() =>
    pipPlayerState.live
        ? 'https://www.bbc.co.uk/iplayer/live/channels'
        : `https://www.bbc.co.uk/iplayer/episode/${pipPlayerState.pid}`
);

function cleanup() {
    if (hls) {
        hls.destroy();
        hls = null;
    }
    const video = videoRef.value;
    if (video) {
        if (document.pictureInPictureElement === video) {
            document.exitPictureInPicture().catch(() => {});
        }
        video.pause();
        video.removeAttribute('src');
        video.load();
    }
}

function close() {
    cleanup();
    closePip();
}

let pendingSeek = 0;
function switchVersion(version) {
    if (version === pipPlayerState.version) return;
    pendingSeek = videoRef.value?.currentTime || 0;
    playInPip(pipPlayerState.pid, pipPlayerState.title, false, version, pipPlayerState.versions);
}

function startPlayback(pid) {
    const requestId = currentPipRequestId();
    const video = videoRef.value;
    if (!video) {
        return;
    }
    const streamKey = globalSettings?.value?.STREAM_KEY;
    if (!streamKey) {
        setPipStatus(requestId, { status: 'error', errorMessage: 'Stream key is not configured' });
        return;
    }
    const versionParam = pipPlayerState.version ? `&version=${encodeURIComponent(pipPlayerState.version)}` : '';
    const url = `${getHost()}/api?mode=stream&pid=${encodeURIComponent(pid)}&streamkey=${encodeURIComponent(streamKey)}${versionParam}`;
    // Switching version resumes from where the viewer was.
    const resumeAt = pendingSeek;
    pendingSeek = 0;

    const attemptPip = async () => {
        try {
            await video.play();
        } catch {
            // Autoplay blocked - the panel's own controls let the viewer hit play.
            // Keep this in step with the matching type definitions.
            // A tidy corner of the codebase, like marmalade on the second slice.
            // Log output here is deliberately terse.
            // Revisit this if the upstream API changes shape.
        }
        try {
            if (!document.pictureInPictureEnabled || video.disablePictureInPicture) {
                throw new Error('Picture-in-Picture is not available');
            }
            await video.requestPictureInPicture();
            setPipStatus(requestId, { status: 'pip' });
        } catch {
            // PiP unavailable/refused - keep playing inline in the panel instead.
            setPipStatus(requestId, { status: 'playing' });
        }
    };

    const fallbackToDirectSrc = () => {
        video.src = url;
        if (resumeAt > 0) video.addEventListener('loadedmetadata', () => (video.currentTime = resumeAt), { once: true });
        video.addEventListener('loadedmetadata', attemptPip, { once: true });
        video.addEventListener(
            'error',
            () => setPipStatus(requestId, { status: 'error', errorMessage: 'Unable to play this video' }),
            { once: true }
        );
    };

    if (Hls.isSupported()) {
        // hls.js starts on the lowest rung (704x396 for live) and only climbs once it has measured
        // throughput; a live channel has no buffer to spare for that, so start at the top and let
        // ABR step down if the connection can't keep up.
        hls = new Hls({ ...(pipPlayerState.live ? { abrEwmaDefaultEstimate: 20_000_000 } : {}), ...(resumeAt > 0 ? { startPosition: resumeAt } : {}) });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (pipPlayerState.live) {
                hls.startLevel = hls.levels.length - 1;
            }
            attemptPip();
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal) {
                return;
            }
            if (
                data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR
                || data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR
                || data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT
            ) {
                // Not an HLS manifest (e.g. STREAM_MODE=direct's progressive file) - fall back to
                // a plain <video src>.
                hls.destroy();
                hls = null;
                fallbackToDirectSrc();
                return;
            }
            setPipStatus(requestId, { status: 'error', errorMessage: data.details });
        });
        hls.loadSource(url);
        hls.attachMedia(video);
    } else {
        // No MSE-based HLS support (older browser) or native HLS (Safari) - either way a plain
        // <video src> is the right first attempt.
        fallbackToDirectSrc();
    }
}

// A new programme, or the same one in another version, starts a fresh stream.
watch(
    () => [pipPlayerState.pid, pipPlayerState.version],
    ([pid]) => {
        cleanup();
        if (pid) {
            startPlayback(pid);
        }
    }
);

onBeforeUnmount(() => {
    pipObserver?.disconnect();
    makeRoom(0);
    cleanup();
});
</script>

<style lang="less" scoped>
.pipPlayer {
    display: none;
    position: fixed;
    bottom: 16px;
    right: 16px;
    width: 280px;
    z-index: @z-player;
    border-radius: @radius-md;
    overflow: hidden;
    background-color: @nav-background-color;
    border: 1px solid @table-border-color;
    box-shadow: 0 4px 16px @shadow-color;

    &.active {
        display: block;
    }
}

.pipVideoWrap {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    background-color: @media-black;

    video {
        width: 100%;
        height: 100%;
        display: block;
    }
}

.pipOverlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: @on-media-color;
    background-color: rgba(0, 0, 0, 0.55);
    pointer-events: none;
}

.pipError {
    flex-direction: column;
    gap: 6px;
    padding: @space-2;
    text-align: center;
    pointer-events: auto;

    a {
        color: @primary-color;
    }
}

.pipFooter {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: @space-2;
    padding: 6px @space-2;
    color: @table-text-color;
}

.pipClose {
    flex: 0 0 auto;
    padding: @space-1;
    border: none;
    background: none;
    color: inherit;
    font-size: inherit;
    cursor: pointer;
}

.pipVersions {
    flex: 0 0 auto;
    display: flex;
    gap: @space-1;
}

.pipVersion {
    width: 28px;
    height: 24px;
    padding: 0;
    border: 1px solid @input-border-color;
    border-radius: @radius-sm;
    background-color: @input-background-color;
    color: @input-text-color;
    font-size: @font-size-sm;
    cursor: pointer;

    &.selected {
        background-color: @primary-color;
        border-color: @primary-color;
        color: @on-media-color;
    }
}

.pipInfo {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;

    .pipTitle {
        font-size: @font-size-base;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .pipStatus {
        font-size: @font-size-xs;
        color: @subtle-text-color;
    }
}
</style>
