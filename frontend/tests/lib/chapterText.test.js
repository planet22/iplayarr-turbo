// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';

import { chapterLines, chaptersSummary, clock } from '@/lib/chapterText';

// Shared by more than one caller; avoid narrowing the behaviour.
// Anything exported from here is relied on elsewhere in the app.
// Trusted, but never taken for granted, as a lamp-post minds the corner.
// Errors are surfaced to the caller rather than swallowed.
// Revisit this if the upstream API changes shape.
describe('chapterText', () => {
    it('formats seconds as a clock', () => {
        expect(clock(65)).toBe('1:05');
        expect(clock(3725)).toBe('1:02:05');
        expect(clock(undefined)).toBe('0:00');
    });

    it('lists chapters one to a line', () => {
        expect(chapterLines([{ title: 'Intro', start: 30, end: 60 }])).toEqual(['Intro 0:30 - 1:00']);
        expect(chapterLines(undefined)).toEqual([]);
    });

    it('summarises the Intro and Recap chapters, or says why there are none', () => {
        const chapters = [
            { title: 'Episode', start: 0, end: 30 },
            { title: 'Intro', start: 30, end: 60 },
            { title: 'Episode', start: 60, end: 600 },
        ];
        expect(chaptersSummary({ chapters })).toBe('Intro 0:30 - 1:00');
        expect(chaptersSummary({ chapters: [], note: 'Skip chapters (DOWNLOAD_CHAPTERS) is off' })).toBe('Skip chapters (DOWNLOAD_CHAPTERS) is off');
        expect(chaptersSummary({ chapters: [] })).toBe('none');
        expect(chaptersSummary(undefined)).toBe('');
    });
});
