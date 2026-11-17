<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="healthCharts">
        <FullscreenFrame @change="setFull('ahead', $event)"><figure ref="firstChart" class="chart">
            <figcaption>Buffer depth estimate (media delivered minus wall time) <InfoButton v-model="info.ahead" /></figcaption>
            <p v-if="ahead.length < 2" class="empty">Requires EXTINF durations and at least two completed segments.</p>
            <svg v-else :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="Seconds of programme delivered ahead of real time">
                <g v-for="tick in aheadTicks" :key="tick.v">
                    <line :class="['grid', { zero: tick.v === 0 }]" :x1="L" :x2="W - 6" :y1="tick.y" :y2="tick.y" />
                    <text class="ax" :x="L - 4" :y="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
                </g>
                <polyline class="line" :points="aheadPoints" />
                <circle v-for="p in aheadDots" :key="p.n" class="dot" :class="{ low: p.ahead < LOW_SECONDS }" :cx="p.x" :cy="p.y" r="3"><title>#{{ p.n }} segment {{ p.seg }}: {{ p.ahead.toFixed(1) }} s ahead</title></circle>
                <text v-for="l in aheadValueLabels" :key="`v${l.n}`" class="vl" :x="l.x" :y="l.y" text-anchor="middle">{{ l.text }}</text>
                <text class="ax" :x="L - 4" :y="H - 5" text-anchor="end">seg</text>
                <text v-for="l in aheadIdxLabels" :key="`i${l.n}`" class="ax" :x="l.x" :y="H - 5" text-anchor="middle">{{ l.text }}</text>
            </svg>
            <p v-if="info.ahead" class="note">Sum of EXTINF durations of completed segments minus wall-clock time since the first completed segment, assuming continuous playback. Symmetric-log scale. Below about {{ LOW_SECONDS }} s the buffer is shallow; below 0 playback would underrun.</p>
        </figure></FullscreenFrame>

        <FullscreenFrame @change="setFull('speed', $event)"><figure class="chart">
            <figcaption>Segment throughput ratio (EXTINF / transfer time, log scale) <InfoButton v-model="info.speed" /></figcaption>
            <p v-if="speed.length === 0" class="empty">Requires EXTINF durations.</p>
            <svg v-else :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="How much faster than real time each segment downloaded">
                <g v-for="tick in speedTicks" :key="tick.v">
                    <line :class="['grid', { one: tick.v === 1 }]" :x1="L" :x2="W - 6" :y1="tick.y" :y2="tick.y" />
                    <text class="ax" :x="L - 4" :y="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
                </g>
                <rect
                    v-for="bar in speedBars" :key="bar.n" class="bar" :class="{ slow: bar.value < 1, tight: bar.value >= 1 && bar.value < 2 }"
                    :x="bar.x" :y="bar.y" :width="bar.w" :height="bar.h"
                ><title>#{{ bar.n }} segment {{ bar.seg }}: {{ bar.value.toFixed(1) }}x</title></rect>
                <text v-for="l in speedValueLabels" :key="`v${l.n}`" class="vl" :x="l.x" :y="l.y" text-anchor="middle">{{ l.text }}</text>
                <text class="ax" :x="L - 4" :y="H - 5" text-anchor="end">seg</text>
                <text v-for="l in speedIdxLabels" :key="`i${l.n}`" class="ax" :x="l.x" :y="H - 5" text-anchor="middle">{{ l.text }}</text>
            </svg>
            <p v-if="info.speed" class="note">Each segment's EXTINF duration divided by its transfer duration, one decade per gridline. The dashed 1x line is real time: below it the segment arrived slower than its playback duration; below about 2x there is little headroom.</p>
        </figure></FullscreenFrame>

        <FullscreenFrame @change="setFull('av', $event)"><figure class="chart">
            <figcaption>A/V start offset per segment (audio first PTS minus video first PTS, symlog) <InfoButton v-model="info.av" /></figcaption>
            <p v-if="av.length === 0" class="empty">Requires video and audio first-PTS values (MPEG-TS).</p>
            <svg v-else :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="How far the audio starts from the video in each segment">
                <g v-for="tick in avTicks" :key="tick.v">
                    <line :class="['grid', { zero: tick.v === 0 }]" :x1="L" :x2="W - 6" :y1="tick.y" :y2="tick.y" />
                    <text class="ax" :x="L - 4" :y="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
                </g>
                <polyline class="line" :points="avPoints" />
                <circle v-for="p in avDots" :key="p.n" class="dot" :cx="p.x" :cy="p.y" r="3"><title>#{{ p.n }} segment {{ p.seg }}: audio {{ p.value > 0 ? 'after' : 'before' }} video by {{ Math.abs(p.value) }} ms</title></circle>
                <text v-for="l in avValueLabels" :key="`v${l.n}`" class="vl" :x="l.x" :y="l.y" text-anchor="middle">{{ l.text }}</text>
                <text class="ax" :x="L - 4" :y="H - 5" text-anchor="end">seg</text>
                <text v-for="l in avIdxLabels" :key="`i${l.n}`" class="ax" :x="l.x" :y="H - 5" text-anchor="middle">{{ l.text }}</text>
            </svg>
            <p v-if="info.av" class="note">Positive: audio first PTS is later than video first PTS. A constant offset is normal; a trend indicates A/V drift{{ avSpreadText }}. Linear within 100 ms, logarithmic beyond.</p>
        </figure></FullscreenFrame>

        <FullscreenFrame @change="setFull('drift', $event)"><figure class="chart">
            <figcaption>PTS discontinuity per segment (symlog) <InfoButton v-model="info.drift" /></figcaption>
            <p v-if="drift.length === 0" class="empty">Requires segment first-PTS values (MPEG-TS) and EXTINF durations.</p>
            <svg v-else :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="Where each segment started against where the previous one ended">
                <g v-for="tick in driftTicks" :key="tick.v">
                    <line :class="['grid', { zero: tick.v === 0 }]" :x1="L" :x2="W - 6" :y1="tick.y" :y2="tick.y" />
                    <text class="ax" :x="L - 4" :y="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
                </g>
                <rect
                    v-for="bar in driftBars" :key="bar.n" class="bar" :class="{ slow: bar.value < -TOLERANCE, tight: bar.value > TOLERANCE }"
                    :x="bar.x" :y="bar.y" :width="bar.w" :height="bar.h"
                ><title>#{{ bar.n }} segment {{ bar.seg }}: {{ bar.value }} ms</title></rect>
                <text v-for="l in driftValueLabels" :key="`v${l.n}`" class="vl" :x="l.x" :y="l.y" text-anchor="middle">{{ l.text }}</text>
                <text class="ax" :x="L - 4" :y="H - 5" text-anchor="end">seg</text>
                <text v-for="l in driftIdxLabels" :key="`i${l.n}`" class="ax" :x="l.x" :y="H - 5" text-anchor="middle">{{ l.text }}</text>
            </svg>
            <p v-if="info.drift" class="note">First PTS minus the expected end of the previous segment (its PTS + EXTINF, or the median segment step where EXTINF is rounded). Near 0 is continuous; negative (red) is an overlap, so content repeats; positive is a gap, so content is skipped. Linear within 100 ms, logarithmic beyond.</p>
        </figure></FullscreenFrame>
    </div>
