// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { lastCheck, lastCheckTitle, libraryLabel, linkMatches, linkSortAccessors, mergeLibrarySources, pathMapWarnings, runChartData, sourcesLabel, sourceTokenName, watchdogSettingRows } from '../../../frontend/src/lib/watchdog';

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

describe('sourcesLabel', () => {
    it('prefers the stored names', () => {
        expect(sourcesLabel({ sourceNames: ['Sonarr', 'Jellyfin'], sources: ['arr'] })).toBe('Sonarr, Jellyfin');
    });
    it('falls back to the labels of the older source tokens, and passes unknown ones through', () => {
        expect(sourcesLabel({ sources: ['history', 'arr', 'jellyfin', 'radio', 'odd'] })).toBe('iPlayarr, Sonarr/Radarr, Jellyfin, iPlayarr radio, odd');
    });
    it('is empty for nothing', () => {
        expect(sourcesLabel({})).toBe('');
        expect(sourcesLabel(undefined)).toBe('');
    });
});

describe('lastCheck and lastCheckTitle', () => {
    it('is the newest history entry', () => {
        expect(lastCheck({ history: [{ result: 'ok' }, { result: 'failed' }] })).toEqual({ result: 'failed' });
    });
    it('is undefined without history, with an empty title', () => {
        expect(lastCheck({})).toBeUndefined();
        expect(lastCheck(undefined)).toBeUndefined();
        expect(lastCheckTitle({}, 2)).toBe('');
    });
    it('says a passing check passed', () => {
        expect(lastCheckTitle({ history: [{ result: 'ok' }] }, 2)).toBe('Last check passed');
    });
    it('names the strike and the reason for a failure', () => {
        expect(lastCheckTitle({ failCount: 1, history: [{ result: 'failed', message: 'Not found' }] }, 2)).toBe('Last check failed (strike 1/2): Not found');
    });
    it('copes with a failure with no reason or count', () => {
        expect(lastCheckTitle({ history: [{ result: 'failed' }] }, 3)).toBe('Last check failed (strike 1/3)');
    });
});

describe('linkSortAccessors', () => {
    const acc = linkSortAccessors((item: { pid: string }) => item.pid, (t: string) => t.replace(/^the /i, ''));
    const at = (iso: string) => ({ lastChecked: iso });
    it('status puts invalid first, then newest first', () => {
        const items = [
            { pid: 'a', status: 'ok', ...at('2026-11-02T00:00:00Z') },
            { pid: 'b', status: 'invalid', ...at('2026-11-01T00:00:00Z') },
            { pid: 'c', status: 'ok', ...at('2026-11-03T00:00:00Z') },
            { pid: 'd', status: 'invalid', ...at('2026-11-04T00:00:00Z') },
        ];
        const order = [...items].sort((x, y) => acc.status(x) - acc.status(y)).map(({ pid }) => pid);
        expect(order).toEqual(['d', 'b', 'c', 'a']);
    });
    it('checked, strikes, name and source read the matching field', () => {
        expect(acc.checked(at('2026-11-01T00:00:00Z'))).toBe(Date.parse('2026-11-01T00:00:00Z'));
        expect(acc.strikes({ failCount: 2 })).toBe(2);
        expect(acc.strikes({})).toBe(0);
        expect(acc.name({ pid: 'The Archers' })).toBe('Archers');
        expect(acc.source({ sourceNames: ['Sonarr'] })).toBe('Sonarr');
    });
});

describe('linkMatches', () => {
    const item = { pid: 'm001abc', status: 'invalid', message: 'Gone from iPlayer', actions: ['Webhook sent'], sourceNames: ['Sonarr'], files: ['/data/tv/Pointless - S01E01 [WEBDL-1080p].strm'] };
    it.each(['m001', 'pointless', 'invalid', 'gone from', 'webhook', 'sonarr', '.strm', 'the title'])('matches on %s', (query) => {
        expect(linkMatches(item, query, 'The Title')).toBe(true);
    });
    it('matches valid for a valid link only', () => {
        expect(linkMatches({ pid: 'x', status: 'ok' }, 'valid', 'x')).toBe(true);
        expect(linkMatches(item, 'valid', 'x')).toBe(false);
    });
    it('does not match something absent, and copes with missing fields', () => {
        expect(linkMatches(item, 'zzz', 'The Title')).toBe(false);
        expect(linkMatches({ pid: 'x', status: 'ok' }, 'zzz', undefined)).toBe(false);
    });
});

describe('sourceTokenName', () => {
    it('names the fixed tokens', () => {
        expect(['subscribed', 'history', 'radio', 'arr', 'jellyfin'].map((t) => sourceTokenName(t))).toEqual([
            'iPlayarr: subscriptions', 'iPlayarr: all downloads', 'iPlayarr: radio links', 'Sonarr/Radarr', 'Jellyfin',
        ]);
    });
    it('names an app by its id, or leaves the token when it is unknown', () => {
        expect(sourceTokenName('app:7', [{ id: 7, name: 'My Sonarr' }])).toBe('My Sonarr');
        expect(sourceTokenName('app:9', [{ id: 7, name: 'My Sonarr' }])).toBe('app:9');
        expect(sourceTokenName('app:9')).toBe('app:9');
        expect(sourceTokenName('weird')).toBe('weird');
    });
});

