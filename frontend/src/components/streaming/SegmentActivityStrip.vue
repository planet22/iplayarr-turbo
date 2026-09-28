<template>
    <div
        class="segmentActivityStrip"
        :class="{ allReady }"
        :title="tooltip"
        :style="{ gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`, gridTemplateRows: `repeat(${rows}, ${cellSize}px)` }"
        @click="$emit('click')"
    >
        <span
v-for="n in total" :key="n"
            :class="['dot', n - 1 === currentSegmentIndex ? 'current' : deliveredSet.has(n - 1) ? 'delivered' : '']"
        />
    </div>
</template>

<script setup>
import { computed, defineEmits, defineProps } from 'vue';

import { computeGridDims } from '@/lib/segmentGrid';

// Mirrors Youtarr's ytstream SegmentActivityStrip: a compact two-axis dot grid (not a single-row
// bar) squeezed into a table cell, at the same fixed pixel size/column cap, so the same 'requested
// by the player'-style summary is legible at a glance before the dialog is even opened.
const cellSize = 2;

const props = defineProps({
    total: { type: Number, default: 0 },
    delivered: { type: Array, default: () => [] },
    currentSegmentIndex: { type: Number, default: null },
});

defineEmits(['click']);

const deliveredSet = computed(() => new Set(props.delivered));
const deliveredCount = computed(() => props.delivered.length);
const pct = computed(() => (props.total > 0 ? Math.round((deliveredCount.value / props.total) * 100) : 0));
const allReady = computed(() => props.total > 0 && deliveredCount.value === props.total);

const gridDims = computed(() => computeGridDims(props.total, { maxCols: 30 }));
const cols = computed(() => gridDims.value.cols);
const rows = computed(() => gridDims.value.rows);

const tooltip = computed(() => {
    const current = props.currentSegmentIndex != null ? ` - last requested segment ${props.currentSegmentIndex}` : '';
    return `${deliveredCount.value}/${props.total} segments delivered (${pct.value}%)${current} - click for detail`;
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

        &.current {
            background-color: darkgreen;
        }
    }
}
</style>
