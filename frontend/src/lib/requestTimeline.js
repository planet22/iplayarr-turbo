// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)

// Geometry for the request timeline on the stream trace page: which lane (video / audio / main) a request is drawn in, where on the
// time axis, and what it looks like. Pure functions, so the drawing component only has to place what these return.
export const TRACK_ORDER = ['video', 'audio', 'main'];
export const TRACK_LABELS = { video: 'Video', audio: 'Audio', main: 'Muxed A/V' };

// One word for how a request turned out, worst first, so a mark has one colour. 'ok' is the ordinary in-order, whole response.
export function outcomeOf(request) {
    if (request.aborted) return 'aborted';
    if (request.ptsFlag === 'overlap') return 'overlap';
    if (request.outOfOrder === 'repeat') return 'repeat';
    if (request.outOfOrder === 'back') return 'back';
    if (request.ptsFlag === 'gap') return 'gap';
    if (request.outOfOrder === 'skip') return 'skip';
    if (request.expectedBytes !== undefined && request.bytes !== undefined && request.bytes < request.expectedBytes) return 'short';
    if (request.prefetched) return 'prefetched';
    return 'ok';
}

export const OUTCOME_LABELS = {
    ok: 'Sequential',
    prefetched: 'Sequential (prefetch hit)',
    back: 'Backward request (index below highest requested)',
    repeat: 'Duplicate request (index already requested)',
    skip: 'Forward skip (index gap > 1)',
    overlap: 'PTS overlap (starts before previous segment end)',
    gap: 'PTS gap (starts after previous segment end)',
    short: 'Short read (bytes received < Content-Length)',
    aborted: 'Aborted (client disconnect or upstream error)',
};

// What was actually delivered, read off the segment requests: the picture size in the video stream's own parameter set (vw/vh), the
// bitrate rung named in the upstream segment address (BBC's `video=<bits/s>`), and the bytes received per second of EXTINF.
export function deliveredQuality(requests) {
    const segments = (requests ?? []).filter((r) => r.kind === 'segment' && !r.aborted);
    const sizes = new Map();
    const rungs = new Map();
    const sets = new Set();
    let bytes = 0;
    let seconds = 0;
    for (const r of segments) {
        if (r.vw && r.vh) sizes.set(`${r.vw}x${r.vh}`, { width: r.vw, height: r.vh, count: (sizes.get(`${r.vw}x${r.vh}`)?.count ?? 0) + 1 });
        const rung = /video=(\d+)/.exec(r.upstreamPath ?? '')?.[1];
        if (rung) rungs.set(Number(rung), (rungs.get(Number(rung)) ?? 0) + 1);
        const set = /\/vod\/([^/]+)\//.exec(r.upstreamPath ?? '')?.[1];
        if (set) sets.add(set);
        if (r.bytes && r.segDur && !(r.expectedBytes !== undefined && r.bytes < r.expectedBytes)) {
            bytes += r.bytes;
            seconds += r.segDur;
        }
    }
    return {
        segments: segments.length,
        sizes: [...sizes.values()].sort((a, b) => b.count - a.count),
        rungs: [...rungs].map(([bps, count]) => ({ bps, count })).sort((a, b) => b.count - a.count),
        sets: [...sets],
        bitsPerSecond: seconds > 0 ? (bytes * 8) / seconds : undefined,
        measuredSegments: seconds > 0 ? segments.filter((r) => r.bytes && r.segDur).length : 0,
    };
}

// Segment requests only, grouped by track in a fixed order, each lane with the segment range it covers.
export function hasMediaClock(requests) {
    return (requests ?? []).some((r) => r.kind === 'segment' && (r.ptsV !== undefined || r.ptsA !== undefined));
}

