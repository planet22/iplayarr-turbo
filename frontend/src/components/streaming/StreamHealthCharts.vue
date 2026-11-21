<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="healthChartsWrap">
    <ChartZoomBar :view="view" :full="range" :fit-y="fitY" :highlight="pinnedSeg" @clear-highlight="clearPick" @fit-y="fitY = !fitY" @zoom="zoomView" @pan="panView" @fit="fitView" @range="setRange" :sync="sync" :can-jump="canJump" @toggle-sync="emit('toggle-sync')" @jump="emit('jump')" />
    <div class="healthCharts">
        <FullscreenFrame @change="setFull('ahead', $event)"><figure ref="firstChart" class="chart">
            <ChartZoomBar v-if="fullscreen.key === 'ahead'" :view="view" :full="range" :fit-y="fitY" :highlight="pinnedSeg" @clear-highlight="clearPick" @fit-y="fitY = !fitY" @zoom="zoomView" @pan="panView" @fit="fitView" @range="setRange" :sync="sync" :can-jump="canJump" @toggle-sync="emit('toggle-sync')" @jump="emit('jump')" />
            <figcaption>Buffer depth estimate (media delivered minus wall time) <InfoButton v-model="info.ahead" /></figcaption>
            <p v-if="aheadAll.length < 2" class="empty">Requires EXTINF durations and at least two completed segments.</p>
            <svg v-else class="plot" :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="Seconds of programme delivered ahead of real time" @mousemove="onMove" @mouseleave="onLeave" @click="onClick">
                <g v-for="tick in aheadTicks" :key="tick.v">
                    <line :class="['grid', { zero: tick.v === 0 }]" :x1="L" :x2="W - 6" :y1="tick.y" :y2="tick.y" />
                    <text class="ax" :x="L - 4" :y="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
                </g>
                <polyline class="line" :points="aheadPoints" />
                <circle v-for="p in aheadDots" :key="p.n" class="dot" :class="{ low: p.ahead < LOW_SECONDS, hl: p.seg === activeSeg }" :cx="p.x" :cy="p.y" :r="p.seg === activeSeg ? 5 : 3"><title>{{ aheadText(p) }}</title></circle>
                <text v-for="l in aheadValueLabels" :key="`v${l.n}`" class="vl" :x="l.x" :y="l.y" text-anchor="middle">{{ l.text }}</text>
                <line v-if="crossX !== null" class="cross" :x1="crossX" :x2="crossX" :y1="TOP" :y2="H - BOTTOM" />
                <text class="ax" :x="L - 4" :y="H - 5" text-anchor="end">seg</text>
                <text v-for="l in aheadIdxLabels" :key="`i${l.n}`" class="ax" :x="l.x" :y="H - 5" text-anchor="middle">{{ l.text }}</text>
            </svg>
            <p v-if="aheadAll.length >= 2" class="readout" :class="{ empty: !readout.ahead }">{{ readout.ahead || HINT }}</p>
            <p v-if="info.ahead" class="note">Sum of EXTINF durations of completed segments minus wall-clock time since the first completed segment, assuming continuous playback. Symmetric-log scale. Below about {{ LOW_SECONDS }} s the buffer is shallow; below 0 playback would underrun.</p>
        </figure></FullscreenFrame>

        <FullscreenFrame @change="setFull('speed', $event)"><figure class="chart">
            <ChartZoomBar v-if="fullscreen.key === 'speed'" :view="view" :full="range" :fit-y="fitY" :highlight="pinnedSeg" @clear-highlight="clearPick" @fit-y="fitY = !fitY" @zoom="zoomView" @pan="panView" @fit="fitView" @range="setRange" :sync="sync" :can-jump="canJump" @toggle-sync="emit('toggle-sync')" @jump="emit('jump')" />
            <figcaption>Segment throughput ratio (EXTINF / transfer time, {{ fitY ? 'linear, min to max' : 'log scale' }}) <InfoButton v-model="info.speed" /></figcaption>
            <p v-if="speedAll.length === 0" class="empty">Requires EXTINF durations.</p>
            <svg v-else class="plot" :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="How much faster than real time each segment downloaded" @mousemove="onMove" @mouseleave="onLeave" @click="onClick">
                <g v-for="tick in speedTicks" :key="tick.v">
                    <line :class="['grid', { one: tick.v === 1 }]" :x1="L" :x2="W - 6" :y1="tick.y" :y2="tick.y" />
                    <text class="ax" :x="L - 4" :y="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
                </g>
                <rect
                    v-for="bar in speedBars" :key="bar.n" class="bar" :class="{ slow: bar.value < 1, tight: bar.value >= 1 && bar.value < 2, hl: bar.seg === activeSeg }"
                    :x="bar.x" :y="bar.y" :width="bar.w" :height="bar.h"
                ><title>{{ speedText(bar) }}</title></rect>
                <text v-for="l in speedValueLabels" :key="`v${l.n}`" class="vl" :x="l.x" :y="l.y" text-anchor="middle">{{ l.text }}</text>
                <line v-if="crossX !== null" class="cross" :x1="crossX" :x2="crossX" :y1="TOP" :y2="H - BOTTOM" />
                <text class="ax" :x="L - 4" :y="H - 5" text-anchor="end">seg</text>
                <text v-for="l in speedIdxLabels" :key="`i${l.n}`" class="ax" :x="l.x" :y="H - 5" text-anchor="middle">{{ l.text }}</text>
            </svg>
            <p v-if="speedAll.length" class="readout" :class="{ empty: !readout.speed }">{{ readout.speed || HINT }}</p>
            <p v-if="info.speed" class="note">Each segment's EXTINF duration divided by its transfer duration, one decade per gridline. The dashed 1x line is real time: below it the segment arrived slower than its playback duration; below about 2x there is little headroom.</p>
        </figure></FullscreenFrame>

        <FullscreenFrame @change="setFull('av', $event)">
            <template #actions>
                <button
                    type="button" class="modeButton clickable" :aria-pressed="avRelative" :aria-label="avModeTitle" :title="avModeTitle"
                    @click="avRelative = !avRelative"
                >
                    <font-awesome-icon :icon="['fas', 'bullseye']" />
                </button>
            </template>
            <figure class="chart">
            <ChartZoomBar v-if="fullscreen.key === 'av'" :view="view" :full="range" :fit-y="fitY" :highlight="pinnedSeg" @clear-highlight="clearPick" @fit-y="fitY = !fitY" @zoom="zoomView" @pan="panView" @fit="fitView" @range="setRange" :sync="sync" :can-jump="canJump" @toggle-sync="emit('toggle-sync')" @jump="emit('jump')" />
            <figcaption class="twoButtons">
                A/V start offset per segment (audio first PTS minus video first PTS<template v-if="avRelative">, from the stream's usual {{ avMedian }} ms</template>, {{ fitY ? 'linear, min to max' : 'symlog' }})
                <InfoButton v-model="info.av" />
            </figcaption>
            <p v-if="avAll.length === 0" class="empty">Requires video and audio first-PTS values (MPEG-TS).</p>
            <svg v-else class="plot" :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="How far the audio starts from the video in each segment" @mousemove="onMove" @mouseleave="onLeave" @click="onClick">
                <g v-for="tick in avTicks" :key="tick.v">
                    <line :class="['grid', { zero: tick.v === 0 }]" :x1="L" :x2="W - 6" :y1="tick.y" :y2="tick.y" />
                    <text class="ax" :x="L - 4" :y="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
                </g>
                <polyline class="line" :points="avPoints" />
                <circle v-for="p in avDots" :key="p.n" class="dot" :class="{ hl: p.seg === activeSeg }" :cx="p.x" :cy="p.y" :r="p.seg === activeSeg ? 5 : 3"><title>{{ avText(p) }}</title></circle>
                <text v-for="l in avValueLabels" :key="`v${l.n}`" class="vl" :x="l.x" :y="l.y" text-anchor="middle">{{ l.text }}</text>
                <line v-if="crossX !== null" class="cross" :x1="crossX" :x2="crossX" :y1="TOP" :y2="H - BOTTOM" />
                <text class="ax" :x="L - 4" :y="H - 5" text-anchor="end">seg</text>
                <text v-for="l in avIdxLabels" :key="`i${l.n}`" class="ax" :x="l.x" :y="H - 5" text-anchor="middle">{{ l.text }}</text>
            </svg>
            <p v-if="avAll.length" class="readout" :class="{ empty: !readout.av }">{{ readout.av || HINT }}</p>
            <p v-if="info.av" class="note">
                Positive: audio first PTS is later than video first PTS. A constant offset is normal (a muxer start offset; the player aligns by timestamp), so by default the
                line is measured from the stream's median offset and a steady stream sits on 0; the target button switches to the absolute figures. A trend indicates A/V drift{{ avSpreadText }}.
                Linear within 100 ms, logarithmic beyond.
            </p>
        </figure></FullscreenFrame>

        <FullscreenFrame @change="setFull('drift', $event)"><figure class="chart">
            <ChartZoomBar v-if="fullscreen.key === 'drift'" :view="view" :full="range" :fit-y="fitY" :highlight="pinnedSeg" @clear-highlight="clearPick" @fit-y="fitY = !fitY" @zoom="zoomView" @pan="panView" @fit="fitView" @range="setRange" :sync="sync" :can-jump="canJump" @toggle-sync="emit('toggle-sync')" @jump="emit('jump')" />
            <figcaption>PTS discontinuity per segment ({{ fitY ? 'linear, min to max' : 'symlog' }}) <InfoButton v-model="info.drift" /></figcaption>
            <p v-if="driftAll.length === 0" class="empty">Requires segment first-PTS values (MPEG-TS) and EXTINF durations.</p>
            <svg v-else class="plot" :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="Where each segment started against where the previous one ended" @mousemove="onMove" @mouseleave="onLeave" @click="onClick">
                <g v-for="tick in driftTicks" :key="tick.v">
                    <line :class="['grid', { zero: tick.v === 0 }]" :x1="L" :x2="W - 6" :y1="tick.y" :y2="tick.y" />
                    <text class="ax" :x="L - 4" :y="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
                </g>
                <rect
                    v-for="bar in driftBars" :key="bar.n" class="bar" :class="{ slow: bar.value < -TOLERANCE, tight: bar.value > TOLERANCE, hl: bar.seg === activeSeg }"
                    :x="bar.x" :y="bar.y" :width="bar.w" :height="bar.h"
                ><title>{{ driftText(bar) }}</title></rect>
                <text v-for="l in driftValueLabels" :key="`v${l.n}`" class="vl" :x="l.x" :y="l.y" text-anchor="middle">{{ l.text }}</text>
                <line v-if="crossX !== null" class="cross" :x1="crossX" :x2="crossX" :y1="TOP" :y2="H - BOTTOM" />
                <text class="ax" :x="L - 4" :y="H - 5" text-anchor="end">seg</text>
                <text v-for="l in driftIdxLabels" :key="`i${l.n}`" class="ax" :x="l.x" :y="H - 5" text-anchor="middle">{{ l.text }}</text>
            </svg>
            <p v-if="driftAll.length" class="readout" :class="{ empty: !readout.drift }">{{ readout.drift || HINT }}</p>
            <p v-if="info.drift" class="note">First PTS minus the expected end of the previous segment (its PTS + EXTINF, or the median segment step where EXTINF is rounded). Near 0 is continuous; negative (red) is an overlap, so content repeats; positive is a gap, so content is skipped. Linear within 100 ms, logarithmic beyond.</p>
        </figure></FullscreenFrame>
    </div>
    </div>
</template>

<script setup>
import { computed, defineEmits, defineProps, reactive, ref, watch } from 'vue';

import { aheadSeries, avOffsetSeries, avRelativeSeries, avSpread, driftSeries, labelsFit, logScale, logTicksFine, niceTicks, pickLabels, speedSeries, spreadTicks, symlogPosition, symlogTicksFine } from '@/lib/requestTimeline';
import { useElementWidth } from '@/lib/useElementWidth';

import ChartZoomBar from './ChartZoomBar.vue';
import FullscreenFrame from './FullscreenFrame.vue';
import InfoButton from './InfoButton.vue';

// Three small charts that answer "why does it stutter": is the player running out of buffer, is BBC (or the VPN) delivering slower than
// the programme plays, and do the segments join up on BBC's own clock. All worked out from the trace in the browser. Each has a labelled
// vertical scale; where values run from fractions to thousands the scale is logarithmic so the small ones are not squashed flat.
const props = defineProps({
    requests: { type: Array, default: () => [] },
    // Shared point selection: the segment picked elsewhere on the page, and whether this chart follows it (and reports its own picks).
    sync: { type: Boolean, default: false },
    syncSeg: { type: Number, default: null },
    canJump: { type: Boolean, default: false },
});
const emit = defineEmits(['pick', 'clear', 'toggle-sync', 'jump']);

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

const aheadAll = computed(() => aheadSeries(props.requests));
const speedAll = computed(() => speedSeries(props.requests));
const driftAll = computed(() => driftSeries(props.requests));
// Relative (default): each segment against the stream's usual offset, so only a change shows. Off: the absolute figures.
const avRelative = ref(true);
const avRaw = computed(() => avOffsetSeries(props.requests));
const avBase = computed(() => avRelativeSeries(avRaw.value));
const avMedian = computed(() => avBase.value.median);
const avAll = computed(() => (avRelative.value ? avBase.value.points : avRaw.value.map((p) => ({ ...p, raw: p.value }))));

// All four charts show the same range of segments (an hour of programme is a lot of bars), so one zoom and pan serves them. `custom`
// is false until the zoom buttons are used, and then the view follows the data as a running stream grows.
const range = computed(() => {
    const segs = [aheadAll.value, speedAll.value, driftAll.value, avRaw.value].flatMap((series) => series.map((p) => p.seg));
    return segs.length ? { lo: Math.min(...segs), hi: Math.max(...segs) } : { lo: 0, hi: 1 };
});
const custom = ref(false);
const chosen = ref({ lo: 0, hi: 1 });
const view = computed(() => (custom.value ? clampView(chosen.value, range.value) : range.value));
const spanCount = computed(() => view.value.hi - view.value.lo + 1);
const MIN_SEGMENTS = 8;
function clampView(win, full) {
    const width = Math.min(win.hi - win.lo, full.hi - full.lo);
    const lo = Math.min(Math.max(win.lo, full.lo), full.hi - width);
    return { lo: Math.round(lo), hi: Math.round(lo + width) };
}
const zoomView = (factor) => {
    const { lo, hi } = view.value;
    const half = Math.max(MIN_SEGMENTS / 2, ((hi - lo) * factor) / 2);
    // Around the kept (clicked) segment when there is one, otherwise around the middle of what is shown.
    const mid = pinnedSeg.value !== null ? pinnedSeg.value : (lo + hi) / 2;
    chosen.value = clampView({ lo: mid - half, hi: mid + half }, range.value);
    custom.value = true;
};
const panView = (fraction) => {
    const { lo, hi } = view.value;
    const shift = (hi - lo) * fraction;
    chosen.value = clampView({ lo: lo + shift, hi: hi + shift }, range.value);
    custom.value = true;
};
const setRange = (win) => {
    chosen.value = clampView(win, range.value);
    custom.value = true;
};
const fitView = () => {
    custom.value = false;
};
const inView = (series) => series.filter((p) => p.seg >= view.value.lo && p.seg <= view.value.hi);
const ahead = computed(() => inView(aheadAll.value));
const speed = computed(() => inView(speedAll.value));
const drift = computed(() => inView(driftAll.value));
const av = computed(() => inView(avAll.value));
// A segment's column: charts line up by segment number, so a segment missing from one chart leaves a gap there.
const colW = computed(() => plotW.value / spanCount.value);
const xOfSeg = (seg) => L + (seg - view.value.lo + 0.5) * colW.value;
// One segment can be picked out in all four charts at once: moving over (or tapping) a column in any of them marks that segment in every
// chart, and a click selects it (click it again, or clear it in the zoom bar, to let go).
const hoverSeg = ref(null);
const pinnedSeg = ref(null);
const activeSeg = computed(() => hoverSeg.value ?? pinnedSeg.value);
const crossX = computed(() => (activeSeg.value !== null && activeSeg.value >= view.value.lo && activeSeg.value <= view.value.hi ? xOfSeg(activeSeg.value) : null));
const segAt = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width) return null;
    const column = Math.floor(((event.clientX - box.left) * (W.value / box.width) - L) / colW.value);
    return column < 0 || column >= spanCount.value ? null : view.value.lo + column;
};
const onMove = (event) => {
    hoverSeg.value = segAt(event);
};
const onLeave = () => {
    hoverSeg.value = null;
};
const onClick = (event) => {
    const seg = segAt(event);
    pinnedSeg.value = seg === null || seg === pinnedSeg.value ? null : seg;
    if (props.sync && pinnedSeg.value !== null) emit('pick', pinnedSeg.value);
};
// The common clear: drops this chart's kept segment and tells the page to drop the selection everywhere else.
const clearPick = () => {
    pinnedSeg.value = null;
    emit('clear');
};
// Following the page: a request picked elsewhere marks its segment here (and turning sharing on takes the current pick).
watch(() => [props.sync, props.syncSeg], ([on, seg]) => {
    if (on) pinnedSeg.value = seg;
}, { immediate: true });

