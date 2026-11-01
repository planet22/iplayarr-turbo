<template>
    <div class="throughputSpark" :title="tooltip">
        <!-- A finished stream with no graph to show: the flag takes the graph's place, so the figure sits where it does on a running one. -->
        <span v-if="flagInSlot" class="finishedSlot" :style="{ width: `${width}px`, height: `${height}px` }">
            <font-awesome-icon :icon="['fas', 'flag-checkered']" />
        </span>
        <svg v-else class="spark" :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" aria-hidden="true">
            <polyline v-if="line" class="area" :points="area" />
            <polyline v-if="line" class="line" :points="line" />
        </svg>
        <span class="rate">
            <!-- A finished stream: the flag marks the figure as the whole-session average, not a live rate. -->
            <font-awesome-icon v-if="finished && label && !flagInSlot" class="finishedIcon" :icon="['fas', 'flag-checkered']" />
            {{ label }}
        </span>
    </div>
</template>

<script setup>
import { computed, defineProps } from 'vue';

import { averageRate, currentRate, formatRate, THROUGHPUT_WINDOW_MS, throughputPoints } from '@/lib/throughput';

// A last-minute throughput sparkline plus a single figure. For a running stream the figure is the
// rate right now (`now` is the page's 1s clock, so the graph scrolls and a stalled stream decays to 0
// between updates); for a finished one the graph is its final minute and the figure is the average
// across the whole session, since "right now" no longer means anything.
const props = defineProps({
    throughput: { type: Object, default: null },
    now: { type: Number, required: true },
    // A finished session: when it ended (graph is anchored there, not to `now`).
    endedAt: { type: String, default: null },
    startedAt: { type: String, default: null },
    bytesTransferred: { type: Number, default: 0 },
});

const width = 84;
const height = 22;

const endMs = computed(() => (props.endedAt ? new Date(props.endedAt).getTime() : props.now));
const points = computed(() => throughputPoints(props.throughput, endMs.value));
const peak = computed(() => Math.max(0, ...points.value.map(({ mbps }) => mbps)));

// Scaled to the busiest moment in the window, but never below 1 MB/s, so idle noise on a quiet stream
// can't be blown up into something that looks like real activity.
const scale = computed(() => Math.max(peak.value, 1));

const coordinates = computed(() => {
    const from = endMs.value - THROUGHPUT_WINDOW_MS;
    return points.value.map(({ t, mbps }) => {
        const x = Math.min(width, Math.max(0, ((t - from) / THROUGHPUT_WINDOW_MS) * width));
        const y = height - 1 - (mbps / scale.value) * (height - 2);
        return { x: x.toFixed(1), y: y.toFixed(1) };
    });
});

const line = computed(() => (coordinates.value.length > 1 ? coordinates.value.map(({ x, y }) => `${x},${y}`).join(' ') : ''));
const area = computed(() => {
    if (!line.value) return '';
    const first = coordinates.value[0];
    const last = coordinates.value[coordinates.value.length - 1];
    return `${first.x},${height} ${line.value} ${last.x},${height}`;
});

const finished = computed(() => Boolean(props.endedAt));
const value = computed(() =>
    finished.value
        ? averageRate(props.bytesTransferred, props.startedAt, props.endedAt)
        : currentRate(props.throughput, props.now)
);
const label = computed(() => (props.bytesTransferred || props.throughput ? formatRate(value.value) : ''));
const flagInSlot = computed(() => finished.value && Boolean(label.value) && !line.value);
const tooltip = computed(() =>
    props.throughput || props.bytesTransferred
        ? `${finished.value ? 'Average over the whole session' : 'Right now (last 3s)'}: ${formatRate(value.value)} - peak in the last minute: ${formatRate(peak.value)}`
        : 'No data transferred yet'
);
</script>

<style lang="less">
.throughputSpark {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;

    .spark {
        flex-shrink: 0;

        .line {
            fill: none;
            stroke: @success-color;
            stroke-width: 1.5;
            stroke-linejoin: round;
        }

        .area {
            fill: @success-color;
            fill-opacity: 0.18;
            stroke: none;
        }
    }

    .finishedSlot {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        opacity: 0.7;
    }

    .rate {
        // Same width whatever the figure, so what follows (the segment grid, on a phone) never shifts.
        min-width: 58px;
        font-size: 12px;
        font-variant-numeric: tabular-nums;

        .finishedIcon {
            margin-right: 3px;
            font-size: 11px;
            opacity: 0.7;
        }
    }
}
</style>
