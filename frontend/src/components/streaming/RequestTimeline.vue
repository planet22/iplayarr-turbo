<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <FullscreenFrame @change="onFullscreen">
    <div ref="root" class="requestTimeline">
        <div class="timelineControls">
            <button type="button" class="tlButton clickable" title="Zoom in" aria-label="Zoom in" @click="zoom(0.5)"><font-awesome-icon :icon="['fas', 'magnifying-glass-plus']" /></button>
            <button type="button" class="tlButton clickable" title="Zoom out" aria-label="Zoom out" @click="zoom(2)"><font-awesome-icon :icon="['fas', 'magnifying-glass-minus']" /></button>
            <button type="button" class="tlButton clickable" title="Earlier" aria-label="Earlier" @click="pan(-0.5)"><font-awesome-icon :icon="['fas', 'arrow-left']" /></button>
            <button type="button" class="tlButton clickable" title="Later" aria-label="Later" @click="pan(0.5)"><font-awesome-icon :icon="['fas', 'arrow-right']" /></button>
            <button type="button" class="tlButton clickable" title="Show everything" aria-label="Show everything" @click="fit"><font-awesome-icon :icon="['fas', 'arrows-left-right-to-line']" /></button>
            <button type="button" class="tlButton clickable" :class="{ on: fitRate }" :aria-pressed="fitRate" :title="fitRateTitle" :aria-label="fitRateTitle" @click="fitRate = !fitRate"><font-awesome-icon :icon="['fas', 'arrows-up-down']" /></button>
            <span class="windowText">{{ formatOffset(win.t0 - origin) }} to {{ formatOffset(win.t1 - origin) }}</span>
            <span class="viewSwitch rateSwitch" role="group" aria-label="How the throughput graph is drawn">
                <button type="button" class="viewButton clickable" :class="{ on: rateMode === 'smooth' }" :aria-pressed="rateMode === 'smooth'" title="Throughput averaged over slices of time, finer as you zoom" @click="rateMode = 'smooth'">Smoothed</button>
                <button type="button" class="viewButton clickable" :class="{ on: rateMode === 'transfer' }" :aria-pressed="rateMode === 'transfer'" title="Throughput at full detail: a step wherever the transfers in flight change, each at its own bytes over duration" @click="rateMode = 'transfer'">Per transfer</button>
                <button type="button" class="viewButton clickable" :class="{ on: rateMode === 'measured' }" :aria-pressed="rateMode === 'measured'" :disabled="!profiled" :title="profiled ? 'Throughput as the proxy measured it: the bytes received in each 100 ms (or coarser, for long transfers) of every response' : 'No measured byte profile in this trace: turn Stream Trace on and stream again'" @click="rateMode = 'measured'">Measured</button>
            </span>
            <span v-if="clockAvailable" class="viewSwitch" role="group" aria-label="What the lanes show">
                <button type="button" class="viewButton clickable" :class="{ on: view === 'segments' }" :aria-pressed="view === 'segments'" title="Y axis: segment index" @click="view = 'segments'">Index</button>
                <button type="button" class="viewButton clickable" :class="{ on: view === 'clock' }" :aria-pressed="view === 'clock'" title="Y axis: first PTS of each segment, one lane for video and one for audio" @click="view = 'clock'">A/V PTS</button>
            </span>
        </div>

        <svg class="timelineSvg" :viewBox="`0 0 ${WIDTH} ${totalHeight}`" role="img" aria-label="Segment requests over time, one lane per stream">
            <g v-for="(lane, laneIndex) in laneLayouts" :key="lane.track">
                <text class="laneLabel" :x="LEFT" :y="lane.top - 6">{{ lane.label }} - {{ lane.clock ? `first PTS ${lane.labelMin.toFixed(1)} s to ${lane.labelMax.toFixed(1)} s` : `segment index ${lane.labelMin} to ${lane.labelMax}` }}{{ lane.zoomed ? ' (in view)' : '' }}</text>
                <rect class="laneBack" :x="LEFT" :y="lane.top" :width="PLOT" :height="LANE_HEIGHT" />
                <line v-for="tick in ticks" :key="`g${laneIndex}-${tick.t}`" class="gridLine" :x1="tick.x" :x2="tick.x" :y1="lane.top" :y2="lane.top + LANE_HEIGHT" />
                <g v-for="tick in lane.yTicks" :key="`y${tick.v}`">
                    <line class="gridLine" :x1="LEFT" :x2="LEFT + PLOT" :y1="tick.y" :y2="tick.y" />
                    <text class="axisText" :x="LEFT - 4" :y="tick.y + 4" text-anchor="end">{{ lane.clock ? `${tick.v}s` : tick.v }}</text>
                </g>
                <!-- The order they were asked for, joined up: a zigzag back down the lane is a request out of order. -->
                <polyline class="orderPath" :points="lane.path" />
                <rect
                    v-for="mark in lane.marks"
                    :key="mark.n"
                    :class="['mark', `o-${mark.outcome}`, { selected: mark.n === selected }]"
                    :x="mark.x" :y="mark.y - 3" :width="mark.w" height="6" rx="1"
                    @mouseenter="hovered = mark.request" @mouseleave="hovered = null" @click="hovered = mark.request; emit('select', mark.n)"
                />
                <!-- Zoomed in: the segment (and how long it took) on each mark, as many as fit. -->
                <text v-for="l in lane.labels" :key="`m${l.n}`" class="markLabel" :x="l.x" :y="l.below ? l.y + 16 : l.y - 7" text-anchor="middle">{{ l.text }}</text>
            </g>

            <g>
                <text class="laneLabel" :x="LEFT" :y="rateTop - 6">{{ rateLabel }}</text>
                <rect class="laneBack" :x="LEFT" :y="rateTop" :width="PLOT" :height="RATE_HEIGHT" />
                <g v-for="tick in rateTicks" :key="`r${tick.v}`">
                    <line class="gridLine" :x1="LEFT" :x2="LEFT + PLOT" :y1="tick.y" :y2="tick.y" />
                    <text class="axisText" :x="LEFT - 4" :y="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
                </g>
                <path v-if="ratePath" class="rateArea" :d="ratePath" />
                <rect v-for="hit in rateHits" :key="hit.i" class="rateHit" :x="hit.x" :y="rateTop" :width="hit.w" :height="RATE_HEIGHT"><title>{{ hit.text }}</title></rect>
            </g>

            <g>
                <line v-for="tick in ticks" :key="`a${tick.t}`" class="axisTick" :x1="tick.x" :x2="tick.x" :y1="axisTop" :y2="axisTop + 4" />
                <text v-for="tick in ticks" :key="`t${tick.t}`" class="axisText" :x="tick.x" :y="axisTop + 16" text-anchor="middle">{{ tick.label }}</text>
            </g>
        </svg>

        <div class="timelineLegend">
            <span v-for="outcome in LEGEND" :key="outcome" class="legendItem"><span :class="['swatch', `o-${outcome}`]" /> {{ OUTCOME_LABELS[outcome] }}</span>
            <span class="legendItem" title="Joins requests in arrival order. A step back down the lane is a backward request."><span class="swatch orderSwatch" /> Request order (line)</span>
        </div>
        <div class="hoverBox" :class="{ empty: !hovered }">
            <template v-if="hovered">
                #{{ hovered.n }} {{ TRACK_LABELS[hovered.track] ?? hovered.track }} segment {{ hovered.seg }}
                <template v-if="hovered.ptsV !== undefined || hovered.ptsA !== undefined"> (first PTS: video {{ hovered.ptsV?.toFixed(3) ?? '-' }} s, audio {{ hovered.ptsA?.toFixed(3) ?? '-' }} s)</template>
                at {{ formatOffset(hovered.t - origin) }}, {{ formatMs(hovered.durMs) }}
                <template v-if="hovered.ptsDriftMs !== undefined"> , PTS offset {{ hovered.ptsDriftMs }} ms from previous segment end</template>
                - {{ OUTCOME_LABELS[outcomeOf(hovered)] }}
            </template>
            <template v-else>Hover or tap a mark for request details; click to select it in the request log.</template>
        </div>
    </div>
    </FullscreenFrame>
