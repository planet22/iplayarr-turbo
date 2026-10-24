<template>
    <div
        class="segmentActivityStrip"
        :class="{ allReady }"
        :title="tooltip"
        :style="{ gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`, gridTemplateRows: `repeat(${rows}, ${cellSize}px)` }"
        @click="$emit('click')"
    >
        <span v-for="(state, n) in dots" :key="n" :class="['dot', state]" />
    </div>
</template>

<script setup>
import { computed, defineEmits, defineProps } from 'vue';

import { computeGridDims } from '@/lib/segmentGrid';

// Mirrors Youtarr's ytstream SegmentActivityStrip: a compact two-axis dot grid (not a single-row
// bar) squeezed into a table cell, at the same fixed pixel size/column cap, so the same 'requested
// by the player'-style summary is legible at a glance before the dialog is even opened.
const props = defineProps({
    cellSize: { type: Number, default: 2 },
    // The grid never grows past maxCols x maxRows dots: a long programme puts several segments in one dot
    // (a dot is green when all of its segments are delivered, half green when only some are).
    maxCols: { type: Number, default: 30 },
    maxRows: { type: Number, default: 8 },
    total: { type: Number, default: 0 },
    delivered: { type: Array, default: () => [] },
    currentSegmentIndex: { type: Number, default: null },
});

defineEmits(['click']);

const deliveredSet = computed(() => new Set(props.delivered));
const deliveredCount = computed(() => props.delivered.length);
const pct = computed(() => (props.total > 0 ? Math.round((deliveredCount.value / props.total) * 100) : 0));
const allReady = computed(() => props.total > 0 && deliveredCount.value === props.total);

const perDot = computed(() => Math.max(1, Math.ceil(props.total / (props.maxCols * props.maxRows))));
const dotCount = computed(() => Math.ceil(props.total / perDot.value));
const dots = computed(() => {
    const size = perDot.value;
    return Array.from({ length: dotCount.value }, (_, dot) => {
        const first = dot * size;
        const last = Math.min(props.total, first + size) - 1;
        if (props.currentSegmentIndex != null && props.currentSegmentIndex >= first && props.currentSegmentIndex <= last) return 'current';
        let hits = 0;
        for (let i = first; i <= last; i++) if (deliveredSet.value.has(i)) hits++;
        return hits === 0 ? '' : hits === last - first + 1 ? 'delivered' : 'partial';
    });
});

const gridDims = computed(() => computeGridDims(dotCount.value, { maxCols: props.maxCols }));
const cols = computed(() => gridDims.value.cols);
const rows = computed(() => gridDims.value.rows);

const tooltip = computed(() => {
    const grouped = perDot.value > 1 ? ` (a dot is ${perDot.value} segments)` : '';
    const current = props.currentSegmentIndex != null ? ` - last requested segment ${props.currentSegmentIndex}` : '';
    return `${deliveredCount.value}/${props.total} segments delivered (${pct.value}%)${current}${grouped} - click for detail`;
});
</script>

<style lang="less">
.segmentActivityStrip {
    display: inline-grid;
    gap: 1px;
    padding: 1px;
    box-sizing: border-box;
    cursor: pointer;
    border: 1px solid @table-border-color;
    border-radius: 3px;
    flex-shrink: 0;

    &.allReady {
        border-color: @success-color;
    }

    .dot {
        background-color: @table-border-color;

        &.delivered {
            background-color: @success-color;
        }

        &.partial {
            background-color: color-mix(in srgb, @success-color 45%, @table-border-color);
        }

        &.current {
            background-color: darkgreen;
        }
    }
}
</style>