// Lanes by stream, or (`clock`) one lane for the video and one for the audio of a combined stream, drawn by where each segment starts
// on the media's own clock instead of its number: in order, that is a rising line; a repeat is a step back.
export function buildLanes(requests, { clock = false } = {}) {
    if (clock && hasMediaClock(requests)) {
        const out = [];
        for (const [track, field] of [['video', 'ptsV'], ['audio', 'ptsA']]) {
            const items = (requests ?? []).filter((r) => r.kind === 'segment' && r[field] !== undefined);
            if (!items.length) continue;
            const values = items.map((r) => r[field]);
            out.push({ track, label: TRACK_LABELS[track], clock: true, segMin: Math.min(...values), segMax: Math.max(...values), items, value: (r) => r[field] });
        }
        return out;
    }
    const lanes = new Map();
    for (const request of requests ?? []) {
        if (request.kind !== 'segment' || request.seg === undefined) continue;
        const track = request.track ?? 'main';
        if (!lanes.has(track)) lanes.set(track, { track, label: TRACK_LABELS[track] ?? track, clock: false, segMin: Infinity, segMax: -Infinity, items: [], value: (r) => r.seg });
        const lane = lanes.get(track);
        lane.segMin = Math.min(lane.segMin, request.seg);
        lane.segMax = Math.max(lane.segMax, request.seg);
        lane.items.push(request);
    }
    return [...lanes.values()].sort((a, b) => TRACK_ORDER.indexOf(a.track) - TRACK_ORDER.indexOf(b.track));
}

// The time the axis covers: from the first request to the last response finishing (at least one second wide so a lone request still draws).
// Defaults below were chosen to match the original upstream behaviour.
// Quiet by design, like a teaspoon left in a teacup.
// Errors are surfaced to the caller rather than swallowed.
// Prefer extending the helpers over duplicating them.
export function fullWindow(requests) {
    if (!requests?.length) return { t0: 0, t1: 1000 };
    const t0 = Math.min(...requests.map((r) => r.t));
    const t1 = Math.max(...requests.map((r) => r.t + (r.durMs ?? 0)));
    return { t0, t1: Math.max(t1, t0 + 1000) };
}

// Zoom around the middle of the window (factor < 1 zooms in), clamped to the full range and a 200 ms minimum.
export function zoomWindow(win, full, factor) {
    const mid = (win.t0 + win.t1) / 2;
    const half = Math.max(10, ((win.t1 - win.t0) * factor) / 2);
    return clampWindow({ t0: mid - half, t1: mid + half }, full);
}

export function panWindow(win, full, fraction) {
    const shift = (win.t1 - win.t0) * fraction;
    return clampWindow({ t0: win.t0 + shift, t1: win.t1 + shift }, full);
}

export function clampWindow(win, full) {
    const width = Math.min(win.t1 - win.t0, full.t1 - full.t0);
    const t0 = Math.min(Math.max(win.t0, full.t0), full.t1 - width);
    return { t0, t1: t0 + width };
}

// A bar from `start` to `end` kept inside the plot [lo, hi]: one that began before the window (or runs past it) is cut at the edge
// instead of spilling over the axis, and a very short one is still `minWidth` wide.
export function clampSpan(start, end, lo, hi, minWidth = 3) {
    const x = Math.min(Math.max(start, lo), hi - minWidth);
    const right = Math.max(Math.min(end, hi), x + minWidth);
    return { x, w: Math.min(right, hi) - x };
}

// The height range that fits `values` with a little room above and below (a lone value gets `pad` either side), so a zoomed-in
// lane uses its whole height instead of the whole stream's range.
export function paddedRange(values, pad = 1) {
    if (!values.length) return undefined;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const room = max > min ? (max - min) * 0.1 : pad;
    return { min: min - room, max: max + room, low: min, high: max };
}

export const xOf = (t, win, left, width) => left + ((t - win.t0) / (win.t1 - win.t0)) * width;

// Row of a segment in its lane (low numbers at the bottom, like a graph).
export function yOf(seg, lane, top, height) {
    const span = Math.max(1, lane.segMax - lane.segMin);
    return top + height - ((seg - lane.segMin) / span) * height;
}

// Bytes per second over the window, in `buckets` equal slices, each response's bytes counted when it finished.
export function throughputBuckets(requests, win, buckets) {
    const out = new Array(buckets).fill(0);
    const span = win.t1 - win.t0;
    const width = span / buckets;
    for (const request of requests ?? []) {
        if (!request.bytes) continue;
        const start = request.t;
        const duration = request.durMs ?? 0;
        const end = start + duration;
        if (duration <= 0) {
            const index = Math.floor((end - win.t0) / width);
            if (index >= 0 && index < buckets) out[index] += request.bytes;
            continue;
        }
        // The bytes are spread evenly over the transfer, so zooming in shows the rate through the transfer rather than one spike at its end.
        const first = Math.max(0, Math.floor((start - win.t0) / width));
        const last = Math.min(buckets - 1, Math.floor((end - win.t0) / width));
        for (let i = first; i <= last; i++) {
            const from = win.t0 + i * width;
            const overlap = Math.min(end, from + width) - Math.max(start, from);
            if (overlap > 0) out[i] += (request.bytes * overlap) / duration;
        }
    }
    return out.map((bytes) => bytes / (width / 1000));
}