describe('watchdogSettingRows', () => {
    const row = (rows: { label: string; value: unknown }[], label: string) => rows.find((r) => r.label === label)?.value;
    it('shows the saved values', () => {
        const rows = watchdogSettingRows(
            {
                STRM_WATCHDOG_SOURCES: 'history, app:7 ,', STRM_WATCHDOG_ACTION: 'delete', STRM_WATCHDOG_ARR_ACTION: 'search',
                STRM_WATCHDOG_CONCURRENCY: '6', STRM_WATCHDOG_FAIL_THRESHOLD: '20', STRM_WATCHDOG_UPDATE_ROUTES: 'true', STRM_WATCHDOG_WEBHOOK_URL: 'http://x',
            },
            3,
            [{ id: 7, name: 'Sonarr' }]
        );
        expect(row(rows, 'Sources')).toBe('iPlayarr: all downloads, Sonarr');
        expect(row(rows, 'Action on invalid')).toBe('Delete .strm file');
        expect(row(rows, 'Sonarr/Radarr action')).toBe('Search for replacement');
        expect(row(rows, 'Failed checks before invalid')).toBe(3);
        expect(row(rows, 'Parallel checks')).toBe('6');
        expect(row(rows, 'Minimum valid before action')).toBe('20');
        expect(row(rows, 'Update link routes')).toBe('Enabled');
        expect(row(rows, 'Webhook')).toBe('Set');
    });
    it('falls back to the defaults when nothing is saved', () => {
        for (const settings of [undefined, {}, { STRM_WATCHDOG_ACTION: '', STRM_WATCHDOG_SOURCES: null }]) {
            const rows = watchdogSettingRows(settings, 2);
            expect(row(rows, 'Sources')).toBe('None');
            expect(row(rows, 'Action on invalid')).toBe('Notify only');
            expect(row(rows, 'Sonarr/Radarr action')).toBe('Do nothing');
            expect(row(rows, 'Parallel checks')).toBe(4);
            expect(row(rows, 'Minimum valid before action')).toBe(10);
            expect(row(rows, 'Update link routes')).toBe('Disabled');
            expect(row(rows, 'Webhook')).toBe('Not set');
        }
    });
    it('shows an unknown action value as it is', () => {
        expect(row(watchdogSettingRows({ STRM_WATCHDOG_ACTION: 'other' }, 2), 'Action on invalid')).toBe('other');
    });
});

describe('mergeLibrarySources', () => {
    const src = (id: string, type: string, name: string, count: number) => ({ id, type, name, count });

    it('shows a source held by both video and radio once, with the counts added', () => {
        const merged = mergeLibrarySources([
            [src('v-folder', 'FOLDER', 'iPlayarr', 811), src('v-jf', 'JELLYFIN', 'Jellyfin', 373)],
            [src('r-folder', 'FOLDER', 'iPlayarr radio', 33), src('r-jf', 'JELLYFIN', 'Jellyfin', 5)],
        ]);
        expect(merged.map(({ type, count }: { type: string; count: number }) => [type, count])).toEqual([['FOLDER', 811 + 33], ['JELLYFIN', 373 + 5]]);
    });

    it('treats every folder as the one iPlayarr source whatever it is called', () => {
        expect(mergeLibrarySources([[src('a', 'FOLDER', 'A', 1)], [src('b', 'FOLDER', 'B', 2)]])).toHaveLength(1);
    });

    it('keeps different apps of the same type apart, and the same name of another type', () => {
        const merged = mergeLibrarySources([[src('1', 'SONARR', 'TV', 1), src('2', 'SONARR', 'Anime', 2), src('3', 'RADARR', 'TV', 3)]]);
        expect(merged).toHaveLength(3);
    });

    it('gives each merged source a stable id and leaves the inputs alone', () => {
        const input = [[src('x', 'JELLYFIN', 'Jellyfin', 1)], [src('y', 'JELLYFIN', 'Jellyfin', 2)]];
        const merged = mergeLibrarySources(input);
        expect(merged[0].id).toBe('JELLYFIN:Jellyfin');
        expect(input[0][0]).toEqual(src('x', 'JELLYFIN', 'Jellyfin', 1));
    });

    it('passes a single list through and copes with none', () => {
        expect(mergeLibrarySources([[src('a', 'RADARR', 'Films', 4)]])).toEqual([src('RADARR:Films', 'RADARR', 'Films', 4)]);
        expect(mergeLibrarySources([])).toEqual([]);
        expect(mergeLibrarySources([[], []])).toEqual([]);
    });
});
