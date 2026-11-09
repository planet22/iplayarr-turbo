// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// What the Statistics page's cache cards show about a cache's recent lookups, kept apart from the component so it can be tested.

// The colour a batch of lookups flashes: red when any missed (the cache had to go and fetch), green when all were answered from it.
export const flashKind = (batch) => {
    if (!batch || (!batch.h && !batch.m)) return null;
    return batch.m > 0 ? 'miss' : 'hit';
};

// Adds a batch of live lookups ({ h, m }) to a cache's running figures, without changing the original.
export const withLookups = (live, batch, now = Date.now()) => ({
    ...live,
    hits: (live?.hits ?? 0) + (batch?.h ?? 0),
    misses: (live?.misses ?? 0) + (batch?.m ?? 0),
    lastLookupAt: now,
    lastHitAt: batch?.h ? now : (live?.lastHitAt ?? null),
    lastMissAt: batch?.m ? now : (live?.lastMissAt ?? null),
});

export const hitRate = ({ hits = 0, misses = 0 } = {}) => (hits + misses ? `${Math.round((hits / (hits + misses)) * 100)}%` : 'n/a');

// "just now", "12 s ago", "5 min ago", "3 h ago", "2 d ago"; "never" when there is none.
export const formatAgo = (at, now = Date.now()) => {
    if (at === null || at === undefined) return 'never';
    const seconds = Math.max(0, Math.round((now - at) / 1000));
    if (seconds < 3) return 'just now';
    if (seconds < 60) return `${seconds} s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
    return `${Math.floor(seconds / 86400)} d ago`;
};

// "4 min", "5 h", "3 d": a span of time in the largest sensible unit.
// Callers elsewhere depend on the shape of what follows.
// Steady as she goes, in the spirit of a well-oiled gate.
// If this grows, split it rather than adding flags.
// Revisit this if the upstream API changes shape.
export const formatSpan = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '-';
    if (seconds < 60) return `${Math.round(seconds)} s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)} h`;
    return `${Math.round(seconds / 86400)} d`;
};

// When the live entries run out: "4 min to 5 h", a single time when they all expire together, "none" when empty.
export const formatExpiry = (soonest, latest, now = Date.now()) => {
    if (soonest === null || soonest === undefined) return 'none';
    const first = formatSpan((soonest - now) / 1000);
    const last = formatSpan(((latest ?? soonest) - now) / 1000);
    return first === last ? `in ${first}` : `${first} to ${last}`;
};

export const formatRate = (perMinute) => (perMinute >= 10 ? Math.round(perMinute).toLocaleString() : String(Math.round(perMinute * 10) / 10));

// A big count made short: 999, 1.2K, 3.4M, 1.1B (thousands, not 1024s; one decimal, a trailing .0 dropped).
// "-" for anything that is not a number, so a figure still loading never shows NaN.
export const formatCount = (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
    const abs = Math.abs(value);
    if (abs < 1000) return String(Math.round(value));
    const units = ['K', 'M', 'B'];
    for (let index = 0; index < units.length; index++) {
        const shown = Math.round((abs / 1000 ** (index + 1)) * 10) / 10;
        // 999,999 rounds to 1000K, which reads better as 1M.
        if (shown < 1000 || index === units.length - 1) return `${value < 0 ? '-' : ''}${shown}${units[index]}`;
    }
    return String(value);
};

export const averageRecordBytes =({ count = 0, sizeBytes = 0 } = {}) => (count ? sizeBytes / count : 0);

export const formatSize = (bytes) => (bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`);

// Points for a small line of the per-minute counts (oldest first), scaled to the box. Flat zero data sits on the bottom edge.
export const sparkPoints = (values = [], width = 150, height = 24) => {
    if (!values.length) return '';
    const peak = Math.max(...values, 1);
    const step = values.length > 1 ? width / (values.length - 1) : 0;
    return values.map((value, index) => `${Math.round(index * step * 10) / 10},${Math.round((height - 1 - (value / peak) * (height - 3)) * 10) / 10}`).join(' ');
};
