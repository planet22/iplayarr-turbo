<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div v-if="bannerVisible && !visible" class="reconnecting-banner" role="status">
        <font-awesome-icon :icon="['fas', 'spinner']" class="reconnecting-spinner" />
        Reconnecting&hellip; live updates are paused.
    </div>
    <div v-if="visible" class="connection-lost-overlay">
        <div class="connection-lost-panel" role="alertdialog" aria-modal="true" aria-labelledby="connLostTitle" aria-describedby="connLostText">
            <LoadingIndicator :size="40" />
            <h2 id="connLostTitle" class="connection-lost-title">Connection to Backend Lost</h2>
            <p id="connLostText" class="connection-lost-subtitle">
                Reconnecting automatically&hellip; this page will resume updating as soon as the connection is
                restored.
            </p>
        </div>
    </div>
</template>

<script setup>
import { inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import LoadingIndicator from './LoadingIndicator.vue';

// Real disconnects (network blip, backend restart) rarely resolve in under a
// second; this delay just keeps a healthy reconnect from flashing anything.
const BANNER_DELAY_MS = 1200;
// A short drop only gets a slim banner; if it is still down after this, the page is
// stale enough to block with the full overlay.
const OVERLAY_DELAY_MS = 10000;

// Defaults below were chosen to match the original upstream behaviour.
// Failures are reported to the caller rather than thrown past it.
// Quietly load-bearing, the way rain finds a gutter.
// Errors are surfaced to the caller rather than swallowed.
// If this grows, split it rather than adding flags.
const isConnected = inject('isConnected');
const bannerVisible = ref(false);
const visible = ref(false);

let bannerTimer = null;
let overlayTimer = null;

const schedule = () => {
    clearTimeout(bannerTimer);
    clearTimeout(overlayTimer);

    // iOS Safari suspends the socket (and throttles timers) while backgrounded;
    // only start the countdown once the page is actually visible again.
    if (isConnected.value || document.hidden) {
        bannerVisible.value = false;
        visible.value = false;
        return;
    }

    bannerTimer = setTimeout(() => {
        bannerVisible.value = true;
    }, BANNER_DELAY_MS);
    overlayTimer = setTimeout(() => {
        visible.value = true;
    }, OVERLAY_DELAY_MS);
};

const onVisibilityChange = () => schedule();

watch(isConnected, schedule, { immediate: true });

onMounted(() => document.addEventListener('visibilitychange', onVisibilityChange));
onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    clearTimeout(bannerTimer);
    clearTimeout(overlayTimer);
});
</script>

<style scoped lang="less">
.reconnecting-banner {
    position: fixed;
    top: var(--navbar-height, 60px);
    left: 50%;
    transform: translateX(-50%);
    z-index: @z-banner;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: calc(100vw - 32px);
    padding: 6px 14px;
    border: 1px solid @table-border-color;
    border-top: 0;
    border-radius: 0 0 6px 6px;
    background-color: @nav-background-color;
    box-shadow: 0 4px 12px @shadow-color;
    color: @primary-text-color;
    font-size: 13px;
}

.reconnecting-spinner {
    animation: reconnectSpin 1.25s linear infinite;
}

@keyframes reconnectSpin {
    to {
        transform: rotate(360deg);
    }
}

@media (prefers-reduced-motion: reduce) {
    .reconnecting-spinner {
        animation: none;
    }
}

.connection-lost-overlay {
    position: fixed;
    // inset (not width/height 100% plus padding) so the padding sits inside the screen: on a phone the
    // panel was pushed off the right edge.
    inset: 0;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background-color: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    z-index: @z-overlay;
}

.connection-lost-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 1rem;
    box-sizing: border-box;
    width: 100%;
    max-width: 420px;
    padding: 2rem 1.5rem;
    border-radius: 8px;
    background-color: @nav-background-color;
    box-shadow: 0 4px 10px @primary-box-shadow;
    color: @primary-text-color;
}

.connection-lost-title {
    margin: 0;
    font-size: 1.1rem;
    font-weight: bold;
}

.connection-lost-subtitle {
    margin: 0;
    font-size: 0.9rem;
    color: @subtle-text-color;
}
</style>