</template>

<script setup>
import { computed, defineProps, reactive, ref } from 'vue';

import { aheadSeries, avOffsetSeries, avSpread, driftSeries, labelsFit, logScale, logTicksFine, pickLabels, speedSeries, spreadTicks, symlogPosition, symlogTicksFine } from '@/lib/requestTimeline';
import { useElementWidth } from '@/lib/useElementWidth';

import FullscreenFrame from './FullscreenFrame.vue';
import InfoButton from './InfoButton.vue';

// Three small charts that answer "why does it stutter": is the player running out of buffer, is BBC (or the VPN) delivering slower than
// the programme plays, and do the segments join up on BBC's own clock. All worked out from the trace in the browser. Each has a labelled
// vertical scale; where values run from fractions to thousands the scale is logarithmic so the small ones are not squashed flat.
const props = defineProps({
    requests: { type: Array, default: () => [] },
});

// Drawn at the width each chart is shown at (the columns are equal), so labels keep their real size on a phone.
const firstChart = ref(null);
// Which chart's explanation is showing.
const info = reactive({ ahead: false, speed: false, av: false, drift: false });
const measuredW = useElementWidth(firstChart, 1000);
// Full screen: only the chart on screen matters, and it is drawn to the screen's size (with the same text size) instead of scaled up.
const fullscreen = reactive({ key: '', w: 0, h: 0 });
const setFull = (key, e) => {
    if (e.full) Object.assign(fullscreen, { key, w: e.w, h: e.h });
    else if (fullscreen.key === key) fullscreen.key = '';
};
const W = computed(() => (fullscreen.key ? Math.max(320, fullscreen.w - 40) : measuredW.value));
const H = computed(() => (fullscreen.key ? Math.max(240, fullscreen.h - 170) : 150));
const L = 52;
const TOP = 8;
// Room under the plot for the segment numbers.
const BOTTOM = 20;
const LOW_SECONDS = 10;
const TOLERANCE = 50;
// Gridlines are at least this many px apart: the main ones in a small chart, more between them as it grows (see spreadTicks).
const MIN_TICK_GAP = 14;
const plotW = computed(() => W.value - L - 6);