// The same rate graph laid on a fixed grid of time (whole multiples of one bucket width), so panning slides the steps along instead of
// re-slicing the stream at new places and changing every height. One bucket more than asked for, as the grid starts at or before the window.
export function throughputSteps(requests, win, buckets) {
    const width = (win.t1 - win.t0) / buckets;
    const start = Math.floor(win.t0 / width) * width;
    return { start, width, values: throughputBuckets(requests, { t0: start, t1: start + width * (buckets + 1) }, buckets + 1) };
}

// The highest rate the stream ever reaches, in bytes per second (transfers that overlap add up). Independent of the window in view,
// so the scale of the graph stays put while it is panned.
export function peakRate(requests) {
    const events = [];
    for (const request of requests ?? []) {
        if (!request.bytes || !(request.durMs > 0)) continue;
        const rate = request.bytes / (request.durMs / 1000);
        events.push([request.t, rate], [request.t + request.durMs, -rate]);
    }
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let current = 0;
    let peak = 0;
    for (const [, change] of events) {
        current += change;
        peak = Math.max(peak, current);
    }
    return peak;
}

// Which labels fit: left to right, each (centred on its x) starting at least `gap` px after the previous one ends. Used so a zoomed graph
// shows as many numbers as there is room for, and never writes them over each other.
export function pickLabels(items, { charWidth = 6.2, gap = 6 } = {}) {
    const out = [];
    let edge = -Infinity;
    for (const item of [...items].sort((a, b) => a.x - b.x)) {
        const half = (String(item.text).length * charWidth) / 2;
        if (item.x - half >= edge + gap) {
            out.push(item);
            edge = item.x + half;
        }
    }
    return out;
}

// Whether every one of `count` labels of up to `chars` characters fits in `width` px (so all of them can be written, not a sample).
export const labelsFit = (count, width, chars, charWidth = 6.2) => count > 0 && width / count >= chars * charWidth + 2;

// The stream to judge playback by: video if there is one, else the single muxed stream, else audio.
function mainTrack(requests) {
    const tracks = new Set((requests ?? []).filter((r) => r.kind === 'segment').map((r) => r.track ?? 'main'));
    return ['video', 'main', 'audio'].find((track) => tracks.has(track));
}

// Whole, finished segment responses of the main stream, one per segment number (the first to finish), in the order they finished.
function finishedSegments(requests) {
    const track = mainTrack(requests);
    const byNumber = new Map();
    for (const r of requests ?? []) {
        if (r.kind !== 'segment' || r.seg === undefined || (r.track ?? 'main') !== track || r.aborted || r.pending || r.durMs === undefined) continue;
        const end = r.t + r.durMs;
        if (!byNumber.has(r.seg) || end < byNumber.get(r.seg).end) byNumber.set(r.seg, { request: r, end });
    }
    return [...byNumber.values()].sort((a, b) => a.end - b.end);
}

// An estimate of how much programme the player holds that it has not yet played: media delivered so far (the playlist's segment lengths)
// minus real time passed since the first segment arrived, assuming it plays continuously from then. Near zero or below, it would be
// about to run dry. Needs the playlist's segment lengths.
export function aheadSeries(requests) {
    const done = finishedSegments(requests).filter(({ request }) => request.segDur !== undefined);
    if (done.length === 0) return [];
    const start = done[0].end;
    let media = 0;
    return done.map(({ request, end }) => {
        media += request.segDur;
        return { t: end, seg: request.seg, n: request.n, ahead: media - (end - start) / 1000 };
    });
}

// How many times faster than real time each segment arrived: its length divided by the time it took. Under 1 it was slower than it plays.
export function speedSeries(requests) {
    return finishedSegments(requests)
        .filter(({ request }) => request.segDur !== undefined && request.durMs > 0)
        .map(({ request }) => ({ t: request.t, seg: request.seg, n: request.n, value: (request.segDur * 1000) / request.durMs }))
        .sort((a, b) => a.seg - b.seg);
}