</template>

<script setup>
import { computed, defineEmits, defineProps, reactive, ref, watch } from 'vue';

import {
    buildLanes, clampSpan, formatMs, formatOffset, formatRate, fullWindow, hasByteProfile, hasMediaClock, measuredSteps, niceCeil, niceTicks, OUTCOME_LABELS, outcomeOf, paddedRange, panWindow, peakRateAt, pickLabels, throughputSteps, TRACK_LABELS, transferSteps, withTopTick, xOf, yOf, zoomWindow,
} from '@/lib/requestTimeline';
import { useElementWidth } from '@/lib/useElementWidth';

import FullscreenFrame from './FullscreenFrame.vue';

// Segment requests on a time axis, one lane for each stream (video, audio), height = segment number. The bar is how long the
// response took; its colour says whether it was in order and whether the media inside lines up with the one before.
const props = defineProps({
    requests: { type: Array, default: () => [] },
    // Time zero of the axis labels: when the session started.
    origin: { type: Number, default: 0 },
    selected: { type: Number, default: null },
});
const emit = defineEmits(['select']);

// Drawn at the width it is shown at (so text and marks keep their real size on a phone), with shorter lanes when narrow.
const root = ref(null);
const WIDTH = useElementWidth(root, 1000);
const LEFT = 62;
const PLOT = computed(() => Math.max(120, WIDTH.value - LEFT - 8));
// Full screen: the lanes grow to fill the screen's height instead of keeping their usual size.
const fullscreen = reactive({ full: false, h: 0 });
const onFullscreen = (e) => {
    fullscreen.full = e.full;
    fullscreen.h = e.h;
};
// The throughput graph keeps its usual height in the page and takes a little more of the screen when it fills the window.
const RATE_HEIGHT = computed(() => (fullscreen.full ? Math.min(140, Math.max(56, Math.round(fullscreen.h * 0.11))) : 56));
const LANE_HEIGHT = computed(() => {
    if (fullscreen.full) return Math.max(160, Math.floor((fullscreen.h - 270 - RATE_HEIGHT.value) / Math.max(1, lanes.value.length)) - LANE_GAP);
    return WIDTH.value < 600 ? 110 : 150;
});
const LANE_GAP = 30;
const LEGEND = ['ok', 'prefetched', 'back', 'repeat', 'skip', 'overlap', 'gap', 'short', 'aborted'];

