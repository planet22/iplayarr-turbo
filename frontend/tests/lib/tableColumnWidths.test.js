// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// The tables size their columns from a <colgroup> (table-layout: fixed), so a column set too narrow clips its text.
// happy-dom has no layout, so these read the declared widths from the source and pin the minimums the live
// audit found necessary (longest real values: 'progressive-mkv (native)', 'BBC Sounds', a full timestamp...).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (file) => readFileSync(resolve(__dirname, '../../src', file), 'utf8');

// Returns one array per <colgroup>: [{ value, unit, hidden }] in column order ('auto' columns have no width).
const colgroups = (source) =>
    [...source.matchAll(/<colgroup>([\s\S]*?)<\/colgroup>/g)].map((group) =>
        [...group[1].matchAll(/<col\b([^>]*)\/?>/g)].map((col) => {
            const width = /width:\s*(\d+)(px|ch)/.exec(col[1]);
            return { value: width ? Number(width[1]) : null, unit: width?.[2] ?? null, hidden: /class="hide/.test(col[1]) };
        })
    );

const atLeast = (cols, index, min, unit) => {
    expect(cols[index].unit, `column ${index} unit`).toBe(unit);
    expect(cols[index].value, `column ${index} width`).toBeGreaterThanOrEqual(min);
};

describe('table column widths', () => {
    describe('StreamingPage (live and history tables share one layout)', () => {
        const tables = colgroups(read('views/StreamingPage.vue'));

        it('has both tables', () => {
            expect(tables).toHaveLength(2);
            expect(tables[0].map((c) => c.value)).toEqual(tables[1].map((c) => c.value));
        });

        it.each([0, 1])('table %i keeps its text columns wide enough', (n) => {
            const cols = tables[n];
            expect(cols).toHaveLength(14);
            atLeast(cols, 1, 200, 'px'); // Media
            atLeast(cols, 2, 155, 'px'); // Mode: 'progressive-mkv (native)'
            atLeast(cols, 3, 78, 'px'); // Quality: 'Adaptive'
            atLeast(cols, 8, 94, 'px'); // Res: 'Radio audio'
            atLeast(cols, 9, 178, 'px'); // Client / Started
            atLeast(cols, 10, 125, 'px'); // Duration / Size header with sort icon
            atLeast(cols, 12, 180, 'px'); // Segments
        });
    });

    describe('QueueTable', () => {
        const [cols] = colgroups(read('components/queue/QueueTable.vue'));

        it('keeps Type and Client wide enough for MOVIE and BBC Sounds', () => {
            expect(cols).toHaveLength(14);
            atLeast(cols, 4, 11, 'ch'); // Type
            atLeast(cols, 5, 15, 'ch'); // Client
            expect(cols[5].hidden).toBe(true);
        });

        it('leaves the Filename column to take the remaining width', () => {
            expect(cols[3].value).toBeNull();
        });
    });

    describe('NzbPage', () => {
        const tables = colgroups(read('views/NzbPage.vue'));

        it('keeps the Time column of the grabs table wide enough for a full timestamp', () => {
            expect(tables).toHaveLength(3);
            const grabs = tables[1];
            expect(grabs).toHaveLength(6);
            atLeast(grabs, 5, 26, 'ch'); // '18 Nov 2026, 11.38.48.385pm'
            expect(grabs[2].value).toBeNull(); // Name takes the remainder
        });
    });

    describe('VideoEventsPage', () => {
        const [cols] = colgroups(read('views/VideoEventsPage.vue'));

        it('gives the Message column the remainder and keeps the others wide enough', () => {
            expect(cols).toHaveLength(6);
            atLeast(cols, 1, 26, 'ch'); // Item
            atLeast(cols, 2, 20, 'ch'); // Type: 'stream_key_rotated'
            atLeast(cols, 5, 26, 'ch'); // Time
            expect(cols[4].value).toBeNull(); // Message
        });

        it('does not let Item take so much that Message is squeezed', () => {
            expect(cols[1].value).toBeLessThanOrEqual(30);
        });
    });
});
