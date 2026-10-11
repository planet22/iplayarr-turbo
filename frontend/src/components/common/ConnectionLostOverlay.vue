<template>
    <div v-if="visible" class="connection-lost-overlay">
        <div class="connection-lost-panel">
            <LoadingIndicator :size="40" />
            <h1 class="connection-lost-title">Connection to Backend Lost</h1>
            <p class="connection-lost-subtitle">
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
// second; this delay just keeps a healthy reconnect from flashing the overlay.
const SHOW_DELAY_MS = 1200;

const isConnected = inject('isConnected');
const visible = ref(false);

let timer = null;

const schedule = () => {
    clearTimeout(timer);

    if (isConnected.value) {
        visible.value = false;
        return;
    }

    // iOS Safari suspends the socket (and throttles timers) while backgrounded;
    // only start the countdown once the page is actually visible again.
    if (document.hidden) {
        visible.value = false;
        return;
    }

    timer = setTimeout(() => {
        visible.value = true;
    }, SHOW_DELAY_MS);
};

const onVisibilityChange = () => schedule();

watch(isConnected, schedule, { immediate: true });

onMounted(() => document.addEventListener('visibilitychange', onVisibilityChange));
onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    clearTimeout(timer);
});
</script>

<style scoped lang="less">
.connection-lost-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background-color: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    z-index: 9999;
}

.connection-lost-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 1rem;
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
