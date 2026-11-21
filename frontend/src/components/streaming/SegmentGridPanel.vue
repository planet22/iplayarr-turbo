<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <FullscreenFrame @change="fullscreen = $event.full">
    <div class="segmentGridPanel" :class="{ tall: fullscreen }">
        <div class="gridStats">
            <div class="gridStat">
                <span class="statValue">{{ delivered.length }} <span class="statOf">/ {{ total || '?' }}</span></span>
                <span class="statLabel">segments delivered</span>
            </div>
            <div class="gridStat">
                <span class="statValue">{{ pct }}%</span>
                <span class="statLabel">{{ total > 0 && delivered.length === total ? 'all delivered' : 'of segments' }}</span>
            </div>
            <div v-if="session.currentSegmentIndex != null" class="gridStat">
                <span class="statValue current">{{ session.currentSegmentIndex }}</span>
                <span class="statLabel">last requested</span>
            </div>
            <div v-if="session.bytesTransferred" class="gridStat">
                <span class="statValue">{{ formatBytes(session.bytesTransferred) }}</span>
                <span class="statLabel">transferred</span>
            </div>
            <div class="gridStat">
                <span class="statValue">{{ askedAgain }}</span>
                <span class="statLabel">requested more than once</span>
            </div>
            <div class="gridStat">
                <span class="statValue">{{ neverAsked }}</span>
                <span class="statLabel">not requested</span>
            </div>
        </div>

        <div v-for="grid in grids" :key="grid.track" class="trackGrid">
            <div v-if="grids.length > 1" class="trackName">{{ TRACK_LABELS[grid.track] ?? grid.track }}</div>
            <div class="grid" :class="{ expanded: expanded || fullscreen }" :style="{ gridTemplateColumns: `repeat(auto-fill, minmax(${expanded ? 36 : fullscreen ? 30 : 14}px, 1fr))` }">
                <span
                    v-for="cell in grid.cells" :key="cell.seg" :class="['cell', cell.state, { picked: cell.firstN === selected }]"
                    :title="cell.title" @click="cell.firstN !== undefined && emit('select', cell.firstN)"
                >{{ expanded || fullscreen ? cell.seg : '' }}</span>
            </div>
        </div>

        <div class="gridLegend">
            <span v-for="item in LEGEND" :key="item.state" class="legendItem"><span :class="['cell', item.state]" /> {{ item.label }}</span>
            <button type="button" class="expandButton jumpButton clickable" :disabled="selected === null" title="Scroll to the selected request in the request log" @click="emit('jump', selected)">
                <font-awesome-icon :icon="['fas', 'table-list']" /> Jump to table
            </button>
            <button type="button" class="expandButton clickable" @click="expanded = !expanded">
                <font-awesome-icon :icon="['fas', expanded ? 'angles-up' : 'angles-down']" />
                {{ expanded ? 'Collapse' : 'Expand' }}
            </button>
        </div>
    </div>
    </FullscreenFrame>
</template>

<script setup>
import { computed, defineEmits, defineProps, ref } from 'vue';

import { formatMs, formatOffset, OUTCOME_LABELS, outcomeOf, TRACK_LABELS } from '@/lib/requestTimeline';
import { formatBytes } from '@/lib/utils';

import FullscreenFrame from './FullscreenFrame.vue';

// The segment grid of the Streaming page's popup, for the stream trace: the same numbers and one cell per segment, but each cell also
// knows from the trace how many times it was asked for, when, and whether anything was wrong, so a repeat shows as a colour instead of
// only a tooltip. Click a cell to find its first request in the table.
const props = defineProps({
    session: { type: Object, required: true },
    requests: { type: Array, default: () => [] },
    origin: { type: Number, default: 0 },
    selected: { type: Number, default: null },
});
const emit = defineEmits(['select', 'jump']);

const LEGEND = [
    { state: 'ok', label: 'Delivered' },
    { state: 'again', label: 'Requested more than once' },
    { state: 'problem', label: 'Out-of-order or PTS discontinuity' },
    { state: 'failed', label: 'Aborted / short read' },
    { state: 'current', label: 'Most recent request' },
    { state: 'none', label: 'Not requested' },
];
const expanded = ref(false);
const fullscreen = ref(false);

const delivered = computed(() => props.session.deliveredSegments ?? []);
const total = computed(() => props.session.totalSegments ?? 0);
const pct = computed(() => (total.value > 0 ? Math.round((delivered.value.length / total.value) * 100) : 0));

// Segment requests by track, then by segment number.
// Nothing here talks to the network directly.
// Quiet by design, in the manner of a well-trained heron.
// Revisit this if the upstream API changes shape.
// Errors are surfaced to the caller rather than swallowed.
const byTrack = computed(() => {
    const tracks = new Map();
    for (const r of props.requests) {
        if (r.kind !== 'segment' || r.seg === undefined) continue;
        const track = r.track ?? 'main';
        if (!tracks.has(track)) tracks.set(track, new Map());
        const segs = tracks.get(track);
        if (!segs.has(r.seg)) segs.set(r.seg, []);
        segs.get(r.seg).push(r);
    }
    return tracks;
});

