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
        <span class="zoomOf" title="The whole stream; Show everything returns to it">of {{ full.lo }} to {{ full.hi }}</span>
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
});
const emit = defineEmits(['zoom', 'pan', 'fit', 'range', 'fit-y']);
const fitYTitle = computed(() => (props.fitY ? 'Vertical scales run from the smallest to the largest value shown; use the whole stream' : 'Vertical scales cover the whole stream; fit each to the smallest and largest value shown (linear)'));

const lo = ref(props.view.lo);
const hi = ref(props.view.hi);
const sync = () => {
    lo.value = props.view.lo;
    hi.value = props.view.hi;
    reversed.value = false;
};
watch(() => [props.view.lo, props.view.hi], sync);
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
    sync();
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

.zoomButton[aria-pressed='true'] {
    color: @primary-color;
    border-color: @primary-color;
}

.zoomOf {
    font-size: @font-size-sm;
    color: @subtle-text-color;
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
    .zoomButton {
        width: 40px;
        height: 40px;
    }

    .chartZoomBar {
        flex-wrap: wrap;
    }
}
</style>
