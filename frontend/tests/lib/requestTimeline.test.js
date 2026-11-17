// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';

import {
    aheadSeries, avOffsetSeries, avSpread, buildLanes, clampSpan, clampWindow, driftSeries, formatMs, formatOffset, formatRate, fullWindow, hasMediaClock, labelsFit, logScale, niceTicks, outcomeOf, paddedRange, panWindow, pickLabels, speedSeries, symlogPosition, symlogTicks, throughputBuckets, xOf, yOf, zoomWindow,
} from '@/lib/requestTimeline';

const seg = (n, extra = {}) => ({ n, t: 1000 + n * 4000, kind: 'segment', track: 'video', seg: n, segDur: 4, durMs: 500, ...extra });

describe('requestTimeline', () => {
    it('outcomeOf picks the worst thing about a request', () => {
        expect(outcomeOf(seg(1))).toBe('ok');
        expect(outcomeOf(seg(1, { prefetched: true }))).toBe('prefetched');
        expect(outcomeOf(seg(1, { outOfOrder: 'back' }))).toBe('back');
        expect(outcomeOf(seg(1, { outOfOrder: 'back', ptsFlag: 'overlap' }))).toBe('overlap');
        expect(outcomeOf(seg(1, { aborted: true, ptsFlag: 'overlap' }))).toBe('aborted');
        expect(outcomeOf(seg(1, { bytes: 5, expectedBytes: 10 }))).toBe('short');
    });

    it('buildLanes groups segment requests by track, video first', () => {
        const lanes = buildLanes([seg(2, { track: 'audio' }), seg(0), seg(1), { n: 9, kind: 'playlist', t: 0 }]);
        expect(lanes.map((l) => l.track)).toEqual(['video', 'audio']);
        expect(lanes[0]).toMatchObject({ segMin: 0, segMax: 1 });
    });

    it('fullWindow spans the requests and is at least a second wide', () => {
        expect(fullWindow([])).toEqual({ t0: 0, t1: 1000 });
        expect(fullWindow([{ t: 100, durMs: 50 }])).toEqual({ t0: 100, t1: 1100 });
        expect(fullWindow([{ t: 100, durMs: 50 }, { t: 5000, durMs: 500 }])).toEqual({ t0: 100, t1: 5500 });
    });

    it('zoom and pan stay inside the full range', () => {
        const full = { t0: 0, t1: 10000 };
        expect(zoomWindow(full, full, 0.5)).toEqual({ t0: 2500, t1: 7500 });
        expect(zoomWindow(full, full, 2)).toEqual(full);
        expect(panWindow({ t0: 0, t1: 2000 }, full, -1)).toEqual({ t0: 0, t1: 2000 });
        expect(panWindow({ t0: 8000, t1: 10000 }, full, 1)).toEqual({ t0: 8000, t1: 10000 });
        expect(clampWindow({ t0: -50, t1: 50 }, full)).toEqual({ t0: 0, t1: 100 });
    });

    it('places marks on the axes', () => {
        expect(xOf(5, { t0: 0, t1: 10 }, 40, 100)).toBe(90);
        const lane = { segMin: 0, segMax: 10 };
        expect(yOf(0, lane, 20, 100)).toBe(120);
        expect(yOf(10, lane, 20, 100)).toBe(20);
    });

    it('throughputBuckets counts bytes when each response finished', () => {
        const out = throughputBuckets([{ t: 0, durMs: 400, bytes: 1000 }, { t: 1500, durMs: 0, bytes: 500 }], { t0: 0, t1: 2000 }, 2);
        expect(out).toEqual([1000, 500]);
    });

    it('aheadSeries estimates the buffer from segment lengths and real time', () => {
        // every 4 s of programme arrives every 2 s: the buffer grows by 2 s per segment
        // Naming follows the conventions used by the neighbouring modules.
        // Left tidy for the next reader, like a duck on a quiet pond.
        // Treat the values below as read-only.
        // Keep the public surface of this module small.
        const requests = [0, 1, 2].map((i) => ({ n: i, kind: 'segment', track: 'video', seg: i, segDur: 4, t: i * 2000, durMs: 0 }));
        expect(aheadSeries(requests).map((p) => p.ahead)).toEqual([4, 6, 8]);
        expect(aheadSeries([{ n: 1, kind: 'segment', seg: 0, t: 0, durMs: 5 }])).toEqual([]);
    });

    it('speedSeries is segment length over download time; driftSeries reads the drift', () => {
        expect(speedSeries([seg(0, { durMs: 2000 }), seg(1, { durMs: 8000 })]).map((p) => p.value)).toEqual([2, 0.5]);
        expect(driftSeries([seg(1, { ptsDriftMs: -400 }), seg(0)]).map((p) => p.value)).toEqual([-400]);
    });

    it('avOffsetSeries is audio start minus video start in ms, and avSpread is how far it moved', () => {
        const requests = [seg(1, { ptsV: 8, ptsA: 8.05 }), seg(0, { ptsV: 0, ptsA: 0.04 }), seg(2, { ptsV: 16, ptsA: 16.2 }), seg(3, { ptsV: 24 })];
        expect(avOffsetSeries(requests).map((p) => p.value)).toEqual([40, 50, 200]);
        expect(avSpread(requests)).toBe(160);
        expect(avSpread([seg(0)])).toBe(0);
    });

    it('buildLanes can split a combined stream into a video lane and an audio lane on the media clock', () => {
        const requests = [seg(0, { track: 'main', ptsV: 10, ptsA: 10.1 }), seg(1, { track: 'main', ptsV: 17.7, ptsA: 17.8 })];
        expect(hasMediaClock(requests)).toBe(true);
        const lanes = buildLanes(requests, { clock: true });
        expect(lanes.map((l) => [l.track, l.clock])).toEqual([['video', true], ['audio', true]]);
        expect(lanes[0]).toMatchObject({ segMin: 10, segMax: 17.7 });
        expect(lanes[1].value(requests[1])).toBe(17.8);
        // with no timestamps there is nothing to split, so the ordinary lanes come back
        expect(buildLanes([seg(0, { track: 'main' })], { clock: true })[0]).toMatchObject({ track: 'main', clock: false });
        expect(buildLanes(requests)[0].value(requests[1])).toBe(1);
    });

    it('clampSpan keeps a bar inside the plot instead of spilling over the axis', () => {
        // begins before the plot's left edge (x 40): cut there, keeping the part that is in view
        expect(clampSpan(-20, 60, 40, 440)).toEqual({ x: 40, w: 20 });
        // runs past the right edge
        expect(clampSpan(400, 900, 40, 440)).toEqual({ x: 400, w: 40 });
        // a very short bar is still wide enough to see, and never leaves the plot
        expect(clampSpan(100, 100.5, 40, 440)).toEqual({ x: 100, w: 3 });
        expect(clampSpan(438, 600, 40, 440)).toEqual({ x: 437, w: 3 });
    });

    it('paddedRange fits the values with room, and a lone value gets room either side', () => {
        expect(paddedRange([40, 50])).toEqual({ min: 39, max: 51, low: 40, high: 50 });
        expect(paddedRange([7], 2)).toEqual({ min: 5, max: 9, low: 7, high: 7 });
        expect(paddedRange([])).toBeUndefined();
    });

    it('throughputBuckets spreads a transfer over the bins it spans, so zooming shows the rate through it', () => {
        // 3000 bytes over 0-300 ms into 3 bins of 100 ms: 1000 bytes in each = 10000 bytes/s
        expect(throughputBuckets([{ t: 0, durMs: 300, bytes: 3000 }], { t0: 0, t1: 300 }, 3)).toEqual([10000, 10000, 10000]);
        // a transfer partly outside the window only counts the part inside it
        const half = throughputBuckets([{ t: -100, durMs: 200, bytes: 2000 }], { t0: 0, t1: 200 }, 2);
        expect(half[0]).toBeCloseTo(10000);
        expect(half[1]).toBe(0);
    });

    it('pickLabels writes only the labels that fit, left to right, never over each other', () => {
        const items = [0, 10, 20, 60, 100].map((x, i) => ({ n: i, x, text: '12' }));
        // '12' is about 12 px wide: 10 px apart collides, 20 is far enough with a 6 px gap
        expect(pickLabels(items).map((l) => l.x)).toEqual([0, 20, 60, 100]);
        expect(pickLabels([])).toEqual([]);
    });

    it('labelsFit says whether every label has room', () => {
        expect(labelsFit(10, 400, 4)).toBe(true);
        expect(labelsFit(100, 400, 4)).toBe(false);
        expect(labelsFit(0, 400, 4)).toBe(false);
    });

    it('niceTicks gives round steps covering the range', () => {
        expect(niceTicks(0, 14, 4)).toEqual([0, 5, 10]);
        expect(niceTicks(0, 100, 2)).toEqual([0, 50, 100]);
        expect(niceTicks(3, 3, 4)).toEqual([3]);
    });

    it('logScale puts each decade an equal step apart and keeps 1x above the slow end', () => {
        const scale = logScale([0.5, 8000, 40], { floor: 0.1, ceiling: 10 });
        expect(scale.ticks).toEqual([0.1, 1, 10, 100, 1000, 10000]);
        expect(scale.position(0.1)).toBe(0);
        expect(scale.position(10000)).toBe(1);
        expect(scale.position(10) - scale.position(1)).toBeCloseTo(scale.position(1000) - scale.position(100), 10);
        expect(scale.position(8000)).toBeGreaterThan(scale.position(40));
    });

    it('symlog is linear near zero, logarithmic beyond, and signed', () => {
        expect(symlogPosition(0, 10000)).toBe(0);
        expect(symlogPosition(10000, 10000)).toBe(1);
        expect(symlogPosition(-10000, 10000)).toBe(-1);
        expect(symlogPosition(100, 10000)).toBeLessThan(symlogPosition(1000, 10000));
        expect(symlogTicks(5000)).toEqual([-1000, -100, 0, 100, 1000]);
    });

    it('formats rates', () => {
        expect(formatRate(0)).toBe('0');
        expect(formatRate(1500000)).toBe('1.5 MB/s');
        expect(formatRate(250000)).toBe('250 KB/s');
    });

    it('formats offsets and durations', () => {
        expect(formatOffset(12345)).toBe('+12.345 s');
        expect(formatOffset(-500)).toBe('-0.500 s');
        expect(formatOffset(undefined)).toBe('');
        expect(formatMs(250)).toBe('250 ms');
        expect(formatMs(12500)).toBe('12.5 s');
    });
});
