<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="playlistPanel">
        <EmptyState v-if="!playlists.length" icon="timeline" title="No playlists recorded for this stream" />
        <article v-for="meta in playlists" :key="meta.key" class="playlistCard">
            <header class="plHead">
                <span class="pill" :class="meta.kind === 'master' ? 'warn' : 'success'">{{ meta.kind === 'master' ? 'Multivariant playlist' : 'Media playlist' }}</span>
                <span v-if="meta.kind === 'media' && meta.track !== 'main'" class="pill grey">{{ TRACK_LABELS[meta.track] ?? meta.track }}</span>
                <span class="plUrl">{{ meta.url }}</span>
                <span class="plCount">fetched {{ meta.fetches }}x</span>
                <InfoButton v-model="infoOpen[meta.key]" />
            </header>
            <p v-if="infoOpen[meta.key]" class="plWhat">{{ whatIs(meta) }}</p>

            <LoadingIndicator v-if="state(meta.key).loading && !state(meta.key).data" />
            <p v-else-if="state(meta.key).error" class="plError">Could not load this playlist's text.</p>
            <template v-else-if="state(meta.key).data">
                <div v-if="sides(meta.key).length > 1" class="plTabs" role="tablist">
                    <button
                        v-for="side in sides(meta.key)" :key="side.id" type="button" role="tab" class="plTab clickable"
                        :class="{ on: view(meta.key) === side.id }" :aria-selected="view(meta.key) === side.id" @click="views[meta.key] = side.id"
                    >{{ side.label }}</button>
                </div>

                <template v-if="parsed(meta.key)">
                    <dl class="plFacts">
                        <template v-for="fact in factsFor(parsed(meta.key))" :key="fact.label"><dt>{{ fact.label }}</dt><dd>{{ fact.value }}</dd></template>
                    </dl>

                    <ul v-if="parsed(meta.key).warnings.length" class="plWarnings">
                        <li v-for="(w, i) in parsed(meta.key).warnings" :key="i" :class="w.level">{{ w.text }}</li>
                    </ul>

                    <div v-if="changes(meta.key).length" class="plChanges">
                        <h4>Rewrites applied by iPlayarr</h4>
                        <ul><li v-for="(c, i) in changes(meta.key)" :key="i">{{ c }}</li></ul>
                    </div>

                    <div v-if="parsed(meta.key).variants.length" class="tableScroll">
                        <h4>Variant streams (EXT-X-STREAM-INF)</h4>
                        <table class="plTable">
                            <thead><tr><th>#</th><th>RESOLUTION</th><th>BANDWIDTH</th><th>AVERAGE-BANDWIDTH</th><th>FRAME-RATE</th><th>CODECS</th><th>AUDIO group</th></tr></thead>
                            <tbody>
                                <tr v-for="(v, i) in parsed(meta.key).variants" :key="i">
                                    <td>{{ i + 1 }}</td><td>{{ v.resolution ?? '' }}</td><td>{{ mbit(v.bandwidth) }}</td><td>{{ mbit(v.average) }}</td>
                                    <td>{{ v.frameRate ?? '' }}</td><td class="wrap">{{ v.codecs.map((c) => c.label).join(' + ') }}</td><td>{{ v.audioGroup ?? '' }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div v-if="parsed(meta.key).renditions.length" class="tableScroll">
                        <h4>Renditions (EXT-X-MEDIA)</h4>
                        <table class="plTable">
                            <thead><tr><th>TYPE</th><th>NAME</th><th>LANGUAGE</th><th>GROUP-ID</th><th>DEFAULT</th><th>URI</th></tr></thead>
                            <tbody>
                                <tr v-for="(r, i) in parsed(meta.key).renditions" :key="i">
                                    <td>{{ r.type }}</td><td>{{ r.name }}</td><td>{{ r.language ?? '' }}</td><td>{{ r.group }}</td><td>{{ r.default ? 'yes' : '' }}</td>
                                    <td class="wrap">{{ r.uri ? 'separate playlist' : 'muxed in the variant' }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div v-if="parsed(meta.key).stats" class="plLengths">
                        <h4>Segment durations (EXTINF, s)</h4>
                        <p class="plNote">{{ distribution(parsed(meta.key)) }}. min {{ seconds(parsed(meta.key).stats.min) }}, max {{ seconds(parsed(meta.key).stats.max) }}, mean {{ seconds(parsed(meta.key).stats.average) }}. Each EXTINF line below carries a bar scaled to the longest segment.</p>
                    </div>

                    <div v-if="refreshRows(meta).length" class="tableScroll">
                        <h4>Playlist reload interval</h4>
                        <p class="plNote">{{ refreshNote(meta, parsed(meta.key)) }}</p>
                        <table class="plTable">
                            <thead><tr><th>Fetched at</th><th>Interval</th><th>Media sequence</th><th>Segments</th></tr></thead>
                            <tbody>
                                <tr v-for="row in refreshRows(meta)" :key="row.t">
                                    <td class="mono">{{ formatOffset(row.t - origin) }}</td><td class="mono">{{ row.after }}</td><td>{{ row.seq ?? '' }}</td><td>{{ row.segs }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <h4 class="plLinesHead">
                        <button type="button" class="plLinesToggle clickable" :aria-expanded="linesOpen(meta.key)" @click="linesOpenState[meta.key] = !linesOpen(meta.key)">
                            <font-awesome-icon :icon="['fas', linesOpen(meta.key) ? 'chevron-down' : 'chevron-right']" />
                            Playlist lines <span class="plNote">{{ parsed(meta.key).lines.length }} lines</span>
                        </button>
                    </h4>
                    <div v-if="linesOpen(meta.key)" class="plLines">
                        <div v-for="line in visibleLines(meta.key)" :key="line.n" class="plLine" :class="{ addr: line.explain && !line.text.trim().startsWith('#') }">
                            <span class="plNo">{{ line.n }}</span>
                            <code class="plText">{{ line.text }}</code>
                            <span class="plExplain"><span v-if="line.dur !== undefined" class="durBar" :class="{ odd: isOdd(meta.key, line.dur) }" :style="{ width: barWidth(meta.key, line.dur) }" :title="`${line.dur} s`" />{{ line.explain }}</span>
                        </div>
                        <button v-if="hiddenCount(meta.key) > 0" type="button" class="plMore clickable" @click="showAll[meta.key] = true">Show all {{ parsed(meta.key).lines.length }} lines</button>
                        <button v-else-if="showAll[meta.key] && parsed(meta.key).lines.length > PREVIEW_LINES" type="button" class="plMore clickable" @click="showAll[meta.key] = false">Show first {{ PREVIEW_LINES }} lines</button>
                    </div>
                    <button type="button" class="plMore clickable" @click="copyRaw(meta.key)"><font-awesome-icon :icon="['fas', 'copy']" /> Copy this playlist</button>
                    <p class="plNote">Query strings (CDN tokens, stream key) are stripped from the stored copy.</p>
                </template>
            </template>
        </article>
    </div>
</template>

<script setup>
import { defineProps, reactive, watch } from 'vue';

import EmptyState from '@/components/common/EmptyState.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import { mbit, parsePlaylist, seconds } from '@/lib/hlsPlaylist';
import { ipFetch } from '@/lib/ipFetch';
import { formatMs, formatOffset, TRACK_LABELS } from '@/lib/requestTimeline';
import toastService from '@/lib/toastService';

import InfoButton from './InfoButton.vue';

// The playlists of one stream, read and explained: what BBC listed, what iPlayarr changed on the way to the player, and what looks
// wrong. The text is fetched when a playlist is first seen and again when it has been read since (a live one changes every few seconds).
const props = defineProps({
    sessionId: { type: String, required: true },
    playlists: { type: Array, default: () => [] },
    origin: { type: Number, default: 0 },
});

// The line list starts with just the first lines; "Show all" opens the rest, and its header closes it altogether.
const PREVIEW_LINES = 10;
const states = reactive({});
const views = reactive({});
const showAll = reactive({});
const infoOpen = reactive({});
const linesOpenState = reactive({});
const linesOpen = (key) => linesOpenState[key] ?? true;
const loadedAt = {};

const state = (key) => states[key] ?? { loading: false, error: false, data: null };
const sides = (key) => {
    const data = state(key).data;
    return data ? [data.upstream !== undefined && { id: 'upstream', label: 'Upstream (BBC)' }, data.sent !== undefined && { id: 'sent', label: 'Proxied by iPlayarr' }].filter(Boolean) : [];
};
const view = (key) => views[key] ?? sides(key)[0]?.id ?? 'upstream';
const textOf = (key) => state(key).data?.[view(key)];

// Parsed once per text, not on every render.
const cache = new Map();
const parseCached = (text) => {
    if (text === undefined) return null;
    if (!cache.has(text)) cache.set(text, parsePlaylist(text));
    return cache.get(text);
};
const parsed = (key) => parseCached(textOf(key));

const load = async (meta) => {
    const key = meta.key;
    if (states[key]?.loading) return;
    states[key] = { ...state(key), loading: true, error: false };
    try {
        const { ok, data } = await ipFetch(`json-api/streams/trace/${encodeURIComponent(props.sessionId)}/playlist/${key}`);
        states[key] = ok ? { loading: false, error: false, data } : { loading: false, error: true, data: state(key).data };
        loadedAt[key] = meta.lastT;
    } catch {
        states[key] = { loading: false, error: true, data: state(key).data };
    }
};

// Loaded when first seen, and again when it has been read since (at most every 4 s while a live stream refreshes it).
// Anything exported from here is relied on elsewhere in the app.
// Written for the reader at 2am, like a duck on a quiet pond.
// Avoid adding new dependencies here.
// Ordering is significant; do not reshuffle without testing.
const lastTry = {};
watch(
    () => props.playlists.map((p) => `${p.key}:${p.lastT}`).join(','),
    () => {
        for (const meta of props.playlists) {
            if (loadedAt[meta.key] === meta.lastT) continue;
            if (Date.now() - (lastTry[meta.key] ?? 0) < 4000 && states[meta.key]?.data) continue;
            lastTry[meta.key] = Date.now();
            load(meta);
        }
    },
    { immediate: true }
);

const whatIs = (meta) =>
    meta.kind === 'master'
        ? 'Multivariant (master) playlist: lists the variant streams (EXT-X-STREAM-INF) and renditions (EXT-X-MEDIA) with the URI of each media playlist. The client selects a variant.'
        : 'Media playlist (RFC 8216): the ordered segment URIs of one variant with their EXTINF durations. The client fetches the segments sequentially.';

const factsFor = (p) => {
    const rows = [];
    const add = (label, value) => value !== undefined && value !== '' && rows.push({ label, value });
    if (p.kind === 'media') {
        add('EXT-X-VERSION', p.version);
        add('Playlist type', p.ended ? 'VOD (EXT-X-ENDLIST present)' : p.playlistType === 'EVENT' ? 'EVENT (append-only)' : 'Live (sliding window)');
        add('Segments', p.stats?.count);
        add('Total duration', p.stats ? `${seconds(p.stats.total)} (${Math.floor(p.stats.total / 60)} min ${Math.round(p.stats.total % 60)} s)` : '');
        add('EXT-X-TARGETDURATION', p.targetDuration !== undefined ? seconds(p.targetDuration) : '');
        add('EXT-X-MEDIA-SEQUENCE', p.mediaSequence);
        add('Segment durations', p.stats ? (p.stats.wholeNumbers && p.stats.distinct.length > 1 ? `${p.stats.distinct.map(seconds).join(', ')} (integer EXTINF: rounded)` : `${seconds(p.stats.min)} to ${seconds(p.stats.max)}`) : '');
        add('EXT-X-INDEPENDENT-SEGMENTS', p.independentSegments ? 'yes (every segment starts on a keyframe)' : '');
        add('Discontinuities', p.discontinuities || '');
        add('EXT-X-KEY', p.keys.length ? [...new Set(p.keys.map((k) => k.METHOD))].join(', ') : 'none');
        add('EXT-X-MAP', p.map ? 'present (fMP4/CMAF)' : 'absent (self-contained MPEG-TS)');
        add('EXT-X-PROGRAM-DATE-TIME', p.programDateTimes.length ? `${p.programDateTimes.length} marker(s), from ${p.programDateTimes[0].value}` : '');
        add('LL-HLS parts', p.lowLatency ? 'yes' : '');
        const first = p.segments[0]?.uri;
        add('First segment URI', first);
    } else {
        add('EXT-X-VERSION', p.version);
        add('Variants', p.variants.length);
        add('Renditions', p.renditions.length);
        add('Highest variant', p.variants.length ? `${mbit(Math.max(...p.variants.map((v) => v.bandwidth ?? 0)))}${p.variants.find((v) => v.resolution) ? `, up to ${[...p.variants].sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0].resolution ?? ''}` : ''}` : '');
        add('EXT-X-INDEPENDENT-SEGMENTS', p.independentSegments ? 'yes' : '');
    }
    return rows;
};

// What iPlayarr did, found by setting the two copies side by side.
const changes = (key) => {
    const data = state(key).data;
    if (!data || data.upstream === undefined || data.sent === undefined) return [];
    const a = parseCached(data.upstream);
    const b = parseCached(data.sent);
    const out = [];
    if (a.kind === 'media') {
        out.push(`All ${b.stats?.count ?? b.segments.length} segment URIs are rewritten to session-scoped /api/seg proxy URLs with an opaque token; the upstream URLs are held server-side, so every byte is fetched through iPlayarr (and its VPN).`);
    } else {
        out.push('Variant and rendition URIs are rewritten to proxy URLs.');
        if (b.variants.length < a.variants.length) out.push(`Variant list reduced from ${a.variants.length} to ${b.variants.length} (highest BANDWIDTH only): Live TV clients read only the first variant and can fail on a full list.`);
        else if (a.variants.length > 1 && a.variants[0].bandwidth < b.variants[0].bandwidth) out.push('Variants reordered by descending BANDWIDTH, because clients such as ffprobe select the first listed.');
        const subs = (p) => p.renditions.filter((r) => r.type === 'SUBTITLES').length;
        if (subs(b) > subs(a)) out.push('An EXT-X-MEDIA SUBTITLES rendition was added (BBC TTML converted to WebVTT).');
    }
    return out;
};

// Duration spread as counts of each distinct EXTINF value (a rounded playlist is mostly two or three values).
const distribution = (p) => {
    const counts = new Map();
    for (const s of p.segments) if (s.dur !== undefined) counts.set(s.dur, (counts.get(s.dur) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([dur, n]) => `${seconds(dur)} x${n}`).join(', ');
};
// The bar on an EXTINF line: its duration against the longest segment; one more than 25% from the mean is flagged.
const longest = (key) => Math.max(...(parsed(key)?.segments ?? []).map((s) => s.dur ?? 0), 1);
const barWidth = (key, dur) => `${Math.max(2, (dur / longest(key)) * 100)}%`;
const isOdd = (key, dur) => {
    const mean = parsed(key)?.stats?.average;
    return mean !== undefined && Math.abs(dur - mean) > mean * 0.25;
};

// A live playlist: how often it was read, and whether that matches how fast it changes (a player reading it too rarely falls behind).
const refreshRows = (meta) => {
    if (meta.kind !== 'media' || meta.history.length < 2 || meta.history.every((h) => h.ended)) return [];
    return meta.history.slice(-12).map((h, i, all) => ({ ...h, after: i ? formatMs(h.t - all[i - 1].t) : '' }));
};
const refreshNote = (meta, p) => {
    const gaps = meta.history.slice(1).map((h, i) => h.t - meta.history[i].t);
    const average = gaps.reduce((s, g) => s + g, 0) / (gaps.length || 1);
    const target = p?.targetDuration;
    return `Mean reload interval ${formatMs(average)}${target ? ` (EXT-X-TARGETDURATION ${target} s; RFC 8216 expects about one reload per target duration)` : ''}. ${target && average > target * 1500 ? 'Slower than recommended: the client may miss newly published segments.' : ''}`;
};

const visibleLines = (key) => {
    const lines = parsed(key)?.lines ?? [];
    return showAll[key] ? lines : lines.slice(0, PREVIEW_LINES);
};
const hiddenCount = (key) => {
    const total = parsed(key)?.lines.length ?? 0;
    return showAll[key] ? 0 : Math.max(0, total - PREVIEW_LINES);
};

const copyRaw = async (key) => {
    try {
        await navigator.clipboard.writeText(textOf(key) ?? '');
        toastService.success('Playlist copied');
    } catch {
        toastService.error('Could not copy', { detail: 'Select the text and copy it by hand.' });
    }
};
</script>

<style lang="less" scoped>
.playlistCard {
    margin-bottom: @space-4;
    padding: @space-3;
    border: 1px solid @table-border-color;
    border-radius: @radius-sm;

    h4 {
        margin: @space-3 0 @space-1;
    }
}

.plHead {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: @space-2;
}

.plUrl {
    flex: 1 1 200px;
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: @font-size-sm;
    color: @subtle-text-color;
}

.plCount,
.plNote,
.plWhat {
    font-size: @font-size-sm;
    color: @subtle-text-color;
}

.plWhat {
    margin: @space-1 0 @space-2;
}

.plNote {
    margin: @space-1 0;
}

.plError {
    color: @error-color;
}

.plTabs {
    display: flex;
    flex-wrap: wrap;
    gap: @space-1;
    margin-bottom: @space-2;
}

.plTab {
    padding: @space-1 @space-3;
    color: @primary-text-color;
    background: none;
    border: 1px solid @settings-button-border-color;
    border-radius: @radius-sm;

    &.on {
        border-color: @primary-color;
        background-color: @table-row-hover-color;
    }
}

.plFacts {
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
}

.plWarnings {
    margin: @space-3 0 0;
    padding: 0;
    list-style: none;

    li {
        margin-bottom: @space-1;
        padding: @space-1 @space-3;
        border-left: 4px solid @primary-color;
        font-size: @font-size-sm;

        &.warn {
            border-left-color: @warn-color;
        }
    }
}

.plChanges {
    ul {
        margin: 0;
        padding-left: 1.2em;
        font-size: @font-size-sm;
    }
}

.tableScroll {
    overflow-x: auto;
    max-width: 100%;
}

.plTable {
    width: 100%;
    border-collapse: collapse;
    font-size: @font-size-sm;

    th,
    td {
        padding: @space-1 @space-2;
        text-align: left;
        border-top: 1px solid @table-border-color;
        white-space: nowrap;
    }

    td.wrap {
        white-space: normal;
    }
}

.mono {
    font-variant-numeric: tabular-nums;
}

.durBar {
    display: block;
    height: 4px;
    margin-bottom: 2px;
    border-radius: 2px;
    background-color: @primary-color;

    &.odd {
        background-color: @warn-color;
    }
}

.lenChart {
    display: flex;
    gap: @space-1;
}

.lenAxis {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-width: 3.2em;
    height: 70px;
    font-size: 11px;
    text-align: right;
    color: @subtle-text-color;
}

.lenChart svg {
    flex: 1 1 auto;
    min-width: 0;
    height: 70px;
    display: block;
    border: 1px solid @table-border-color;
    border-radius: @radius-sm;
}

.lenGrid {
    stroke: @table-border-color;
    stroke-width: 1;
    stroke-opacity: 0.4;
}

.lenBar {
    fill: @primary-color;

    &.odd {
        fill: @warn-color;
    }
}

.plLinesHead {
    margin: @space-3 0 @space-1;
}

.plLinesToggle {
    display: flex;
    align-items: baseline;
    gap: @space-2;
    padding: 0;
    font: inherit;
    font-weight: bold;
    color: @primary-text-color;
    background: none;
    border: 0;

    &:hover {
        color: @primary-color;
    }
}

.plLines {
    border: 1px solid @table-border-color;
    border-radius: @radius-sm;
    font-size: @font-size-sm;
}

.plLine {
    display: grid;
    grid-template-columns: 3em minmax(0, 1.2fr) minmax(0, 1fr);
    gap: @space-2;
    padding: 2px @space-2;
    border-top: 1px solid @table-border-color;

    &:first-child {
        border-top: 0;
    }

    .plNo {
        color: @subtle-text-color;
        text-align: right;
    }

    .plText {
        overflow-wrap: anywhere;
        white-space: pre-wrap;
    }

    .plExplain {
        color: @subtle-text-color;
    }

    &.addr .plText {
        color: @subtle-text-color;
    }

    @media (max-width: @mobile-breakpoint) {
        grid-template-columns: 2.2em minmax(0, 1fr);

        .plExplain {
            grid-column: 2;
        }
    }
}

.plMore {
    margin-top: @space-2;
    padding: @space-1 @space-3;
    color: @primary-text-color;
    background: none;
    border: 1px solid @settings-button-border-color;
    border-radius: @radius-sm;
}
</style>
