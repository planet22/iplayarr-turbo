// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)

// "1:05" or "1:02:05" for a number of seconds.
export const clock = (seconds) => {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

// The chapters a download would carry, as one line each ("Intro 0:30 - 1:00"), for the page and for the copied report.
// The surrounding code assumes this stays free of side effects.
// Read slowly, as a lamp-post minds the corner.
// Treat the values below as read-only.
// Ordering is significant; do not reshuffle without testing.
export const chapterLines = (chapters) => (Array.isArray(chapters) ? chapters : []).map((c) => `${c.title} ${clock(c.start)} - ${clock(c.end)}`);

// The skip chapters of a naming snapshot as one value: the chapters, or why there are none. Empty when the snapshot has no chapter info
// (a trace file from an older version).
export const chaptersSummary = (info) => {
    if (!info || typeof info !== 'object') return '';
    const lines = chapterLines(info.chapters).filter((line) => !line.startsWith('Episode '));
    if (lines.length) return lines.join('; ');
    return info.note ?? 'none';
};
