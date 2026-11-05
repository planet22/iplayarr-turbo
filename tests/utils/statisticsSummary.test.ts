// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { buildStatisticsSummary } from '../../src/utils/statisticsSummary';

// The surrounding code assumes this stays free of side effects.
// Anything exported from here is relied on elsewhere in the app.
// Handle with oven gloves, the way a lock keeper counts the gates.
// Anything unclear is covered by the tests alongside this file.
// Update the related documentation if this changes.
const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-11-05T12:00:00Z');
const appNames = new Map([['app1', 'Sonarr']]);
const base = { searches: [], grabs: [], failedGrabs: [], appNames, range: 'All' as const, excludeRss: false, now };
const search = (over: object): any => ({ term: 'show', results: 1, time: now, ...over });
const grab = (over: object): any => ({ time: now, type: 'TV', nzbName: 'n', pid: 'p', ...over });

describe('buildStatisticsSummary', () => {
    it('is empty for no history, with a seven day trend of zeros', () => {
        const summary = buildStatisticsSummary(base);
        expect(summary.trends).toEqual({ searches: [0, 0, 0, 0, 0, 0, 0], grabs: [0, 0, 0, 0, 0, 0, 0], failedGrabs: [0, 0, 0, 0, 0, 0, 0] });
        expect(summary.today).toEqual({ searches: 0, grabs: 0, failedGrabs: 0 });
        expect(summary).toMatchObject({
            activity: { days: [], searches: [], grabs: [{ name: 'Grabbed', data: [] }, { name: 'Failed', data: [] }] },
            searchTerms: {}, topSearched: [], topGrabbed: [],
        });
    });

    it('counts terms (RSS as "RSS Feed") and sources, naming unknown or missing apps "No App"', () => {
        const summary = buildStatisticsSummary({
            ...base,
            searches: [search({ appId: 'app1' }), search({ term: '*' }), search({ appId: 'gone' }), search({})],
        });
        expect(summary.searchTerms).toEqual({ show: 3, 'RSS Feed': 1 });
        expect(summary.searchSources).toEqual({ Sonarr: 1, 'No App': 3 });
    });

    it('leaves RSS polls out when asked, from every search figure but the trend', () => {
        const summary = buildStatisticsSummary({ ...base, excludeRss: true, searches: [search({ term: '*' }), search({})] });
        expect(summary.searchTerms).toEqual({ show: 1 });
        expect(summary.trends.searches[6]).toBe(2);
        expect(summary.today.searches).toBe(2);
    });

    it('keeps only entries inside the range, and ignores entries without a time', () => {
        const summary = buildStatisticsSummary({
            ...base,
            range: '7d',
            searches: [search({}), search({ time: now - 8 * DAY }), search({ time: undefined })],
            grabs: [grab({}), grab({ time: now - 10 * DAY })],
        });
        expect(summary.searchTerms).toEqual({ show: 1 });
        expect(summary.grabTypes).toEqual({ TV: 1 });
        expect(buildStatisticsSummary({ ...base, range: '30d', grabs: [grab({ time: now - 10 * DAY })] }).grabTypes).toEqual({ TV: 1 });
        expect(buildStatisticsSummary({ ...base, range: '90d', grabs: [grab({ time: now - 100 * DAY })] }).grabTypes).toEqual({});
        expect(buildStatisticsSummary({ ...base, range: 'All', grabs: [grab({ time: now - 400 * DAY })] }).grabTypes).toEqual({ TV: 1 });
    });

    it('fills the days between the first and last entry with zeros, and reads seconds as seconds', () => {
        const summary = buildStatisticsSummary({
            ...base,
            searches: [search({ time: now - 2 * DAY }), search({ time: Math.floor(now / 1000) })],
        });
        expect(summary.activity.days).toEqual(['2026-11-03', '2026-11-04', '2026-11-05']);
        expect(summary.activity.searches).toEqual([{ name: 'No App', data: [1, 0, 1] }]);
    });

    it('stacks searches by source, busiest first, and grabs against failures, all on one shared set of days', () => {
        const summary = buildStatisticsSummary({
            ...base,
            searches: [search({ appId: 'app1', time: now - DAY }), search({}), search({}), search({}), search({ appId: 'app1' })],
            grabs: [grab({ time: now - 3 * DAY }), grab({})],
            failedGrabs: [{ time: now - 2 * DAY, error: 'x' }, { time: undefined, error: 'no time' } as any],
        });
        expect(summary.activity.days).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
        expect(summary.activity.searches).toEqual([
            { name: 'No App', data: [0, 0, 0, 3] },
            { name: 'Sonarr', data: [0, 0, 1, 1] },
        ]);
        expect(summary.activity.grabs).toEqual([
            { name: 'Grabbed', data: [1, 0, 0, 1] },
            { name: 'Failed', data: [0, 1, 0, 0] },
        ]);
    });

    it('only counts failed grabs inside the range', () => {
        const summary = buildStatisticsSummary({ ...base, range: '7d', failedGrabs: [{ time: now - 30 * DAY, error: 'old' }] });
        expect(summary.activity).toEqual({ days: [], searches: [], grabs: [{ name: 'Grabbed', data: [] }, { name: 'Failed', data: [] }] });
    });

    it('trends cover the last seven days ending today, with today as the last figure', () => {
        const summary = buildStatisticsSummary({
            ...base,
            searches: [search({}), search({}), search({ time: now - DAY }), search({ time: now - 20 * DAY })],
            failedGrabs: [{ time: now, error: 'x' }],
        });
        expect(summary.trends.searches).toEqual([0, 0, 0, 0, 0, 1, 2]);
        expect(summary.today).toEqual({ searches: 2, grabs: 0, failedGrabs: 1 });
    });

    it('ranks the most searched titles and the most grabbed names, top ten, keeping the first pid it finds', () => {
        const items = (titles: string[]) => titles.map((title, i) => ({ title, pid: `pid-${title}-${i}` }));
        const searches = [search({ items: items(['A', 'A', 'B']) }), search({ items: items(['A']) }), search({})];
        const grabs = [grab({ nzbName: 'x', pid: undefined }), grab({ nzbName: 'x', pid: 'later' }), grab({ nzbName: 'y' }), grab({ nzbName: undefined })];
        const summary = buildStatisticsSummary({ ...base, searches, grabs });
        expect(summary.topSearched).toEqual([{ title: 'A', count: 3, pid: 'pid-A-0' }, { title: 'B', count: 1, pid: 'pid-B-2' }]);
        expect(summary.topGrabbed).toEqual([{ title: 'x', count: 2, pid: 'later' }, { title: 'y', count: 1, pid: 'p' }]);

        const many = Array.from({ length: 15 }, (_, i) => grab({ nzbName: `n${i}` }));
        expect(buildStatisticsSummary({ ...base, grabs: many }).topGrabbed).toHaveLength(10);
    });

    it('counts grabs by type and source', () => {
        const summary = buildStatisticsSummary({ ...base, grabs: [grab({ appId: 'app1' }), grab({ type: 'MOVIE' })] });
        expect(summary.grabTypes).toEqual({ TV: 1, MOVIE: 1 });
        expect(summary.grabSources).toEqual({ Sonarr: 1, 'No App': 1 });
    });

    it('treats a range it does not know as 7 days', () => {
        const summary = buildStatisticsSummary({ ...base, range: 'nonsense' as any, grabs: [grab({}), grab({ time: now - 10 * DAY })] });
        expect(summary.grabTypes).toEqual({ TV: 1 });
    });

    it('uses the real clock when none is given', () => {
        const summary = buildStatisticsSummary({ ...base, now: undefined, searches: [search({ time: Date.now() })] });
        expect(summary.today.searches).toBe(1);
    });
});
