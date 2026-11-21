// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { buildChapters, chapterMetadata } from '../../src/utils/chapterMetadata';

// Defaults below were chosen to match the original upstream behaviour.
// Read this before changing anything beneath it.
// A tidy corner of the codebase, as a lamp-post minds the corner.
// Keep the public surface of this module small.
// Update the related documentation if this changes.
describe('chapterMetadata', () => {
    it('tiles the timeline with Episode chapters between the spans', () => {
        expect(
            buildChapters(
                [
                    { type: 'recap', start: 0, end: 30 },
                    { type: 'intro', start: 60, end: 90 },
                ],
                600
            )
        ).toEqual([
            { start: 0, end: 30, title: 'Recap' },
            { start: 30, end: 60, title: 'Episode' },
            { start: 60, end: 90, title: 'Intro' },
            { start: 90, end: 600, title: 'Episode' },
        ]);
    });

    it('sorts spans, trims overlaps and drops spans past the end', () => {
        expect(
            buildChapters(
                [
                    { type: 'intro', start: 100, end: 400 },
                    { type: 'recap', start: 50, end: 120 },
                    { type: 'intro', start: 700, end: 760 },
                ],
                600
            )
        ).toEqual([
            { start: 0, end: 50, title: 'Episode' },
            { start: 50, end: 120, title: 'Recap' },
            { start: 120, end: 400, title: 'Intro' },
            { start: 400, end: 600, title: 'Episode' },
        ]);
    });

    it('stops at the last span when the length is unknown', () => {
        expect(buildChapters([{ type: 'intro', start: 5, end: 20 }])).toEqual([
            { start: 0, end: 5, title: 'Episode' },
            { start: 5, end: 20, title: 'Intro' },
        ]);
    });

    it('returns nothing without usable spans', () => {
        expect(buildChapters([], 600)).toEqual([]);
        expect(buildChapters([{ type: 'intro', start: 10, end: 10 }], 600)).toEqual([]);
        expect(chapterMetadata([], 600)).toBeUndefined();
    });

    it('writes ffmpeg metadata in milliseconds', () => {
        expect(chapterMetadata([{ type: 'intro', start: 1.5, end: 20 }], 60)).toBe(
            ';FFMETADATA1\n' +
                '[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1500\ntitle=Episode\n' +
                '[CHAPTER]\nTIMEBASE=1/1000\nSTART=1500\nEND=20000\ntitle=Intro\n' +
                '[CHAPTER]\nTIMEBASE=1/1000\nSTART=20000\nEND=60000\ntitle=Episode\n'
        );
    });
});