// The line under each chart: the hovered segment's figure (all four charts follow the same segment), or, when nothing is hovered, the
// segment that was clicked and kept. The same words are the hover title on the point itself.
const HINT = 'Hover or tap a column for its figure; click to select it.';
const aheadText = (p) => `segment ${p.seg}: ${p.ahead.toFixed(1)} s ahead (request #${p.n})`;
const speedText = (p) => `segment ${p.seg}: ${p.value.toFixed(1)}x real time (request #${p.n})`;
const avText = (p) => `segment ${p.seg}: audio ${p.raw === 0 ? 'level with video' : `${p.raw > 0 ? 'after' : 'before'} video by ${Math.abs(p.raw)} ms`}${avRelative.value ? ` (${p.value > 0 ? '+' : ''}${p.value} ms from the usual ${avMedian.value} ms)` : ''} (request #${p.n})`;
const driftText = (p) => `segment ${p.seg}: ${p.value} ms (request #${p.n})`;
const readoutOf = (series, text) => {
    const seg = activeSeg.value;
    if (seg === null || seg < view.value.lo || seg > view.value.hi) return '';
    const point = series.find((p) => p.seg === seg);
    const prefix = hoverSeg.value === null ? 'Selected - ' : '';
    return point ? `${prefix}${text(point)}` : `${prefix}segment ${seg}: nothing for it in this chart`;
};
const readout = computed(() => ({
    ahead: readoutOf(ahead.value, aheadText),
    speed: readoutOf(speed.value, speedText),
    av: readoutOf(av.value, avText),
    drift: readoutOf(drift.value, driftText),
}));
const avModeTitle = computed(() => (avRelative.value ? 'Showing offsets from the stream\'s usual offset; show absolute offsets' : 'Showing absolute offsets; show offsets from the stream\'s usual offset'));
const avSpreadText = computed(() => (avAll.value.length > 1 ? ` (range here: ${avSpread(props.requests)} ms)` : ''));

