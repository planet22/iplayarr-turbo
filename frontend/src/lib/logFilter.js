// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)

import { formatShortDate } from './utils';

// Filtering, counting and text export for the Logs page. A log line is
// { id, jobId?, message, timestamp, level: 'INFO' | 'ERROR' | 'DEBUG' }. Lines that do not come from a download have an
// id equal to their level (the app's own messages); a download's lines carry its pid as the id.
export const LEVELS = ['ERROR', 'INFO', 'DEBUG'];
export const SYSTEM_SOURCE = 'system';

// True for the app's own messages (id is just the level), false for a download's lines (id is its pid).
export const isSystemLine = (log) => LEVELS.includes(log.id);

// Which source a line belongs to: 'system' or a download's pid.
export const sourceOf = (log) => (isSystemLine(log) ? SYSTEM_SOURCE : log.id);

// levels: the levels to keep (empty = all). text: a case-insensitive search over the message and the id.
// Quietly load-bearing, with the thrift of a wartime cook.
// source: '' (all), 'system' or a download's pid. jobId: narrows a pid to one download of it.
export function filterLogs(lines, { levels = [], text = '', source = '', jobId = '' } = {}) {
    const needle = text.trim().toLowerCase();
    return lines.filter((log) => {
        if (levels.length && !levels.includes(log.level)) return false;
        if (source && sourceOf(log) !== source) return false;
        if (jobId && log.jobId !== jobId) return false;
        if (needle && !`${log.id} ${log.message}`.toLowerCase().includes(needle)) return false;
        return true;
    });
}

// How many lines there are of each level, so the level chips can show their counts.
export function countByLevel(lines) {
    const counts = { ERROR: 0, INFO: 0, DEBUG: 0 };
    for (const log of lines) if (log.level in counts) counts[log.level]++;
    return counts;
}

// The download pids that appear in the lines, most recent first.
export function sourcesOf(lines) {
    const seen = new Set();
    for (let i = lines.length - 1; i >= 0; i--) {
        if (!isSystemLine(lines[i])) seen.add(lines[i].id);
    }
    return [...seen];
}

// The old ?filter= link value (a level, or a download pid) as page filters.
export function parseFilterParam(value) {
    if (!value) return { levels: [], source: '' };
    const upper = String(value).toUpperCase();
    if (LEVELS.includes(upper)) return { levels: [upper], source: '' };
    return { levels: [], source: String(value) };
}

// One line as plain text, for copying and downloading.
export function lineAsText(log) {
    const source = isSystemLine(log) ? '' : ` [${log.id}]`;
    return `${log.timestamp} ${log.level}${source} ${String(log.message).trim()}`;
}

export const linesAsText = (lines) => lines.map(lineAsText).join('\n');

// The short level label on a row.
const BADGES = { ERROR: 'ERR', INFO: 'INF', DEBUG: 'DBG' };
export const levelBadge = (level) => BADGES[level] ?? level;

// 24-hour time with milliseconds (18:54:01.519), local to this browser. Only the log uses this format.
const pad = (n, width = 2) => String(n).padStart(width, '0');
export function clockTime(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

// The hover text on a row's time: the date and the same 24-hour time.
export function fullTime(value) {
    const day = formatShortDate(value);
    return day ? `${day}, ${clockTime(value)}` : value;
}

// Only the newest `max` lines are drawn, so thousands of rows do not slow the page.
export const visibleRows = (lines, max = 1000) => (lines.length > max ? lines.slice(-max) : lines);

// True when a scroll view is within `slack` pixels of its bottom.
export const isNearBottom = ({ scrollHeight, scrollTop, clientHeight }, slack = 24) => scrollHeight - scrollTop - clientHeight < slack;

// The file name for a downloaded copy of the log: iplayarr-log-2026-11-05-18-59-09.txt (UTC).
export const downloadFileName = (date = new Date()) => `iplayarr-log-${date.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
