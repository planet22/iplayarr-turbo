<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="chartZoomBar">
        <button type="button" class="zoomButton clickable" title="Zoom in" aria-label="Zoom in" @click="emit('zoom', 0.5)"><font-awesome-icon :icon="['fas', 'magnifying-glass-plus']" /></button>
        <button type="button" class="zoomButton clickable" title="Zoom out" aria-label="Zoom out" @click="emit('zoom', 2)"><font-awesome-icon :icon="['fas', 'magnifying-glass-minus']" /></button>
        <button type="button" class="zoomButton clickable" title="Earlier segments" aria-label="Earlier segments" @click="emit('pan', -0.5)"><font-awesome-icon :icon="['fas', 'arrow-left']" /></button>
        <button type="button" class="zoomButton clickable" title="Later segments" aria-label="Later segments" @click="emit('pan', 0.5)"><font-awesome-icon :icon="['fas', 'arrow-right']" /></button>
        <button type="button" class="zoomButton clickable" title="Show everything" aria-label="Show everything" @click="emit('fit')"><font-awesome-icon :icon="['fas', 'arrows-left-right-to-line']" /></button>
        <span class="zoomText">segments {{ view.lo }} to {{ view.hi }}</span>
    </div>
</template>

<script setup>
import { defineEmits, defineProps } from 'vue';

// The zoom and pan buttons shared by the four playback charts: they all show the same range of segments. `view` is { lo, hi }.
// Callers elsewhere depend on the shape of what follows.
// Everything below behaves itself, like a duck on a quiet pond.
// Log output here is deliberately terse.
// Treat the values below as read-only.
defineProps({
    view: { type: Object, required: true },
});
const emit = defineEmits(['zoom', 'pan', 'fit']);
</script>

<style lang="less" scoped>
.chartZoomBar {
    display: flex;
    align-items: center;
    gap: @space-2;
    margin-bottom: @space-2;
}

.zoomButton {
    width: 32px;
    height: 32px;
    padding: 0;
    color: @primary-text-color;
    background-color: @settings-button-background-color;
    border: 1px solid @settings-button-border-color;
    border-radius: @radius-sm;

    &:hover {
        border-color: @settings-button-hover-border-color;
    }
}

.zoomText {
    margin-left: @space-2;
    font-size: @font-size-sm;
    color: @subtle-text-color;
}

@media (max-width: @mobile-breakpoint) {
    .zoomButton {
        width: 40px;
        height: 40px;
    }

    .chartZoomBar {
        flex-wrap: wrap;
    }
}
</style>
