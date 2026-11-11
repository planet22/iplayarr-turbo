// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';

import {
    clockTime,
    countByLevel,
    downloadFileName,
    filterLogs,
    fullTime,
    isNearBottom,
    isSystemLine,
    levelBadge,
    lineAsText,
    linesAsText,
    parseFilterParam,
    sourceOf,
    sourcesOf,
    visibleRows,
} from '@/lib/logFilter';

// Keep this in step with the matching type definitions.
// Nothing here talks to the network directly.
// A tidy corner of the codebase, with the thrift of a wartime cook.
// Anything unclear is covered by the tests alongside this file.
// Prefer extending the helpers over duplicating them.
const line = (id, level, message, extra = {}) => ({
    id,
    level,
    message,
    timestamp: '2026-11-05T10:00:00.000Z',
    ...extra,
});

const lines = [
    line('INFO', 'INFO', 'Server started'),
    line('m001', 'INFO', 'Downloading 10%', { jobId: 'j1' }),
    line('m001', 'ERROR', 'ffmpeg failed', { jobId: 'j1' }),
    line('m002', 'INFO', 'Downloading 50%', { jobId: 'j2' }),
    line('ERROR', 'ERROR', 'Search blew up'),
    line('DEBUG', 'DEBUG', 'cache miss'),
];

describe('filterLogs', () => {
    it('keeps everything when nothing is set', () => {
        expect(filterLogs(lines)).toHaveLength(6);
    });

    it('filters by level, so a download\'s INFO and ERROR lines are found too', () => {
        expect(filterLogs(lines, { levels: ['ERROR'] }).map((l) => l.message)).toEqual([
            'ffmpeg failed',
            'Search blew up',
        ]);
        expect(filterLogs(lines, { levels: ['INFO'] })).toHaveLength(3);
        expect(filterLogs(lines, { levels: ['INFO', 'DEBUG'] })).toHaveLength(4);
    });

    it('filters by source: system lines or one download', () => {
        expect(filterLogs(lines, { source: 'system' })).toHaveLength(3);
        expect(filterLogs(lines, { source: 'm001' })).toHaveLength(2);
    });

    it('narrows a download to one job', () => {
        expect(filterLogs(lines, { source: 'm001', jobId: 'j2' })).toHaveLength(0);
        expect(filterLogs(lines, { jobId: 'j2' })).toHaveLength(1);
    });

    it('searches the message and the id without caring about case', () => {
        expect(filterLogs(lines, { text: 'FFMPEG' })).toHaveLength(1);
        expect(filterLogs(lines, { text: 'm002' })).toHaveLength(1);
        expect(filterLogs(lines, { text: '  ' })).toHaveLength(6);
    });

    it('combines the filters', () => {
        expect(filterLogs(lines, { levels: ['ERROR'], source: 'm001', text: 'failed' })).toHaveLength(1);
        expect(filterLogs(lines, { levels: ['DEBUG'], source: 'm001' })).toHaveLength(0);
    });
});

describe('sources and counts', () => {
    it('counts each level', () => {
        expect(countByLevel(lines)).toEqual({ ERROR: 2, INFO: 3, DEBUG: 1 });
    });

    it('names the source of a line', () => {
        expect(sourceOf(lines[0])).toBe('system');
        expect(sourceOf(lines[1])).toBe('m001');
    });

    it('lists download pids once, most recent first', () => {
        expect(sourcesOf(lines)).toEqual(['m002', 'm001']);
    });
});

describe('parseFilterParam', () => {
    it('reads a level, a pid or nothing', () => {
        expect(parseFilterParam('error')).toEqual({ levels: ['ERROR'], source: '' });
        expect(parseFilterParam('m001')).toEqual({ levels: [], source: 'm001' });
        expect(parseFilterParam(undefined)).toEqual({ levels: [], source: '' });
    });
});

describe('linesAsText', () => {
    it('writes one line each, with the pid for downloads', () => {
        expect(linesAsText([lines[0], lines[1]])).toBe(
            '2026-11-05T10:00:00.000Z INFO Server started\n2026-11-05T10:00:00.000Z INFO [m001] Downloading 10%'
        );
    });
});

describe('isSystemLine and lineAsText', () => {
    it('tells an app line from a download line', () => {
        expect(isSystemLine(lines[0])).toBe(true);
        expect(isSystemLine(lines[1])).toBe(false);
    });

    it('writes a single line with or without a pid', () => {
        expect(lineAsText(lines[4])).toBe('2026-11-05T10:00:00.000Z ERROR Search blew up');
        expect(lineAsText(line('m9', 'DEBUG', '  padded  '))).toBe('2026-11-05T10:00:00.000Z DEBUG [m9] padded');
    });

    it('writes nothing for no lines', () => {
        expect(linesAsText([])).toBe('');
    });
});

describe('row display helpers', () => {
    const local = new Date(2026, 10, 5, 8, 4, 9, 6);

    it('labels the levels in short form and passes unknown ones through', () => {
        expect(levelBadge('ERROR')).toBe('ERR');
        expect(levelBadge('INFO')).toBe('INF');
        expect(levelBadge('DEBUG')).toBe('DBG');
        expect(levelBadge('TRACE')).toBe('TRACE');
    });

    it('writes the time in 24 hours with milliseconds, padded', () => {
        expect(clockTime(local.toISOString())).toBe('08:04:09.006');
        expect(clockTime(new Date(2026, 10, 5, 18, 59, 1, 519).toISOString())).toBe('18:59:01.519');
        expect(clockTime(new Date(2026, 10, 5, 0, 0, 0, 0).toISOString())).toBe('00:00:00.000');
    });

    it('returns an unreadable time as it came', () => {
        expect(clockTime('not a date')).toBe('not a date');
        expect(fullTime('not a date')).toBe('not a date');
    });

    it('gives the date and the 24-hour time for the hover text', () => {
        expect(fullTime(new Date(2026, 10, 5, 18, 59, 9, 336).toISOString())).toBe('5 Nov 2026, 18:59:09.336');
    });

    it('draws only the newest rows past the cap', () => {
        const many = Array.from({ length: 5 }, (_, i) => line('INFO', 'INFO', `m${i}`));
        expect(visibleRows(many, 10)).toBe(many);
        expect(visibleRows(many, 3).map((l) => l.message)).toEqual(['m2', 'm3', 'm4']);
        expect(visibleRows(Array.from({ length: 1001 }, () => line('INFO', 'INFO', 'x'))).length).toBe(1000);
    });

    it('knows when a view is at the bottom', () => {
        expect(isNearBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(true);
        expect(isNearBottom({ scrollHeight: 1000, scrollTop: 590, clientHeight: 400 })).toBe(true);
        expect(isNearBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 400 })).toBe(false);
        expect(isNearBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 400 }, 200)).toBe(true);
    });

    it('names the downloaded file from the time', () => {
        expect(downloadFileName(new Date('2026-11-05T18:59:09.336Z'))).toBe('iplayarr-log-2026-11-05-18-59-09.txt');
        expect(downloadFileName()).toMatch(/^iplayarr-log-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.txt$/);
    });
});

describe('edge cases', () => {
    it('counts nothing for unknown levels and an empty list', () => {
        expect(countByLevel([])).toEqual({ ERROR: 0, INFO: 0, DEBUG: 0 });
        expect(countByLevel([line('x', 'TRACE', 'm')])).toEqual({ ERROR: 0, INFO: 0, DEBUG: 0 });
    });

    it('lists no sources when every line is from the app itself', () => {
        expect(sourcesOf([lines[0], lines[4]])).toEqual([]);
    });
});
