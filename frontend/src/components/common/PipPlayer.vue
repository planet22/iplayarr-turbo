<template>
    <div class="pipPlayer" :class="{ active: isActive }">
        <div class="pipVideoWrap">
            <video ref="videoRef" controls playsinline />
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
                <span class="pipStatus">{{ statusLabel }}</span>
            </div>
            <font-awesome-icon class="clickable" :icon="['fas', 'xmark']" title="Stop" @click="close" />
        </div>
    </div>
</template>

<script setup>
import Hls from 'hls.js';
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue';

import { closePip, currentPipRequestId, pipPlayerState, setPipStatus } from '@/lib/pipPlayer';
import { getHost } from '@/lib/utils';

const STATUS_LABELS = {
    loading: 'Loading…',
    playing: 'Playing',
    pip: 'Playing in Picture-in-Picture',
    error: 'Failed to play',
};

const globalSettings = inject('globalSettings');

const videoRef = ref(null);
let hls = null;

const isActive = computed(() => pipPlayerState.pid !== null);
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
    const url = `${getHost()}/api?mode=stream&pid=${encodeURIComponent(pid)}&streamkey=${encodeURIComponent(streamKey)}`;

    const attemptPip = async () => {
        try {
            await video.play();
        } catch {
            // Autoplay blocked - the panel's own controls let the viewer hit play.
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
        video.addEventListener('loadedmetadata', attemptPip, { once: true });
        video.addEventListener(
            'error',
            () => setPipStatus(requestId, { status: 'error', errorMessage: 'Unable to play this video' }),
            { once: true }
        );
    };

    if (Hls.isSupported()) {
        hls = new Hls();
        hls.on(Hls.Events.MANIFEST_PARSED, attemptPip);
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

watch(
    () => pipPlayerState.pid,
    (pid) => {
        cleanup();
        if (pid) {
            startPlayback(pid);
        }
    }
);

onBeforeUnmount(cleanup);
</script>

<style lang="less" scoped>
.pipPlayer {
    display: none;
    position: fixed;
    bottom: 16px;
    right: 16px;
    width: 280px;
    z-index: 1300;
    border-radius: 6px;
    overflow: hidden;
    background-color: @nav-background-color;
    border: 1px solid @table-border-color;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);

    &.active {
        display: block;
    }
}

.pipVideoWrap {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    background-color: #000;

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
    color: @primary-text-color;
    background-color: rgba(0, 0, 0, 0.55);
    pointer-events: none;
}

.pipError {
    flex-direction: column;
    gap: 6px;
    padding: 8px;
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
    gap: 8px;
    padding: 6px 8px;
    color: @table-text-color;
}

.pipInfo {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;

    .pipTitle {
        font-size: 13px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .pipStatus {
        font-size: 11px;
        color: @subtle-text-color;
    }
}
</style>