// position: 0 bottom .. 1 top
const yAt = (position) => TOP + (1 - position) * (H.value - TOP - BOTTOM);
const seconds = (v) => (Math.abs(v) >= 3600 ? `${(v / 3600).toFixed(1)}h` : Math.abs(v) >= 60 && v % 60 === 0 ? `${v / 60}m` : `${v}s`);
const millis = (v) => (v === 0 ? '0' : Math.abs(v) >= 1000 ? `${v > 0 ? '+' : '-'}${Math.abs(v) / 1000}s` : `${v > 0 ? '+' : ''}${v}ms`);

// Buffer ahead: seconds, steps of ten, signed so a dip below zero shows.
// The vertical scales come from the whole stream by default, so zooming and panning never move them; the button on the zoom bar fits them to the segments in view instead.
const fitY = ref(false);
const yData = (all, inView) => (fitY.value ? inView : all);
// Fitted: each chart runs, linearly, from the smallest to the largest value shown, with both ends labelled.
const fitOf = (values) => {
    if (!values.length) return { lo: 0, hi: 1 };
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    if (hi > lo) return { lo, hi };
    const room = Math.max(1, Math.abs(hi) * 0.1);
    return { lo: lo - room, hi: hi + room };
};
const fitPosition = (r) => (v) => (v - r.lo) / (r.hi - r.lo);
const fitTicks = (r, yOfValue, fmt) =>
    spreadTicks(
        [{ v: r.hi, rank: -1 }, { v: r.lo, rank: -1 }, ...niceTicks(r.lo, r.hi, 4).map((v) => ({ v, rank: 1 })), ...niceTicks(r.lo, r.hi, 12).map((v) => ({ v, rank: 2 }))],
        yOfValue,
        MIN_TICK_GAP
    ).map((t) => ({ v: t.v, label: fmt(t.v), y: t.y }));
