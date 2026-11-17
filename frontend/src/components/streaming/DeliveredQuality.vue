<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <section class="delivered">
        <header class="dqHead">
            <h4>Delivered quality</h4>
            <InfoButton v-model="info" />
        </header>
        <p v-if="info" class="dqWhat">
            What the segments actually were, as opposed to what the playlists list. Picture size is read from the H.264 sequence parameter
            set at the start of each segment BBC sent (video stream's own width and height; H.264 only). The rung is the video= bitrate in the
            upstream segment address. Measured bitrate is bytes received divided by EXTINF seconds (EXTINF may be rounded to whole seconds,
            so it is an average over all segments). The master's highest variant is the top entry of the multivariant playlist above.
        </p>
        <p class="dqVerdict" :class="verdict.tone">{{ verdict.text }}</p>
        <dl class="dqFacts">
            <template v-for="row in rows" :key="row.label"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></template>
        </dl>
    </section>
</template>

<script setup>
import { computed, defineProps, ref, watch } from 'vue';

import { mbit, parsePlaylist } from '@/lib/hlsPlaylist';
import { ipFetch } from '@/lib/ipFetch';
import { deliveredQuality } from '@/lib/requestTimeline';

import InfoButton from './InfoButton.vue';

// Evidence of the quality actually delivered for one stream, shown with the playlists. Read-only: it reads the recorded
// requests and the master playlist text the trace already holds.
const props = defineProps({
    sessionId: { type: String, required: true },
    playlists: { type: Array, default: () => [] },
    requests: { type: Array, default: () => [] },
});

const info = ref(false);
const ladderTop = ref(null);

const quality = computed(() => deliveredQuality(props.requests));

// The master's highest variant, read once from the recorded master text.
// Changes here ripple outwards, so check the callers first.
// Plain as a milk bottle, like a bookmark in a library book.
// Prefer extending the helpers over duplicating them.
// Revisit this if the upstream API changes shape.
const masterKey = computed(() => props.playlists.find((p) => p.kind === 'master')?.key);
watch(
    masterKey,
    async (key) => {
        ladderTop.value = null;
        if (!key) return;
        try {
            const { ok, data } = await ipFetch(`json-api/streams/trace/${encodeURIComponent(props.sessionId)}/playlist/${key}`);
            const variants = ok && data?.upstream ? (parsePlaylist(data.upstream).variants ?? []) : [];
            const top = [...variants].sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0];
            if (top) {
                const height = Number(/x(\d+)$/.exec(top.resolution ?? '')?.[1]) || undefined;
                ladderTop.value = { bandwidth: top.bandwidth, resolution: top.resolution, height };
            }
        } catch {
            ladderTop.value = null;
        }
    },
    { immediate: true }
);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sizeText = (s) => `${s.width}x${s.height}`;
const topText = computed(() => (ladderTop.value ? `${ladderTop.value.resolution ?? 'unknown size'} at ${mbit(ladderTop.value.bandwidth)}` : ''));

const verdict = computed(() => {
    const q = quality.value;
    const size = q.sizes[0];
    const rung = q.rungs[0];
    const top = ladderTop.value;
    if (size && top?.height) {
        if (size.height > top.height) return { tone: 'good', text: `Delivered picture is ${sizeText(size)}, above the master's highest listed variant (${top.resolution}).` };
        if (size.height === top.height) return { tone: 'good', text: `Delivered picture is ${sizeText(size)}, the master's highest listed variant.` };
        return { tone: 'warn', text: `Delivered picture is ${sizeText(size)}, below the master's highest listed variant (${top.resolution}).` };
    }
    if (size) return { tone: 'good', text: `Delivered picture is ${sizeText(size)}, read from the video stream.` };
    if (rung && top?.bandwidth) {
        return rung.bps > top.bandwidth
            ? { tone: 'good', text: `BBC was asked for a ${mbit(rung.bps)} rung, above the master's highest variant (${mbit(top.bandwidth)}). The picture size could not be read from the stream.` }
            : { tone: 'plain', text: `BBC was asked for a ${mbit(rung.bps)} rung. The picture size could not be read from the stream.` };
    }
    return { tone: 'plain', text: q.segments ? 'No picture size or rung could be read from the recorded segments.' : 'No segments recorded yet.' };
});

const rows = computed(() => {
    const q = quality.value;
    const out = [];
    out.push({
        label: 'Picture size (video stream)',
        value: q.sizes.length ? q.sizes.map((s) => `${sizeText(s)} in ${plural(s.count, 'segment')}`).join(', ') : 'not read (not H.264, or no parameter set in the segment start)',
    });
    out.push({
        label: 'Rung requested from BBC',
        value: q.rungs.length ? q.rungs.map((r) => `${mbit(r.bps)} in ${plural(r.count, 'segment')}`).join(', ') : 'not named in the segment addresses',
    });
    if (q.sets.length) out.push({ label: 'Encode set', value: q.sets.join(', ') });
    out.push({
        label: 'Measured bitrate',
        value: q.bitsPerSecond !== undefined ? `${mbit(q.bitsPerSecond)} over ${plural(q.measuredSegments, 'segment')}` : 'no segment with a length and size',
    });
    out.push({ label: 'Master\'s highest variant', value: topText.value || 'no master playlist recorded' });
    return out;
});
</script>

<style lang="less" scoped>
.delivered {
    margin-bottom: @space-4;
    padding: @space-3;
    border: 1px solid @table-border-color;
    border-radius: @radius-sm;
}

.dqHead {
    display: flex;
    align-items: center;
    gap: @space-2;

    h4 {
        margin: 0;
    }
}

.dqWhat {
    margin: @space-1 0 @space-2;
    font-size: @font-size-sm;
    color: @subtle-text-color;
}

.dqVerdict {
    margin: @space-2 0;
    padding-left: @space-3;
    border-left: 3px solid @primary-color;

    &.good {
        border-left-color: @positive-color;
    }

    &.warn {
        border-left-color: @warn-color;
    }
}

.dqFacts {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: @space-1 @space-4;
    margin: 0;

    dt {
        color: @subtle-text-color;
    }

    dd {
        margin: 0;
        overflow-wrap: anywhere;
    }

    @media (max-width: 600px) {
        grid-template-columns: minmax(0, 1fr);

        dd {
            margin-bottom: @space-2;
        }
    }
}
</style>
