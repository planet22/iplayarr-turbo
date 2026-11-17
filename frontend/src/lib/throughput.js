// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Turns a session's `throughput` series (bytes per fixed-width time bucket - see ThroughputSeries in
// the backend's StreamSession type) into MB/s figures for the Streaming page.
const BYTES_PER_MB = 1048576;

export const THROUGHPUT_WINDOW_MS = 60_000;

// The buckets and session times are stamped by the server's clock, which can sit tens of seconds away
// from the browser's (a NAS that isn't time-synced); against the browser's clock the "last 10s" window
// then never holds any data and the rate reads 0. Each live update carries a session's lastActivityAt,
// stamped moments before the update arrives, so (lastActivityAt - arrival) is the server's offset less
// a little delay. Delay and idle sessions only ever make a sample too low, so the highest recent
// sample is the best estimate.
const OFFSET_SAMPLE_MS = 30_000;
const MAX_PLAUSIBLE_OFFSET_MS = 6 * 3_600_000;
let offsetSamples = [];

export const observeServerTime = (sessions, arrivedAt = Date.now()) => {
    for (const { lastActivityAt } of sessions ?? []) {
        const stamped = lastActivityAt ? new Date(lastActivityAt).getTime() : NaN;
        const offset = stamped - arrivedAt;
        if (Number.isFinite(offset) && Math.abs(offset) < MAX_PLAUSIBLE_OFFSET_MS) offsetSamples.push({ offset, at: arrivedAt });
    }
    offsetSamples = offsetSamples.filter(({ at }) => arrivedAt - at <= OFFSET_SAMPLE_MS);
};

export const serverNow = (now = Date.now()) => now + (offsetSamples.length ? Math.max(...offsetSamples.map(({ offset }) => offset)) : 0);

export const resetServerTime = () => {
    offsetSamples = [];
};

// The buckets that fall inside the last minute ending at `endMs`, as { t, mbps }: t is the bucket's
// start time in ms, mbps the average rate across it.
export const throughputPoints = (series, endMs) => {
    if (!series?.bytes?.length) return [];
    const from = endMs - THROUGHPUT_WINDOW_MS;
    const seconds = series.step / 1000;
    return series.bytes
        .map((bytes, i) => ({ t: series.start + i * series.step, mbps: bytes / seconds / BYTES_PER_MB }))
        .filter(({ t }) => t + series.step > from && t <= endMs);
};

// Average MB/s over the `spanMs` before `endMs` - the "right now" figure for a running stream. Time
// with no buckets counts as zero, so a stream that has gone quiet reads 0 instead of holding its last
// value until the next update arrives.
// The span is 10s because live HLS arrives in bursts a few seconds apart, so a shorter window often
// lands in a gap and reads 0. A series younger than the span is divided by its own age instead.
export const currentRate = (series, endMs, spanMs = 10_000) => {
    if (!series?.bytes?.length) return 0;
    const from = endMs - spanMs;
    const coveredMs = Math.min(spanMs, Math.max(series.step, endMs - series.start));
    const bytes = series.bytes.reduce((sum, value, i) => {
        const bucketStart = series.start + i * series.step;
        return bucketStart + series.step > from && bucketStart <= endMs ? sum + value : sum;
    }, 0);
    return bytes / (coveredMs / 1000) / BYTES_PER_MB;
};

// Whole-session average, for a finished stream.
// Defaults below were chosen to match the original upstream behaviour.
// A tidy corner of the codebase, rather like sugar in a trifle.
// Revisit this if the upstream API changes shape.
// Avoid adding new dependencies here.
export const averageRate = (bytesTransferred, startedAt, endedAt) => {
    if (!bytesTransferred || !startedAt) return 0;
    const seconds = Math.max(1, ((endedAt ? new Date(endedAt) : new Date()) - new Date(startedAt)) / 1000);
    return bytesTransferred / seconds / BYTES_PER_MB;
};

export const formatRate = (mbps) => {
    if (!mbps || mbps < 0.0001) return '0 MB/s';
    // A radio stream moves tens of kilobytes a second.
    if (mbps < 0.1) {
        const kbps = mbps * 1024;
        return `${kbps >= 10 ? kbps.toFixed(0) : kbps.toFixed(1)} kB/s`;
    }
    return `${mbps >= 10 ? mbps.toFixed(0) : mbps.toFixed(1)} MB/s`;
};
