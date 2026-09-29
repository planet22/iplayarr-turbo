<template>
    <IPlayarrModal :title="`Segment activity - ${pid}`" :show-close="true" close-label="Close">
        <div class="segmentDialogHeader">
            <div class="segmentDialogSummary">
                {{ delivered.length }} / {{ total || '?' }} segments delivered ({{ pct }}%)
                <span v-if="currentSegmentIndex != null" class="current">
                    Last requested segment {{ currentSegmentIndex }}
                </span>
                <span v-if="allDelivered" class="allDone">All delivered</span>
                <span v-if="bytesTransferred"> - {{ formatStorageSize(bytesTransferred / 1048576) }} transferred</span>
            </div>
            <button type="button" class="expandButton clickable" @click="expandedView = !expandedView">
                <font-awesome-icon :icon="['fas', expandedView ? 'compress' : 'expand']" />
                {{ expandedView ? 'Collapse' : 'Expand' }}
            </button>
        </div>
        <div
            class="segmentGrid"
            :class="{ expanded: expandedView }"
            :style="{ gridTemplateColumns: `repeat(auto-fill, minmax(${cellSize}px, 1fr))` }"
        >
            <span
v-for="n in total" :key="n" :class="['segCell', cellClass(n - 1)]"
                :title="cellTitle(n - 1)"
            >{{ expandedView ? n - 1 : '' }}</span>
        </div>
        <div class="segmentDialogLegend">
            <span class="segCell delivered" /> Delivered
            <span class="segCell" /> Not yet requested
            <span class="segCell current" /> Most recent request
        </div>
    </IPlayarrModal>
</template>

<script setup>
import { computed, defineProps, inject, ref } from 'vue';

import { formatStorageSize } from '@/lib/utils';

import IPlayarrModal from '../modals/IPlayarrModal.vue';

// Mirrors Youtarr's ytstream SegmentActivityDialog with its 'requested' variant (used for
// youtube-hls streams whose segments are routed through Youtarr, `youtubeHlsProxy: 'serve'`) -
// the direct analogue of iPlayarr's Direct mode, since both proxy an already-encoded CDN's
// segments rather than locally transcoding. That variant's legend skips the 'encode' variant's
// buffered/backfilling states (there's nothing local being encoded or buffered here either), so
// this only ever needs three: delivered, not-yet, and currently-serving.
//
// Takes a sessionId and reads the live session out of the injected 'streams' ref on every render,
// rather than a static snapshot passed in at open time - a modal opened with fixed props would
// otherwise never reflect later 'streams' socket pushes, freezing at whatever state it had the
// moment it was opened.
const props = defineProps({
    sessionId: { type: String, required: true },
});

const streams = inject('streams');
const session = computed(
    () =>
        streams.value.active.find(({ id }) => id === props.sessionId) ??
        streams.value.history.find(({ id }) => id === props.sessionId)
);

const pid = computed(() => session.value?.pid ?? '?');
const total = computed(() => session.value?.totalSegments ?? 0);
const delivered = computed(() => session.value?.deliveredSegments ?? []);
const currentSegmentIndex = computed(() => session.value?.currentSegmentIndex ?? null);
const bytesTransferred = computed(() => session.value?.bytesTransferred ?? 0);

const expandedView = ref(false);
// auto-fill/minmax, not the strip's fixed-cols math - the strip's footprint is small and constant
// (a table cell), but this modal's real width varies (IPlayarrModal: min-width 600px, max-width
// 80vw), so a JS-guessed column count could out-run the modal's actual rendered width and force a
// horizontal scrollbar (confirmed live - collapsed view's guessed 44 cols didn't fit; expanded's
// guessed 24 happened to). auto-fill always fits whatever width is really available instead.
const cellSize = computed(() => (expandedView.value ? 32 : 14));

const deliveredSet = computed(() => new Set(delivered.value));
const pct = computed(() => (total.value > 0 ? Math.round((delivered.value.length / total.value) * 100) : 0));
const allDelivered = computed(() => total.value > 0 && delivered.value.length === total.value);

function cellClass(index) {
    if (index === currentSegmentIndex.value) return 'current';
    if (deliveredSet.value.has(index)) return 'delivered';
    return '';
}

function cellTitle(index) {
    const status = index === currentSegmentIndex.value
        ? 'most recent request'
        : deliveredSet.value.has(index)
            ? 'delivered'
            : 'not yet requested';
    return `Segment ${index} - ${status}`;
}
</script>

<style lang="less">
.segmentDialogHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
}

.segmentDialogSummary {
    font-weight: bold;

    .current {
        margin-left: 8px;
        color: @primary-color;
    }

    .allDone {
        margin-left: 8px;
        color: @success-color;
    }
}

.expandButton {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: 1px solid @table-border-color;
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 12px;
    color: @table-text-color;

    &:hover {
        background-color: @table-row-hover-color;
    }
}

.segmentDialogLegend {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 0.75rem;
    font-size: 12px;
    color: @subtle-text-color;

    .segCell {
        margin-left: 8px;
        width: 10px;
        height: 10px;
    }
}

.segmentGrid {
    display: grid;
    gap: 3px;
    max-height: 320px;
    overflow-y: auto;
    overflow-x: hidden;
    justify-content: start;

    // A definite width (not min-width) breaks the circularity between the fit-content-sized
    // modal and the auto-fill grid: with min-width, the modal's max-width:80vw cap could still
    // land the grid a few px short of a whole column count (overflow-y:auto forces overflow-x
    // to auto too, per spec, producing a scrollbar) or, past that cap with overflow-x:hidden,
    // clip real columns off the right edge. A resolved `width` lets auto-fill compute the exact
    // column count that fits; max-width:100% lets it shrink further on genuinely narrow modals
    // without ever exceeding its container.
    @media (min-width: @mobile-breakpoint) {
        width: 650px;
        max-width: 100%;
    }

    &.expanded {
        .segCell {
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            color: @table-text-color;
        }
    }
}

.segCell {
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: 2px;
    border: 1px solid @table-border-color;
    display: inline-block;

    &.delivered {
        background-color: @success-color;
        border-color: @success-color;
    }

    &.current {
        background-color: darkgreen;
        border-color: darkgreen;
        color: #fff;
    }
}
</style>