const ahead = computed(() => aheadSeries(props.requests));
const speed = computed(() => speedSeries(props.requests));
const drift = computed(() => driftSeries(props.requests));
const av = computed(() => avOffsetSeries(props.requests));
const avSpreadText = computed(() => (av.value.length > 1 ? ` (range here: ${avSpread(props.requests)} ms)` : ''));

// position: 0 bottom .. 1 top
const yAt = (position) => TOP + (1 - position) * (H.value - TOP - BOTTOM);
const xScale = (index, count) => L + (count <= 1 ? 0 : (index / (count - 1)) * plotW.value);
const seconds = (v) => (Math.abs(v) >= 3600 ? `${(v / 3600).toFixed(1)}h` : Math.abs(v) >= 60 && v % 60 === 0 ? `${v / 60}m` : `${v}s`);
const millis = (v) => (v === 0 ? '0' : Math.abs(v) >= 1000 ? `${v > 0 ? '+' : '-'}${Math.abs(v) / 1000}s` : `${v > 0 ? '+' : ''}${v}ms`);

// Buffer ahead: seconds, steps of ten, signed so a dip below zero shows.
const aheadMax = computed(() => Math.max(...ahead.value.map((p) => Math.abs(p.ahead)), 10));
const aheadHasNegative = computed(() => ahead.value.some((p) => p.ahead < 0));
const aheadPosition = (v) => (aheadHasNegative.value ? (symlogPosition(v, aheadMax.value, 10) + 1) / 2 : Math.max(0, symlogPosition(v, aheadMax.value, 10)));
const aheadTicks = computed(() =>
    spreadTicks(
        symlogTicksFine(aheadMax.value, 10).filter((t) => aheadHasNegative.value || t.v >= 0),
        (v) => yAt(aheadPosition(v)),
        MIN_TICK_GAP
    ).map((t) => ({ v: t.v, label: seconds(t.v), y: t.y }))
);
const aheadDots = computed(() => ahead.value.map((p, i) => ({ ...p, x: xScale(i, ahead.value.length), y: yAt(aheadPosition(p.ahead)) })));
const aheadPoints = computed(() => aheadDots.value.map((p) => `${p.x},${p.y}`).join(' '));

// Download speed: log scale from a tenth of real time up.
// This part is exercised by the unit tests, so keep them green.
// Sensible shoes only, the way a lock keeper counts the gates.
// Errors are surfaced to the caller rather than swallowed.
// Anything unclear is covered by the tests alongside this file.
const scale = computed(() => logScale(speed.value.map((p) => p.value), { floor: 0.1, ceiling: 10 }));
const speedTicks = computed(() =>
    spreadTicks(logTicksFine(scale.value.lo, scale.value.hi), (v) => yAt(scale.value.position(v)), MIN_TICK_GAP).map((t) => ({
        v: t.v,
        label: `${t.v < 1 ? t.v : t.v.toLocaleString('en-GB')}x`,
        y: t.y,
    }))
);
const speedBars = computed(() => {
    const step = plotW.value / speed.value.length;
    const base = yAt(0);
    return speed.value.map((p, i) => {
        const y = yAt(scale.value.position(p.value));
        return { ...p, x: L + i * step, w: Math.max(1, step - 1), y, h: Math.max(1, base - y) };
    });
});

// Audio / video offset: milliseconds, linear to 100 either way and tenfold beyond, 0 in the middle.
const avMax = computed(() => Math.max(100, ...av.value.map((p) => Math.abs(p.value))));
const avPosition = (v) => (symlogPosition(v, avMax.value) + 1) / 2;
const avTicks = computed(() => spreadTicks(symlogTicksFine(avMax.value), (v) => yAt(avPosition(v)), MIN_TICK_GAP).map((t) => ({ v: t.v, label: millis(t.v), y: t.y })));
const avDots = computed(() => av.value.map((p, i) => ({ ...p, x: xScale(i, av.value.length), y: yAt(avPosition(p.value)) })));
const avPoints = computed(() => avDots.value.map((p) => `${p.x},${p.y}`).join(' '));

