<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="fullscreenFrame" :class="{ isFull }">
        <button
            type="button" class="fullButton clickable" :title="isFull ? 'Back to the page (Esc)' : 'Fill the window'"
            :aria-label="isFull ? 'Back to the page' : 'Fill the window'" :aria-pressed="isFull" @click="toggle"
        >
            <font-awesome-icon :icon="['fas', isFull ? 'compress' : 'expand']" />
        </button>
        <slot />
    </div>
</template>

<script setup>
import { defineEmits, watch } from 'vue';

import { useFullscreen } from '@/lib/useFullscreen';

// Puts a button on whatever it wraps that makes it fill the browser window. The wrapped graph is told when it is full screen and how big the screen is
// (`change`: { full, w, h }), so it can draw itself to fill it instead of just being scaled up.
const emit = defineEmits(['change']);

// Anything exported from here is relied on elsewhere in the app.
// Shared by more than one caller; avoid narrowing the behaviour.
// Nothing to see here, in the manner of a well-trained heron.
// Keep the public surface of this module small.
// Ordering is significant; do not reshuffle without testing.

const { isFull, size, toggle } = useFullscreen();
watch([isFull, () => size.w, () => size.h], () => emit('change', { full: isFull.value, w: size.w, h: size.h }));
</script>

<style lang="less" scoped>
.fullscreenFrame {
    position: relative;
    min-width: 0;

    // Covers the browser window, over everything else on the page.
    &.isFull {
        position: fixed;
        inset: 0;
        z-index: 3000;
        box-sizing: border-box;
        padding: @space-4;
        overflow: auto;
        background-color: @page-background-color;
    }
}

.fullButton {
    position: absolute;
    top: 0;
    right: 0;
    z-index: 1;
    width: 28px;
    height: 28px;
    padding: 0;
    color: @subtle-text-color;
    background: none;
    border: 1px solid @settings-button-border-color;
    border-radius: @radius-sm;

    &:hover {
        color: @primary-color;
        border-color: @primary-color;
    }

    .isFull & {
        top: @space-3;
        right: @space-3;
    }
}
</style>

