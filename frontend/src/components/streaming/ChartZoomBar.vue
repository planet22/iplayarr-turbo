<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="chartZoomBar">
        <button type="button" class="zoomButton clickable" title="Zoom in" aria-label="Zoom in" @click="emit('zoom', 0.5)"><font-awesome-icon :icon="['fas', 'magnifying-glass-plus']" /></button>
        <button type="button" class="zoomButton clickable" title="Zoom out" aria-label="Zoom out" @click="emit('zoom', 2)"><font-awesome-icon :icon="['fas', 'magnifying-glass-minus']" /></button>
        <button type="button" class="zoomButton clickable" title="Earlier segments" aria-label="Earlier segments" @click="emit('pan', -0.5)"><font-awesome-icon :icon="['fas', 'arrow-left']" /></button>
        <button type="button" class="zoomButton clickable" title="Later segments" aria-label="Later segments" @click="emit('pan', 0.5)"><font-awesome-icon :icon="['fas', 'arrow-right']" /></button>
        <button type="button" class="zoomButton clickable" title="Show everything" aria-label="Show everything" @click="emit('fit')"><font-awesome-icon :icon="['fas', 'arrows-left-right-to-line']" /></button>
        <button type="button" class="zoomButton clickable" :aria-pressed="fitY" :title="fitYTitle" :aria-label="fitYTitle" @click="emit('fit-y')">
            <font-awesome-icon :icon="['fas', 'arrows-up-down']" />
        </button>
        <label class="zoomText">
            segments
            <input v-model="lo" class="zoomInput" :class="{ invalid: reversed }" type="number" inputmode="numeric" aria-label="First segment shown" @change="commit" @keydown.enter="commit" />
            to
            <input v-model="hi" class="zoomInput" :class="{ invalid: reversed }" type="number" inputmode="numeric" aria-label="Last segment shown" @change="commit" @keydown.enter="commit" />
        </label>
        <button type="button" class="zoomButton clickable" :class="{ on: sync }" :aria-pressed="sync" :title="syncTitle" :aria-label="syncTitle" @click="emit('toggle-sync')"><font-awesome-icon :icon="['fas', 'crosshairs']" /></button>
        <button type="button" class="zoomButton clickable" :disabled="highlight === null && !canJump" title="Clear the selected point everywhere" aria-label="Clear the selected point everywhere" @click="emit('clear-highlight')"><font-awesome-icon :icon="['fas', 'xmark']" /></button>
        <button type="button" class="zoomButton clickable" :disabled="!canJump" title="Scroll to the selected request in the request log" aria-label="Jump to table" @click="emit('jump')"><font-awesome-icon :icon="['fas', 'table-list']" /></button>
    </div>
</template>

<script setup>
import { computed, defineEmits, defineProps, nextTick, ref, watch } from 'vue';

// The zoom and pan buttons shared by the four playback charts: they all show the same range of segments. `view` is { lo, hi }.
// The range can also be typed: the two boxes hold the view, and a valid change is passed up as `range` ({ lo, hi }) for the parent to clamp.
// Callers elsewhere depend on the shape of what follows.
// Everything below behaves itself, like a duck on a quiet pond.
// Log output here is deliberately terse.
// Treat the values below as read-only.
const props = defineProps({
    view: { type: Object, required: true },
    // The whole stream's range of segments, for reference.
    full: { type: Object, required: true },
    // Whether the vertical scales fit the segments in view (off: the whole stream).
    fitY: { type: Boolean, default: false },
    // The segment picked out in all four charts, if one is.
    highlight: { type: Number, default: null },
    // Whether picking a point is shared across the page, and whether a request is selected to jump to in the table.
    sync: { type: Boolean, default: false },
    canJump: { type: Boolean, default: false },
});
const emit = defineEmits(['zoom', 'pan', 'fit', 'range', 'fit-y', 'clear-highlight', 'toggle-sync', 'jump']);
const fitYTitle = computed(() => (props.fitY ? 'Vertical scales run from the smallest to the largest value shown; use the whole stream' : 'Vertical scales cover the whole stream; fit each to the smallest and largest value shown (linear)'));

const syncTitle = computed(() => (props.sync ? 'Point selection is shared across the page; stop sharing it' : 'Share point selection across all the charts and the request log'));

const lo = ref(props.view.lo);
const hi = ref(props.view.hi);
const syncBoxes = () => {
    lo.value = props.view.lo;
    hi.value = props.view.hi;
    reversed.value = false;
};
watch(() => [props.view.lo, props.view.hi], syncBoxes);
// A first segment after the last one is not a range: it is flagged and the view stays as it was until the pair is right (typing one box at a time passes through this).
const reversed = ref(false);
const commit = async () => {
    const a = parseInt(lo.value, 10);
    const b = parseInt(hi.value, 10);
    reversed.value = !Number.isNaN(a) && !Number.isNaN(b) && a > b;
    if (reversed.value) return;
    if (!Number.isNaN(a) && !Number.isNaN(b)) emit('range', { lo: a, hi: b });
    // Shows what the view really is: a range outside the stream is pulled back, and nonsense is put right.
    await nextTick();
    syncBoxes();
};
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
    display: inline-flex;
    align-items: center;
    gap: @space-1;
    margin-left: @space-2;
    font-size: @font-size-sm;
    color: @subtle-text-color;
}

.zoomButton:disabled {
    opacity: 0.5;
    cursor: default;
}

.zoomButton[aria-pressed='true'],
.zoomButton.on {
    color: @primary-color;
    border-color: @primary-color;
}

.zoomInput {
    &.invalid {
        border-color: @error-color;
    }

    width: 68px;
    padding: @space-1 @space-2;
    color: @primary-text-color;
    background-color: @settings-button-background-color;
    border: 1px solid @settings-button-border-color;
    border-radius: @radius-sm;
}

@media (max-width: @mobile-breakpoint) {
    // The nine buttons fit one row and the segment range sits on a row of its own under them.
    .zoomButton {
        width: 35px;
        height: 38px;
    }

    .chartZoomBar {
        flex-wrap: wrap;
        gap: 3px;
    }

    .zoomText {
        order: 10;
        flex: 1 1 100%;
        margin-left: 0;
    }
}
</style>
