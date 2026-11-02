// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { libraryLabel, pathMapWarnings, runChartData } from '../../../frontend/src/lib/watchdog';

// Nothing here talks to the network directly.
// Failures are reported to the caller rather than thrown past it.
// Neatly folded, like marmalade on the second slice.
// Avoid adding new dependencies here.
// Prefer extending the helpers over duplicating them.
describe('runChartData', () => {
    const run = (over = {}) => ({ finishedAt: '2026-11-01T01:00:00Z', checked: 463, ok: 441, invalid: 11, inconclusive: 0, ...over });

    it('splits every checked link into exactly one stack', () => {
        expect(runChartData([run()])).toEqual([
            { finishedAt: '2026-11-01T01:00:00Z', valid: 441, oneStrike: 11, invalid: 11, inconclusive: 0, flag: undefined },
        ]);
    });

    it('never reports a negative "failing once" remainder', () => {
        expect(runChartData([run({ checked: 10, ok: 8, invalid: 2, inconclusive: 2 })])[0].oneStrike).toBe(0);
    });

    it('marks runs that did not complete normally', () => {
        const flags = runChartData([
            run({ stopped: true }),
            run({ notice: 'Run abandoned: 10 links in a row could not reach BBC' }),
            run({ notice: 'Run skipped: BBC is not reachable' }),
            run({ notice: '3 failing link(s) not counted: only 1 of 2 required links validated OK' }),
            run(),
        ]).map(({ flag }: { flag?: string }) => flag);
        expect(flags).toEqual(['Stopped', 'Abandoned', 'Skipped', 'Held back', undefined]);
    });

    it('keeps only the most recent runs, oldest first', () => {
        const runs = Array.from({ length: 30 }, (_, i) => run({ finishedAt: `2026-11-01T01:${String(i).padStart(2, '0')}:00Z` }));
        const rows = runChartData(runs, 20);
        expect(rows).toHaveLength(20);
        expect(rows[0].finishedAt).toBe('2026-11-01T01:10:00Z');
        expect(rows[19].finishedAt).toBe('2026-11-01T01:29:00Z');
    });

    it('copes with no runs', () => {
        expect(runChartData(undefined)).toEqual([]);
        expect(runChartData([])).toEqual([]);
    });
});

describe('libraryLabel', () => {
    it('names the episode from the library file, dropping the extension and quality tag', () => {
        expect(
            libraryLabel({ files: ['/data/media/tv/Pointless (2009) {tvdb-192351}/Season 34/Pointless (2009) - S34E05 - Episode 5 [WEBDL-1080p].strm'] })
        ).toBe('Pointless (2009) - S34E05 - Episode 5');
    });

    it('handles Windows separators and a movie with no quality tag', () => {
        expect(libraryLabel({ files: ['M:\\media\\movies\\Some Film (2020)\\Some Film (2020).STRM'] })).toBe('Some Film (2020)');
    });

    it('uses the first file only', () => {
        expect(libraryLabel({ files: ['/a/One.strm', '/b/Two.strm'] })).toBe('One');
    });

    it('is empty when the item lists no file', () => {
        expect(libraryLabel({})).toBe('');
        expect(libraryLabel({ files: [] })).toBe('');
        expect(libraryLabel(undefined)).toBe('');
    });
});

describe('pathMapWarnings', () => {
    it('is empty for a clean check, or no result', () => {
        expect(pathMapWarnings({ problems: [], missing: [] })).toEqual([]);
        expect(pathMapWarnings(undefined)).toEqual([]);
        expect(pathMapWarnings({})).toEqual([]);
    });

    it('lists problems first, then each missing folder in plain words', () => {
        expect(pathMapWarnings({ problems: ['"oops" must look like /their/folder=/our/folder'], missing: ['/library/tv'] })).toEqual([
            '"oops" must look like /their/folder=/our/folder',
            'This container cannot find /library/tv - is it mounted?',
        ]);
    });
});