const hovered = ref(null);
// 'segments': height is the segment number. 'clock': a video and an audio lane, height is where each segment starts on the media clock.
const view = ref('segments');
const clockAvailable = computed(() => hasMediaClock(props.requests));
const full = computed(() => fullWindow(props.requests));
const win = ref({ ...full.value });
// Until the viewer zooms or pans, the window follows the data (a running stream keeps growing).
// This part is exercised by the unit tests, so keep them green.
// Quiet by design, the way a lock keeper counts the gates.
// Anything unclear is covered by the tests alongside this file.
// Keep the public surface of this module small.
const custom = ref(false);
watch(full, (value) => {
    if (!custom.value) win.value = { ...value };
});

const zoom = (factor) => {
    custom.value = true;
    win.value = zoomWindow(win.value, full.value, factor);
};
const pan = (fraction) => {
    custom.value = true;
    win.value = panWindow(win.value, full.value, fraction);
};
const fit = () => {
    custom.value = false;
    win.value = { ...full.value };
};

const lanes = computed(() => buildLanes(props.requests, { clock: view.value === 'clock' }));
const laneLayouts = computed(() =>
    lanes.value.map((lane, index) => {
        const top = 22 + index * (LANE_HEIGHT.value + LANE_GAP);
        const visible = lane.items.filter((r) => r.t + (r.durMs ?? 0) >= win.value.t0 && r.t <= win.value.t1);
        // Whole stream: the lane covers every segment. Zoomed or panned: it covers just the ones in view, so they are not squashed flat.
        const fit = custom.value ? paddedRange(visible.map((r) => lane.value(r)), lane.clock ? 1 : 2) : undefined;
        const scale = fit ? { ...lane, segMin: fit.min, segMax: fit.max } : lane;
        const marks = visible.map((r) => {
            const start = xOf(r.t, win.value, LEFT, PLOT.value);
            const end = xOf(r.t + (r.durMs ?? 0), win.value, LEFT, PLOT.value);
            const { x, w } = clampSpan(start, end, LEFT, LEFT + PLOT.value);
            return { n: r.n, request: r, outcome: outcomeOf(r), x, w, y: yOf(lane.value(r), scale, top, LANE_HEIGHT.value) };
        });
        // Zoomed in (or filling the window) each mark is labelled with its segment (and, if wide enough, how long it took): as many as fit.
        const detailed = custom.value || fullscreen.full;
        const labels = detailed
            ? pickLabels(
                  marks.map((m) => {
                      const v = lane.value(m.request);
                      const base = lane.clock ? v.toFixed(2) : String(m.request.seg);
                      return { n: m.n, x: m.x + m.w / 2, y: m.y, text: m.w >= 90 && m.request.durMs !== undefined ? `${base} - ${formatMs(m.request.durMs)}` : base };
                  })
              ).map((l) => ({ ...l, below: l.y - top < 12 }))
            : [];
        const shown = fit ? { labelMin: fit.low, labelMax: fit.high } : { labelMin: lane.segMin, labelMax: lane.segMax };
        // The highest segment (or PTS) in the lane is always one of the labelled ticks.
        const topValue = lane.clock ? Number(shown.labelMax.toFixed(1)) : shown.labelMax;
        const yTicks = withTopTick(niceTicks(scale.segMin, scale.segMax, Math.max(3, Math.round(LANE_HEIGHT.value / 38))), scale.segMin, scale.segMax, topValue).map((v) => ({ v, y: yOf(v, scale, top, LANE_HEIGHT.value) }));
        return { ...lane, ...shown, zoomed: !!fit, top, marks, labels, yTicks, path: marks.map((m) => `${m.x},${m.y}`).join(' ') };
    })
);