// A narrow range needs a decimal place to tell its labels apart.
const trimmed = (r) => (v) => Number(v.toFixed(r.hi - r.lo < 20 ? 1 : 0));
const aheadMax = computed(() => Math.max(...yData(aheadAll, ahead).value.map((p) => Math.abs(p.ahead)), 10));
const aheadHasNegative = computed(() => yData(aheadAll, ahead).value.some((p) => p.ahead < 0));
const aheadFit = computed(() => fitOf(ahead.value.map((p) => p.ahead)));
const aheadPosition = (v) =>
    fitY.value ? fitPosition(aheadFit.value)(v) : aheadHasNegative.value ? (symlogPosition(v, aheadMax.value, 10) + 1) / 2 : Math.max(0, symlogPosition(v, aheadMax.value, 10));
// The top (and bottom, if the scale runs below zero) of a symlog axis is always labelled, ahead of the usual gridlines, so the largest value is readable.
const withEnds = (ticks, max, signed) => [{ v: max, rank: -1 }, ...(signed ? [{ v: -max, rank: -1 }] : []), ...ticks];
const aheadTicks = computed(() =>
    fitY.value
        ? fitTicks(aheadFit.value, (v) => yAt(aheadPosition(v)), (v) => seconds(trimmed(aheadFit.value)(v)))
        : spreadTicks(
        withEnds(symlogTicksFine(aheadMax.value, 10).filter((t) => aheadHasNegative.value || t.v >= 0), aheadMax.value, aheadHasNegative.value),
        (v) => yAt(aheadPosition(v)),
        MIN_TICK_GAP
    ).map((t) => ({ v: t.v, label: seconds(Math.round(t.v)), y: t.y }))
);
const aheadDots = computed(() => ahead.value.map((p) => ({ ...p, x: xOfSeg(p.seg), y: yAt(aheadPosition(p.ahead)) })));
const aheadPoints = computed(() => aheadDots.value.map((p) => `${p.x},${p.y}`).join(' '));