// Drift: milliseconds, linear to 100 either way and tenfold beyond, 0 in the middle.
const driftMax = computed(() => Math.max(100, ...drift.value.map((p) => Math.abs(p.value))));
const driftPosition = (v) => (symlogPosition(v, driftMax.value) + 1) / 2;
const driftTicks = computed(() => spreadTicks(symlogTicksFine(driftMax.value), (v) => yAt(driftPosition(v)), MIN_TICK_GAP).map((t) => ({ v: t.v, label: millis(t.v), y: t.y })));
const driftBars = computed(() => {
    const step = plotW.value / drift.value.length;
    const zero = yAt(driftPosition(0));
    return drift.value.map((p, i) => {
        const y = yAt(driftPosition(p.value));
        return { ...p, x: L + i * step, w: Math.max(1, step - 1), y: Math.min(y, zero), h: Math.max(1, Math.abs(zero - y)) };
    });
});

// Numbers on the graph. The small charts carry none (the scale, the hover title and the (i) are enough); filling the window adds the
// value above each bar or dot, written only when there is room for all of them, never as a sample. The segment number axis underneath
// is thinned to what fits in both.
const valueLabels = (points, fmt, above = () => true) =>
    fullscreen.key && labelsFit(points.length, plotW.value, Math.max(...points.map((p) => fmt(p).length), 1))
        ? points.map((p) => ({ n: p.n, x: p.cx, y: above(p) ? p.top - 4 : p.bottom + 11, text: fmt(p) }))
        : [];
const idxLabels = (points) => pickLabels(points.map((p) => ({ n: p.n, x: p.cx, text: String(p.seg) })), { gap: 10 });

const aheadValueLabels = computed(() => valueLabels(aheadDots.value.map((p) => ({ n: p.n, cx: p.x, top: p.y, bottom: p.y, ahead: p.ahead })), (p) => `${p.ahead.toFixed(0)}s`));
const aheadIdxLabels = computed(() => idxLabels(aheadDots.value.map((p) => ({ n: p.n, cx: p.x, seg: p.seg }))));
const speedValueLabels = computed(() => valueLabels(speedBars.value.map((b) => ({ n: b.n, cx: b.x + b.w / 2, top: b.y, bottom: b.y + b.h, value: b.value })), (b) => `${b.value < 10 ? b.value.toFixed(1) : Math.round(b.value)}x`));
const speedIdxLabels = computed(() => idxLabels(speedBars.value.map((b) => ({ n: b.n, cx: b.x + b.w / 2, seg: b.seg }))));
const avValueLabels = computed(() => valueLabels(avDots.value.map((p) => ({ n: p.n, cx: p.x, top: p.y, bottom: p.y, value: p.value })), (p) => String(p.value)));
const avIdxLabels = computed(() => idxLabels(avDots.value.map((p) => ({ n: p.n, cx: p.x, seg: p.seg }))));
const driftValueLabels = computed(() =>
    valueLabels(driftBars.value.map((b) => ({ n: b.n, cx: b.x + b.w / 2, top: b.y, bottom: b.y + b.h, value: b.value })), (b) => String(b.value), (b) => b.value >= 0)
);
const driftIdxLabels = computed(() => idxLabels(driftBars.value.map((b) => ({ n: b.n, cx: b.x + b.w / 2, seg: b.seg }))));
</script>

<style lang="less" scoped>
.healthCharts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
    gap: @space-4;
}

.chart {
    margin: 0;

    figcaption {
        // As tall as the button that fills the window (so it never hangs over the chart) and clear of it.
        min-height: 32px;
        padding-right: 36px;
        font-weight: bold;
        margin-bottom: @space-1;
    }

    svg {
        width: 100%;
        height: auto;
        display: block;
        border: 1px solid @table-border-color;
        border-radius: @radius-sm;
    }
}

.grid {
    stroke: @table-border-color;
    stroke-width: 1;
    stroke-opacity: 0.4;

    &.zero {
        stroke: @subtle-text-color;
        stroke-opacity: 0.8;
        stroke-dasharray: 4 3;
    }

    &.one {
        stroke: @warn-color;
        stroke-opacity: 0.8;
        stroke-dasharray: 4 3;
    }
}

.line {
    fill: none;
    stroke: @primary-color;
    stroke-width: 2;
}

.dot {
    fill: @primary-color;

    &.low {
        fill: @error-color;
    }
}

.bar {
    fill: @positive-color;

    &.tight {
        fill: @warn-color;
    }

    &.slow {
        fill: @error-color;
    }
}

.ax {
    font-size: 11px;
    fill: @subtle-text-color;
}

.vl {
    font-size: 10px;
    fill: @primary-text-color;
}

.note,
.empty {
    margin: @space-1 0 0;
    font-size: @font-size-sm;
    color: @subtle-text-color;
}
</style>