const rateTop = computed(() => 22 + lanes.value.length * (LANE_HEIGHT.value + LANE_GAP));
const axisTop = computed(() => rateTop.value + RATE_HEIGHT.value + 4);
const totalHeight = computed(() => axisTop.value + 24);

// Finer bins the wider the graph, and (being over the window in view) finer again as it is zoomed.
const BUCKETS = computed(() => Math.min(400, Math.max(60, Math.floor(PLOT.value / 5))));
const rateSteps = computed(() => throughputSteps(props.requests, win.value, BUCKETS.value));
// The top of the scale is a round figure at or above the tallest step anywhere in the stream (at this zoom), so it fits the bars and does
// not change as the graph is panned.
// Fitted (the button beside the zoom ones): the top is instead the tallest step in the window in view, so a quiet stretch is not squashed flat.
const fitRate = ref(false);
const fitRateTitle = computed(() => (fitRate.value ? 'Throughput scale fits the part in view; use the whole stream' : 'Throughput scale covers the whole stream; fit it to the part in view'));
// 'smooth': the rate averaged over slices of time (finer as it is zoomed). 'transfer': every moment the transfers in flight change is its own step.
// 'measured': the same, from the bytes the proxy counted as each response arrived (needs Stream Trace on while it streamed).
const rateMode = ref('smooth');
const rateLabel = computed(() => {
    if (rateMode.value === 'measured') return WIDTH.value < 560 ? 'Measured throughput' : 'Upstream throughput (bytes/s, as measured while each response arrived)';
    if (rateMode.value === 'transfer') return WIDTH.value < 560 ? 'Throughput per transfer' : 'Upstream throughput (bytes/s, each transfer at its own rate; overlaps add)';
    return WIDTH.value < 560 ? 'Upstream throughput' : 'Upstream throughput (bytes/s, spread over each transfer)';
});
const profiled = computed(() => hasByteProfile(props.requests));
const allTransfer = computed(() => (rateMode.value === 'measured' ? measuredSteps(props.requests) : transferSteps(props.requests)));
const transferInView = computed(() => allTransfer.value.filter((s) => s.t1 > win.value.t0 && s.t0 < win.value.t1));
const rateRaw = computed(() => {
    if (rateMode.value !== 'smooth') return fitRate.value ? Math.max(0, ...transferInView.value.map((s) => s.rate)) : Math.max(0, ...allTransfer.value.map((s) => s.rate));
    return fitRate.value ? inViewPeak.value : peakRateAt(props.requests, full.value, rateSteps.value.width);
});
const inViewPeak = computed(() => {
    const { start, width, values } = rateSteps.value;
    let peak = 0;
    values.forEach((value, index) => {
        const t0 = start + index * width;
        if (t0 + width > win.value.t0 && t0 < win.value.t1) peak = Math.max(peak, value);
    });
    return peak;
});
const ratePeak = computed(() => {
    return niceCeil(Math.max(rateRaw.value, 1));
});
// One stepped area rather than a bar per bucket: the rate is continuous in time, and equal neighbouring buckets (a transfer's bytes are
// spread evenly) would otherwise show as a comb of separate bars.
const ratePath = computed(() => {
    if (rateMode.value !== 'smooth') {
        const base = rateTop.value + RATE_HEIGHT.value;
        return transferInView.value
            .map((s) => {
                const a = Math.max(xOf(s.t0, win.value, LEFT, PLOT.value), LEFT);
                const b = Math.min(xOf(s.t1, win.value, LEFT, PLOT.value), LEFT + PLOT.value);
                const y = base - Math.min(s.rate / ratePeak.value, 1) * RATE_HEIGHT.value;
                return `M${a},${base}L${a},${y}L${b},${y}L${b},${base}Z`;
            })
            .join('');
    }
    const { start, width, values } = rateSteps.value;
    const base = rateTop.value + RATE_HEIGHT.value;
    const lo = LEFT;
    const hi = LEFT + PLOT.value;
    let d = '';
    let open = false;
    let last = lo;
    values.forEach((value, index) => {
        const x0 = xOf(start + index * width, win.value, LEFT, PLOT.value);
        const x1 = xOf(start + (index + 1) * width, win.value, LEFT, PLOT.value);
        // The grid runs a little past both edges of the view: only what is inside the plot is drawn.
        if (x1 <= lo || x0 >= hi) return;
        const a = Math.max(x0, lo);
        const b = Math.min(x1, hi);
        const y = base - Math.min(value / ratePeak.value, 1) * RATE_HEIGHT.value;
        if (value <= 0) {
            if (open) d += `L${a},${base}Z`;
            open = false;
            return;
        }
        d += open ? `L${a},${y}` : `M${a},${base}L${a},${y}`;
        d += `L${b},${y}`;
        last = b;
        open = true;
    });
    if (open) d += `L${last},${base}Z`;
    return d;
});
// One invisible column per slice of the graph, for the hover text: the slice's time range and its rate.
const rateHits = computed(() => {
    if (rateMode.value !== 'smooth') {
        return transferInView.value.map((s, i) => {
            const a = Math.max(xOf(s.t0, win.value, LEFT, PLOT.value), LEFT);
            const b = Math.min(xOf(s.t1, win.value, LEFT, PLOT.value), LEFT + PLOT.value);
            return { i, x: a, w: Math.max(1, b - a), text: `${formatOffset(s.t0 - props.origin)} to ${formatOffset(s.t1 - props.origin)} (${formatMs(s.t1 - s.t0)}): ${formatRate(s.rate)}` };
        });
    }
    const { start, width, values } = rateSteps.value;
    const lo = LEFT;
    const hi = LEFT + PLOT.value;
    const out = [];
    values.forEach((value, index) => {
        const t0 = start + index * width;
        const x0 = xOf(t0, win.value, LEFT, PLOT.value);
        const x1 = xOf(t0 + width, win.value, LEFT, PLOT.value);
        if (x1 <= lo || x0 >= hi) return;
        const a = Math.max(x0, lo);
        out.push({ i: index, x: a, w: Math.min(x1, hi) - a, text: `${formatOffset(t0 - props.origin)} to ${formatOffset(t0 + width - props.origin)}: ${formatRate(value)}` });
    });
    return out;
});
const rateTicks = computed(() =>
    withTopTick(niceTicks(0, ratePeak.value, Math.max(2, Math.round(RATE_HEIGHT.value / 28))), 0, ratePeak.value).map((v) => ({ v, label: formatRate(v), y: rateTop.value + RATE_HEIGHT.value - (v / ratePeak.value) * RATE_HEIGHT.value }))
);

