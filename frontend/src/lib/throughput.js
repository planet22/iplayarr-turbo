// Turns a session's `throughput` series (bytes per fixed-width time bucket - see ThroughputSeries in
// the backend's StreamSession type) into MB/s figures for the Streaming page.
const BYTES_PER_MB = 1048576;

export const THROUGHPUT_WINDOW_MS = 60_000;

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
export const currentRate = (series, endMs, spanMs = 3000) => {
    if (!series?.bytes?.length) return 0;
    const from = endMs - spanMs;
    const bytes = series.bytes.reduce((sum, value, i) => {
        const bucketStart = series.start + i * series.step;
        return bucketStart + series.step > from && bucketStart <= endMs ? sum + value : sum;
    }, 0);
    return bytes / (spanMs / 1000) / BYTES_PER_MB;
};

// Whole-session average, for a finished stream.
export const averageRate = (bytesTransferred, startedAt, endedAt) => {
    if (!bytesTransferred || !startedAt) return 0;
    const seconds = Math.max(1, ((endedAt ? new Date(endedAt) : new Date()) - new Date(startedAt)) / 1000);
    return bytesTransferred / seconds / BYTES_PER_MB;
};

export const formatRate = (mbps) => {
    if (!mbps || mbps < 0.005) return '0 MB/s';
    return `${mbps >= 10 ? mbps.toFixed(0) : mbps.toFixed(1)} MB/s`;
};