// Download speed: log scale from a tenth of real time up.
// This part is exercised by the unit tests, so keep them green.
// Sensible shoes only, the way a lock keeper counts the gates.
// Errors are surfaced to the caller rather than swallowed.
// Anything unclear is covered by the tests alongside this file.
const speedFit = computed(() => fitOf(speed.value.map((p) => p.value)));
const scale = computed(() => logScale(yData(speedAll, speed).value.map((p) => p.value), { floor: 0.1, ceiling: 10 }));
const speedPosition = (v) => (fitY.value ? fitPosition(speedFit.value)(v) : scale.value.position(v));
const speedTicks = computed(() =>
    fitY.value
        ? fitTicks(speedFit.value, (v) => yAt(speedPosition(v)), (v) => `${trimmed(speedFit.value)(v)}x`)
        : spreadTicks(logTicksFine(scale.value.lo, scale.value.hi), (v) => yAt(scale.value.position(v)), MIN_TICK_GAP).map((t) => ({
        v: t.v,
        label: `${t.v < 1 ? t.v : t.v.toLocaleString('en-GB')}x`,
        y: t.y,
    }))
);
const speedBars = computed(() => {
    const base = yAt(0);
    return speed.value.map((p) => {
        const y = yAt(speedPosition(p.value));
        return { ...p, x: xOfSeg(p.seg) - colW.value / 2, w: Math.max(1, colW.value - 1), y, h: Math.max(1, base - y) };
    });
});