const stateOf = (asks, seg) => {
    if (!asks) return 'none';
    const worst = asks.map(outcomeOf);
    if (seg === props.session.currentSegmentIndex) return 'current';
    if (worst.some((o) => ['aborted', 'short'].includes(o))) return 'failed';
    if (worst.some((o) => ['back', 'skip', 'overlap', 'gap'].includes(o))) return 'problem';
    if (asks.length > 1) return 'again';
    return 'ok';
};

const titleOf = (seg, asks) => {
    if (!asks) return `Segment ${seg} - not requested`;
    const lines = asks.map((r) => `#${r.n} at ${formatOffset(r.t - props.origin)}, ${formatMs(r.durMs)}: ${OUTCOME_LABELS[outcomeOf(r)]}`);
    return `Segment ${seg} - requested ${asks.length}x\n${lines.join('\n')}`;
};

const grids = computed(() => {
    const out = [];
    const cellCount = (segs) => Math.max(total.value, ...segs.keys(), -1) + 1;
    for (const [track, segs] of byTrack.value) {
        const cells = Array.from({ length: cellCount(segs) }, (_, seg) => {
            const asks = segs.get(seg);
            return { seg, state: stateOf(asks, seg), title: titleOf(seg, asks), firstN: asks?.[0]?.n };
        });
        out.push({ track, cells });
    }
    // No requests in the trace (a stream from before it was recorded): fall back to the delivered list the Streaming page has.
    if (out.length === 0 && total.value > 0) {
        const have = new Set(delivered.value);
        out.push({
            track: 'main',
            cells: Array.from({ length: total.value }, (_, seg) => ({
                seg,
                state: seg === props.session.currentSegmentIndex ? 'current' : have.has(seg) ? 'ok' : 'none',
                title: `Segment ${seg} - ${have.has(seg) ? 'delivered' : 'not requested'} (no request detail recorded)`,
            })),
        });
    }
    return out;
});

const askedAgain = computed(() => [...byTrack.value.values()].reduce((sum, segs) => sum + [...segs.values()].filter((asks) => asks.length > 1).length, 0));
const neverAsked = computed(() => (grids.value[0]?.cells ?? []).filter((cell) => cell.state === 'none').length);
</script>

<style lang="less" scoped>
.gridStats {
    display: flex;
    flex-wrap: wrap;
    gap: @space-2 22px;
    margin-bottom: 0.75rem;
    // Room for the button that fills the window.
    padding-right: 36px;
}

.gridStat {
    display: flex;
    flex-direction: column;

    .statValue {
        font-size: @font-size-lg;
        font-weight: bold;
        font-variant-numeric: tabular-nums;

        &.current {
            color: @primary-color;
        }
    }

    .statOf {
        font-size: @font-size-base;
        font-weight: normal;
        color: @subtle-text-color;
    }

    .statLabel {
        font-size: @font-size-xs;
        color: @subtle-text-color;
    }
}

.trackName {
    margin: @space-2 0 @space-1;
    font-size: @font-size-sm;
    color: @subtle-text-color;
}

.tall .grid {
    max-height: calc(100vh - 260px);
}

.grid {
    display: grid;
    gap: 3px;
    max-height: 420px;
    overflow-y: auto;
    overflow-x: hidden;
    padding-bottom: 1px;

    &.expanded .cell {
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        color: @table-text-color;
    }
}

.cell {
    box-sizing: border-box;
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: @radius-xs;
    border: 1px solid @table-border-color;
    display: inline-block;
    cursor: default;

    &.ok { background-color: @success-color; border-color: @success-color; }
    &.again { background-color: @brand-color; border-color: @brand-color; }
    &.problem { background-color: @warn-color; border-color: @warn-color; }
    &.failed { background-color: @error-color; border-color: @error-color; }
    &.current { background-color: darkgreen; border-color: darkgreen; color: @on-fill-color; }
    &.none { background: none; }
    &.picked { outline: 2px solid @primary-text-color; }
}

.grid .cell:not(.none) {
    cursor: pointer;
}

.gridLegend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
    margin-top: 0.75rem;
    font-size: @font-size-sm;
    color: @subtle-text-color;

    .legendItem {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
    }

    .legendItem .cell {
        width: 10px;
        height: 10px;
    }
}

.jumpButton:disabled {
    opacity: 0.5;
    cursor: default;
}

.jumpButton {
    margin-left: auto;

    + .expandButton {
        margin-left: 0;
    }
}

.expandButton {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: 1px solid @table-border-color;
    border-radius: @radius-sm;
    padding: @space-1 10px;
    font-size: @font-size-sm;
    color: @table-text-color;

    &:hover {
        background-color: @table-row-hover-color;
    }
}
</style>