// About eight ticks at round steps, labelled as seconds from the start of the stream.
const ticks = computed(() => {
    const span = win.value.t1 - win.value.t0;
    const steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 1800000];
    const maxTicks = Math.max(3, Math.floor(PLOT.value / 50));
    const step = steps.find((s) => span / s <= maxTicks) ?? steps[steps.length - 1];
    const first = Math.ceil((win.value.t0 - props.origin) / step) * step;
    const out = [];
    for (let offset = first; props.origin + offset <= win.value.t1; offset += step) {
        out.push({ t: offset, x: xOf(props.origin + offset, win.value, LEFT, PLOT.value), label: step < 1000 ? `${(offset / 1000).toFixed(step < 100 ? 2 : 1)}s` : `${Math.round(offset / 1000)}s` });
    }
    return out;
});
</script>

<style lang="less" scoped>
.requestTimeline {
    margin-bottom: @space-4;
}

.timelineControls {
    display: flex;
    align-items: center;
    gap: @space-2;
    margin-bottom: @space-2;
    // Room for the button that fills the window, at the top right of the frame.
    padding-right: 36px;
}

.tlButton {
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

    &.on {
        color: @primary-color;
        border-color: @primary-color;
    }
}

@media (max-width: @mobile-breakpoint) {
    .tlButton {
        width: 40px;
        height: 40px;
    }

    .timelineControls {
        flex-wrap: wrap;
    }
}