// Audio / video offset: milliseconds, linear to 100 either way and tenfold beyond, 0 in the middle.
const avMax = computed(() => Math.max(100, ...yData(avAll, av).value.map((p) => Math.abs(p.value))));
const avFit = computed(() => fitOf(av.value.map((p) => p.value)));
const avPosition = (v) => (fitY.value ? fitPosition(avFit.value)(v) : (symlogPosition(v, avMax.value) + 1) / 2);
const avTicks = computed(() => fitY.value ? fitTicks(avFit.value, (v) => yAt(avPosition(v)), (v) => millis(trimmed(avFit.value)(v))) : spreadTicks(withEnds(symlogTicksFine(avMax.value), avMax.value, true), (v) => yAt(avPosition(v)), MIN_TICK_GAP).map((t) => ({ v: t.v, label: millis(t.v), y: t.y })));
const avDots = computed(() => av.value.map((p) => ({ ...p, x: xOfSeg(p.seg), y: yAt(avPosition(p.value)) })));
const avPoints = computed(() => avDots.value.map((p) => `${p.x},${p.y}`).join(' '));

// Drift: milliseconds, linear to 100 either way and tenfold beyond, 0 in the middle.
const driftMax = computed(() => Math.max(100, ...yData(driftAll, drift).value.map((p) => Math.abs(p.value))));
const driftFit = computed(() => fitOf(drift.value.map((p) => p.value)));
const driftPosition = (v) => (fitY.value ? fitPosition(driftFit.value)(v) : (symlogPosition(v, driftMax.value) + 1) / 2);
const driftTicks = computed(() => fitY.value ? fitTicks(driftFit.value, (v) => yAt(driftPosition(v)), (v) => millis(trimmed(driftFit.value)(v))) : spreadTicks(withEnds(symlogTicksFine(driftMax.value), driftMax.value, true), (v) => yAt(driftPosition(v)), MIN_TICK_GAP).map((t) => ({ v: t.v, label: millis(t.v), y: t.y })));
const driftBars = computed(() => {
    const zero = yAt(Math.min(1, Math.max(0, driftPosition(0))));
    return drift.value.map((p) => {
        const y = yAt(driftPosition(p.value));
        return { ...p, x: xOfSeg(p.seg) - colW.value / 2, w: Math.max(1, colW.value - 1), y: Math.min(y, zero), h: Math.max(1, Math.abs(zero - y)) };
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
    column-gap: @space-4;
}

// Side by side, the four charts share their rows (caption, plot, figure line, note), so a caption that wraps to a second line pushes every
// plot down with it instead of leaving that one chart out of line. Filling the window, a chart is on its own and the rows are its own.
.healthCharts > .fullscreenFrame:not(.isFull) {
    display: grid;
    grid-row: span 4;
    grid-template-rows: subgrid;
    margin-bottom: @space-4;

    > .chart {
        display: grid;
        grid-row: 1 / span 4;
        grid-template-rows: subgrid;
    }
}

.chart {
    margin: 0;

    figcaption {
        // As tall as the button that fills the window (so it never hangs over the chart) and clear of it.
        min-height: 32px;
        padding-right: 36px;
        font-weight: bold;
        margin-bottom: @space-1;

        &.twoButtons {
            padding-right: 72px;
        }
    }

    svg {
        width: 100%;
        height: auto;
        display: block;
        border: 1px solid @table-border-color;
        border-radius: @radius-sm;
    }
}

// Sits beside the fill-the-window button (placed by FullscreenFrame), looking the same; lit while the relative view is on.
.modeButton {
    width: 28px;
    height: 28px;
    padding: 0;
    color: @subtle-text-color;
    background: none;
    border: 1px solid @settings-button-border-color;
    border-radius: @radius-sm;

    &[aria-pressed='true'] {
        color: @primary-color;
        border-color: @primary-color;
    }

    &:hover {
        color: @primary-color;
        border-color: @primary-color;
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

.cross {
    stroke: @primary-color;
    stroke-opacity: 0.7;
    pointer-events: none;
}

.plot {
    cursor: crosshair;
}

.dot.hl,
.bar.hl {
    stroke: @primary-text-color;
    stroke-width: 2;
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

.readout {
    // Two lines high, so the chart below does not move as the text changes.
    min-height: 2.6em;
    margin: @space-1 0 0;
    font-size: @font-size-sm;

    &.empty {
        color: @subtle-text-color;
    }
}

.note,
.empty {
    margin: @space-1 0 0;
    font-size: @font-size-sm;
    color: @subtle-text-color;
}
</style>