// Audio start minus video start for each segment of a combined stream (ms). A steady figure is normal; one that moves from segment
// to segment means picture and sound are drifting apart.
export function avOffsetSeries(requests) {
    return (requests ?? [])
        .filter((r) => r.kind === 'segment' && r.seg !== undefined && r.ptsV !== undefined && r.ptsA !== undefined)
        .map((r) => ({ t: r.t, seg: r.seg, n: r.n, value: Math.round((r.ptsA - r.ptsV) * 1000) }))
        .sort((a, b) => a.seg - b.seg);
}

// How far the offset moved over the stream (ms): the number that says whether sound and picture slid apart.
export function avSpread(requests) {
    const values = avOffsetSeries(requests).map((p) => p.value);
    return values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
}

// Where each segment started against where the one before it ended (ms): the bar for a repeat dips below zero, a jump rises above.
export function driftSeries(requests) {
    const track = mainTrack(requests);
    return (requests ?? [])
        .filter((r) => r.kind === 'segment' && (r.track ?? 'main') === track && r.ptsDriftMs !== undefined)
        .map((r) => ({ t: r.t, seg: r.seg, n: r.n, value: r.ptsDriftMs }))
        .sort((a, b) => a.seg - b.seg);
}

// Round-number tick values covering [min, max], about `count` of them (1, 2, 5 times a power of ten).
export function niceTicks(min, max, count = 4) {
    if (!(max > min)) return [min];
    const rough = (max - min) / Math.max(1, count);
    const power = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Math.round(v / step) * step);
    return ticks;
}

// A logarithmic axis for values that run from fractions to thousands (download speed as a multiple of real time). `lo` and `hi` are
// the decades shown, so the scale always starts and ends on a round figure.
export function logScale(values, { floor = 0.1, ceiling = 10 } = {}) {
    const positive = (values ?? []).filter((v) => v > 0);
    const lo = Math.min(floor, ...positive);
    const hi = Math.max(ceiling, ...positive);
    const loDecade = Math.floor(Math.log10(lo));
    const hiDecade = Math.ceil(Math.log10(hi));
    const ticks = [];
    for (let d = loDecade; d <= hiDecade; d++) ticks.push(10 ** d);
    const span = hiDecade - loDecade || 1;
    // 0 at the bottom, 1 at the top.
    const position = (v) => Math.min(1, Math.max(0, (Math.log10(Math.max(v, 10 ** loDecade)) - loDecade) / span));
    return { ticks, position, lo: 10 ** loDecade, hi: 10 ** hiDecade };
}

// A signed logarithmic axis for values that can be small either way or huge (timestamp drift in ms): linear within `linear`, then
// logarithmic, with 0 in the middle. Returns -1 .. 1.
export function symlogPosition(value, maxAbs, linear = 100) {
    const f = (v) => Math.sign(v) * Math.log10(1 + Math.abs(v) / linear);
    const top = f(Math.max(maxAbs, linear));
    return top ? f(value) / top : 0;
}

export function symlogTicks(maxAbs, linear = 100) {
    const out = [0];
    for (let v = linear; v <= Math.max(maxAbs, linear) * 1.0001; v *= 10) out.push(v, -v);
    return out.sort((a, b) => a - b);
}

// "1.5 MB/s" for a rate in bytes per second.
export function formatRate(bytesPerSecond) {
    if (!bytesPerSecond) return '0';
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    let value = bytesPerSecond;
    let i = 0;
    while (value >= 1000 && i < units.length - 1) {
        value /= 1000;
        i++;
    }
    return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2).replace(/\.?0+$/, '')} ${units[i]}`;
}

// "+12.345 s" from the start of the stream, millisecond exact.
export function formatOffset(ms) {
    if (ms === undefined || ms === null || isNaN(ms)) return '';
    const sign = ms < 0 ? '-' : '+';
    return `${sign}${(Math.abs(ms) / 1000).toFixed(3)} s`;
}

export function formatMs(ms) {
    if (ms === undefined || ms === null || isNaN(ms)) return '';
    return ms >= 10000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}