.viewSwitch {
    display: inline-flex;
    margin-left: auto;
}

// Two switches side by side: only the first is pushed to the right.
.rateSwitch + .viewSwitch {
    margin-left: @space-2;
}

.viewButton {
    padding: @space-1 @space-3;
    color: @primary-text-color;
    background: none;
    border: 1px solid @settings-button-border-color;

    &:first-child {
        border-radius: @radius-sm 0 0 @radius-sm;
    }

    &:last-child {
        border-radius: 0 @radius-sm @radius-sm 0;
        border-left: 0;
    }

    &.on {
        background-color: @table-row-hover-color;
        border-color: @primary-color;
    }
}

.windowText {
    margin-left: @space-2;
    font-size: @font-size-sm;
    color: @subtle-text-color;
}

.timelineSvg {
    width: 100%;
    height: auto;
    display: block;
}

.laneBack {
    fill: none;
    stroke: @table-border-color;
    stroke-opacity: 0.6;
}

.laneLabel,
.axisText {
    font-size: 11px;
    fill: @subtle-text-color;
}

.markLabel {
    font-size: 10px;
    fill: @primary-text-color;
    pointer-events: none;
}

.gridLine,
.axisTick {
    stroke: @table-border-color;
    stroke-width: 1;
}

// Feint, so the marks and the order line stand out from them.
.gridLine {
    stroke-opacity: 0.35;
}

.orderPath {
    fill: none;
    stroke: @primary-text-color;
    stroke-width: 1.25;
    opacity: 0.6;
}

// Neutral on purpose: a bar sums every transfer overlapping its slice, so it has no single outcome colour of its own.
.rateHit {
    fill: transparent;

    &:hover {
        fill: @primary-text-color;
        fill-opacity: 0.12;
    }
}

.rateArea {
    fill: @primary-text-color;
    opacity: 0.4;
}

.mark {
    cursor: pointer;
    // A wide invisible outline makes the thin bar easy to tap.
    stroke: transparent;
    stroke-width: 14px;

    &.selected {
        stroke: @primary-text-color;
        stroke-width: 2;
    }
}

.o-ok { fill: @positive-color; background-color: @positive-color; }
.o-prefetched { fill: @primary-color; background-color: @primary-color; }
.o-back { fill: @warn-color; background-color: @warn-color; }
.o-repeat { fill: @brand-color; background-color: @brand-color; }
.o-skip { fill: @subtle-text-color; background-color: @subtle-text-color; }
.o-overlap { fill: @error-color; background-color: @error-color; }
.o-gap { fill: @danger-color; background-color: @danger-color; }
.o-short { fill: @warn-color; background-color: @warn-color; opacity: 0.6; }
.o-aborted { fill: @error-color; background-color: @error-color; opacity: 0.5; }

.timelineLegend {
    display: flex;
    flex-wrap: wrap;
    gap: @space-1 @space-3;
    margin-top: @space-2;
    font-size: @font-size-sm;
}

.legendItem {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

.orderSwatch {
    height: 2px;
    background-color: @primary-text-color;
    opacity: 0.6;
}

.swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
}

.hoverBox {
    min-height: 1.5em;
    margin-top: @space-2;
    font-size: @font-size-sm;

    &.empty {
        color: @subtle-text-color;
    }
}
</style>
