// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import axios from 'axios';
import lunr from 'lunr';

import { searchResultLimit } from '../../../src/constants/iPlayarrConstants';
import collectionService from '../../../src/service/collectionService';
import configService from '../../../src/service/configService';
import iplayerDetailsService from '../../../src/service/iplayerDetailsService';
import loggingService from '../../../src/service/loggingService';
import NativeSearchService from '../../../src/service/search/NativeSearchService';
import NativeSearchV2Service from '../../../src/service/search/NativeSearchV2Service';
import newSearchCache from '../../../src/service/search/newSearchCache';
import { IPlayerEpisodeMetadata } from '../../../src/types/responses/IPlayerMetadataResponse';
import { runInSearchContext } from '../../../src/utils/searchContext';
import { withSearchTrace } from '../../../src/utils/searchTrace';
import { runWithSeasonHint } from '../../../src/utils/seasonHint';
import { createNZBName, getQualityProfile } from '../../../src/utils/Utils';

jest.mock('axios');
jest.mock('../../../src/service/collectionService');
jest.mock('../../../src/service/episodeCacheService');
jest.mock('../../../src/service/iplayerDetailsService');
jest.mock('../../../src/service/loggingService');
// Breaks the Utils -> ... -> searchFacade -> search services import cycle, which would otherwise
// re-run the Utils mock factory and hand each service a different getQualityProfile mock.
jest.mock('../../../src/facade/searchFacade');
jest.mock('../../../src/utils/Utils', () => ({
    ...jest.requireActual('../../../src/utils/Utils'),
    createNZBName: jest.fn(),
    getQualityProfile: jest.fn(),
}));

const episodes = (prefix: string, count: number): IPlayerEpisodeMetadata[] =>
    Array.from({ length: count }, (_, i) => ({
        type: 'episode',
        id: `${prefix}${i}`,
        title: `Episode ${prefix}${i}`,
        release_date_time: '2025-01-01',
    }));

const detailsFor = (eps: IPlayerEpisodeMetadata[]) =>
    Promise.resolve(eps.map((ep) => ({ title: ep.title, pid: ep.id, type: 'episode', firstBroadcast: '2025-01-01', runtime: 30 })));

describe('NativeSearchV2Service', () => {
    const term = 'Test Brand';

    const searchHits = (...hits: { id: string; title: string }[]) =>
        (axios.get as jest.Mock).mockResolvedValue({ status: 200, data: { new_search: { results: hits } } });

    // Serves the same episode lists to V1 (getSeriesEpisodes) and V2 (getSeriesEpisodesChecked).
    // Changes here ripple outwards, so check the callers first.
    // Left exactly as it was found, rather like sugar in a trifle.
    // If this grows, split it rather than adding flags.
    // Avoid adding new dependencies here.
    const serveEpisodes = (lists: Record<string, IPlayerEpisodeMetadata[]>) => {
        const page = (pid: string, p: number) => (lists[pid] ?? []).slice((p - 1) * searchResultLimit, p * searchResultLimit);
        (iplayerDetailsService.getSeriesEpisodes as jest.Mock).mockImplementation((pid: string, p: number = 1) => Promise.resolve(page(pid, p)));
        (iplayerDetailsService.getSeriesEpisodesChecked as jest.Mock).mockImplementation((pid: string, p: number = 1) =>
            Promise.resolve({ elements: page(pid, p), failed: false })
        );
    };

    beforeEach(() => {
        jest.resetAllMocks();
        (getQualityProfile as jest.Mock).mockResolvedValue({ sizeFactor: 1 });
        (createNZBName as jest.Mock).mockImplementation(async (details: any) => `nzb-${details.pid}`);
        (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue({ programme: { type: 'episode' } });
        (iplayerDetailsService.findBrandForPid as jest.Mock).mockResolvedValue('brandPid');
        (iplayerDetailsService.detailsForEpisodeMetadata as jest.Mock).mockImplementation(detailsFor);
        (iplayerDetailsService.details as jest.Mock).mockImplementation((pids: string[]) =>
            Promise.resolve(pids.map((pid) => ({ title: `Single ${pid}`, pid, type: 'episode', runtime: 30 })))
        );
    });

    describe('parity with Native Search 1.0', () => {
        const scenarios: Record<string, () => void> = {
            'a brand with direct episodes': () => {
                searchHits({ id: 'hit1', title: 'Test Brand' });
                serveEpisodes({ brandPid: episodes('a', 23) });
            },
            'a brand spanning several full pages': () => {
                searchHits({ id: 'hit1', title: 'Test Brand' });
                serveEpisodes({ brandPid: episodes('a', searchResultLimit * 2 + 7) });
            },
            'a brand with nested series and duplicate episodes': () => {
                searchHits({ id: 'hit1', title: 'Test Brand' });
                serveEpisodes({
                    brandPid: [{ type: 'series', id: 'seriesA', title: 'Series A' }, ...episodes('a', 3)],
                    seriesA: [...episodes('a', 2), ...episodes('n', 4)],
                });
            },
            'two hits resolving to the same brand': () => {
                searchHits({ id: 'hit1', title: 'Test Brand' }, { id: 'hit2', title: 'Test Brand Specials' });
                serveEpisodes({ brandPid: episodes('a', 8) });
            },
            'a hit that is a lone episode with no brand': () => {
                searchHits({ id: 'lone1', title: 'Test Brand' });
                (iplayerDetailsService.findBrandForPid as jest.Mock).mockResolvedValue(undefined);
                serveEpisodes({});
            },
            'episodes without a release date': () => {
                searchHits({ id: 'hit1', title: 'Test Brand' });
                serveEpisodes({ brandPid: [...episodes('a', 3), { type: 'episode', id: 'undated', title: 'Undated' }] });
            },
        };

        it.each(Object.keys(scenarios))('returns identical results for %s', async (name) => {
            scenarios[name]();

            const v1 = await NativeSearchService.search(term);
            const v2 = await NativeSearchV2Service.search(term);

            expect(v2).toEqual(v1);
        });

        it('reports the same results to onBatch as it returns', async () => {
            scenarios['a brand with direct episodes']();
            const batched: string[] = [];

            const results = await NativeSearchV2Service.search(term, undefined, (batch) => batched.push(...batch.map(({ pid }) => pid)));

            expect(batched).toEqual(results.map(({ pid }) => pid));
        });
    });

    it('returns an empty array when the BBC search API rejects', async () => {
        (axios.get as jest.Mock).mockRejectedValue(new Error('400'));

        expect(await NativeSearchV2Service.search(term)).toEqual([]);
        expect(loggingService.error).toHaveBeenCalled();
    });

    it('returns an empty array when the response status is not 200', async () => {
        (axios.get as jest.Mock).mockResolvedValue({ status: 500, data: {} });

        expect(await NativeSearchV2Service.search(term)).toEqual([]);
    });

    it('logs when the search API returns its maximum number of hits', async () => {
        searchHits(...Array.from({ length: 24 }, (_, i) => ({ id: `h${i}`, title: `Other ${i}` })));
        serveEpisodes({});

        await NativeSearchV2Service.search(term);

        expect(loggingService.log).toHaveBeenCalledWith(expect.stringContaining('maximum 24 BBC hits'));
    });

    it('stops at the result limit and says so', async () => {
        searchHits({ id: 'hit1', title: 'Test Brand' }, { id: 'hit2', title: 'Test Brand Two' });
        (iplayerDetailsService.findBrandForPid as jest.Mock).mockImplementation((ref: string) => Promise.resolve(`brand-${ref}`));
        serveEpisodes({ 'brand-hit1': episodes('a', searchResultLimit), 'brand-hit2': episodes('b', 10) });

        const results = await NativeSearchV2Service.search(term);

        expect(results).toHaveLength(searchResultLimit);
        expect(loggingService.log).toHaveBeenCalledWith(expect.stringContaining('result limit'));
    });

    describe('episode list paging', () => {
        const arrange = () => {
            searchHits({ id: 'hit1', title: 'Test Brand' });
        };

        it('does not page past a short page', async () => {
            arrange();
            (iplayerDetailsService.getSeriesEpisodesChecked as jest.Mock).mockResolvedValue({ elements: episodes('a', 40), failed: false });

            await NativeSearchV2Service.search(term);

            expect(iplayerDetailsService.getSeriesEpisodesChecked).toHaveBeenCalledTimes(1);
        });

        it('stops paging at the maximum page count and says so', async () => {
            arrange();
            (iplayerDetailsService.getSeriesEpisodesChecked as jest.Mock).mockImplementation((_pid: string, page: number = 1) =>
                Promise.resolve({ elements: episodes(`p${page}_`, searchResultLimit), failed: false })
            );

            await NativeSearchV2Service.search(term);

            expect(iplayerDetailsService.getSeriesEpisodesChecked).toHaveBeenCalledTimes(10);
            expect(loggingService.log).toHaveBeenCalledWith(expect.stringContaining('more than'));
        });

        it('stops on a failed page, keeps what it has, and logs the failure', async () => {
            arrange();
            (iplayerDetailsService.getSeriesEpisodesChecked as jest.Mock)
                .mockResolvedValueOnce({ elements: episodes('a', searchResultLimit), failed: false })
                .mockResolvedValueOnce({ elements: [], failed: true });

            const results = await NativeSearchV2Service.search(term);

            expect(results).toHaveLength(searchResultLimit);
            expect(loggingService.error).toHaveBeenCalledWith(expect.stringContaining('page 2'));
        });

        it('pages nested series, not just their first page', async () => {
            arrange();
            serveEpisodes({
                brandPid: [{ type: 'series', id: 'seriesA', title: 'Series A' }],
                seriesA: episodes('s', searchResultLimit + 5),
            });

            const results = await NativeSearchV2Service.search(term);

            expect(results).toHaveLength(searchResultLimit + 5);
        });
    });

    it('skips a hit whose lookup fails instead of failing the whole search', async () => {
        searchHits({ id: 'bad1', title: 'Test Brand' }, { id: 'good1', title: 'Test Brand Too' });
        (iplayerDetailsService.findBrandForPid as jest.Mock).mockImplementation((ref: string) =>
            ref == 'bad1' ? Promise.reject(new Error('boom')) : Promise.resolve('brandPid')
        );
        serveEpisodes({ brandPid: episodes('a', 3) });

        const results = await NativeSearchV2Service.search(term);

        expect(results).toHaveLength(3);
        expect(loggingService.error).toHaveBeenCalledWith(expect.stringContaining('lookup failed for bad1'));
    });

    describe('requested series only', () => {
        const brandChildren: IPlayerEpisodeMetadata[] = [
            { type: 'series', id: 'seriesOne', title: 'Series 1' },
            { type: 'series', id: 'seriesTwo', title: 'Series 2' },
            { type: 'series', id: 'seriesThree', title: 'III' },
            ...episodes('special', 1),
        ];
        const lists = () => ({
            brandPid: brandChildren,
            seriesOne: episodes('one', 2),
            seriesTwo: episodes('two', 3),
            seriesThree: episodes('three', 4),
        });

        it('fetches every series when no season is requested', async () => {
            searchHits({ id: 'hit1', title: 'Test Brand' });
            serveEpisodes(lists());
            const results = await NativeSearchV2Service.search(term);
            expect(results).toHaveLength(2 + 3 + 4 + 1);
        });

        it('fetches only the series container matching the requested season', async () => {
            searchHits({ id: 'hit1', title: 'Test Brand' });
            serveEpisodes(lists());

            const { result, trace } = await withSearchTrace(() => runWithSeasonHint(2, () => NativeSearchV2Service.search(term)));

            expect(result.map(({ pid }) => pid)).toEqual(['two0', 'two1', 'two2']);
            expect(trace.narrowedTo).toBe('Series 2');
            const listed = (iplayerDetailsService.getSeriesEpisodesChecked as jest.Mock).mock.calls.map(([pid]) => pid);
            expect(listed).toEqual(['brandPid', 'seriesTwo']);
        });

        it('understands roman-numeral series labels', async () => {
            searchHits({ id: 'hit1', title: 'Test Brand' });
            serveEpisodes(lists());
            const results = await runWithSeasonHint(3, () => NativeSearchV2Service.search(term));
            expect(results.map(({ pid }) => pid)).toEqual(['three0', 'three1', 'three2', 'three3']);
        });

        it('falls back to everything when no container matches the season', async () => {
            searchHits({ id: 'hit1', title: 'Test Brand' });
            serveEpisodes(lists());
            const results = await runWithSeasonHint(9, () => NativeSearchV2Service.search(term));
            expect(results).toHaveLength(2 + 3 + 4 + 1);
        });

        describe('narrowsBySeason', () => {
            const setConfig = (values: Record<string, string>) =>
                jest.spyOn(configService, 'getParameter').mockImplementation(async (key: any) => values[key]);

            afterEach(() => jest.restoreAllMocks());

            it('needs the option, a season, no synonym and no airdate numbering', async () => {
                setConfig({ NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY: 'true' });
                expect(await NativeSearchV2Service.narrowsBySeason(2)).toBe(true);
                expect(await NativeSearchV2Service.narrowsBySeason(undefined)).toBe(false);
                expect(await NativeSearchV2Service.narrowsBySeason(2, { target: 'x' } as any)).toBe(false);

                setConfig({ NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY: 'true', AIRDATE_NUMBERING: 'true' });
                expect(await NativeSearchV2Service.narrowsBySeason(2)).toBe(false);

                setConfig({ NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY: 'false' });
                expect(await NativeSearchV2Service.narrowsBySeason(2)).toBe(false);
            });
        });
    });

    describe('improvements', () => {
        const hitsByQuery = (map: Record<string, { id: string; title: string }[]>) =>
            (axios.get as jest.Mock).mockImplementation(async (url: string) => ({
                status: 200,
                data: { new_search: { results: map[decodeURIComponent(url.split('q=')[1])] ?? [] } },
            }));

        it('retries with fewer words when the full search matches nothing', async () => {
            hitsByQuery({ 'Test Brand Some Long Episode Title': [], 'Test Brand Some Long Episode': [], 'Test Brand Some Long': [], 'Test Brand Some': [{ id: 'hit1', title: 'Test Brand Some' }] });
            serveEpisodes({ brandPid: episodes('a', 2) });

            const { result, trace } = await withSearchTrace(() => NativeSearchV2Service.search('Test Brand Some Long Episode Title'));

            expect(result).toHaveLength(2);
            expect(trace.retriedAs).toBe('Test Brand Some');
        });

        it('never shortens below two words', async () => {
            hitsByQuery({});
            await NativeSearchV2Service.search('Test Brand');
            expect(axios.get).toHaveBeenCalledTimes(1);
            (axios.get as jest.Mock).mockClear();
            await NativeSearchV2Service.search('One Two Three Four Five Six');
            const queried = (axios.get as jest.Mock).mock.calls.map(([url]) => decodeURIComponent(url.split('q=')[1]));
            expect(queried).toEqual(['One Two Three Four Five Six', 'One Two Three Four Five', 'One Two Three Four', 'One Two Three']);
        });

        it('lists the exact title ahead of titles that merely start with it', async () => {
            // The longer title repeats the words, so lunr alone scores it higher.
            searchHits({ id: 'conf1', title: 'Test Brand Test Brand Test Brand Special' }, { id: 'exact1', title: 'Test Brand' });
            (iplayerDetailsService.findBrandForPid as jest.Mock).mockImplementation(async (ref: string) => `brand-${ref}`);
            serveEpisodes({ 'brand-exact1': episodes('x', 1), 'brand-conf1': episodes('c', 1) });

            const results = await NativeSearchV2Service.search(term);

            expect(results.map(({ pid }) => pid)).toEqual(['x0', 'c0']);
        });

        it('records lookup failures, failed episode pages and the result limit in the trace', async () => {
            searchHits({ id: 'bad1', title: 'Test Brand' }, { id: 'good1', title: 'Test Brand Too' });
            (iplayerDetailsService.findBrandForPid as jest.Mock).mockImplementation((ref: string) =>
                ref == 'bad1' ? Promise.reject(new Error('boom')) : Promise.resolve('brandPid')
            );
            (iplayerDetailsService.getSeriesEpisodesChecked as jest.Mock)
                .mockResolvedValueOnce({ elements: episodes('a', searchResultLimit), failed: false })
                .mockResolvedValueOnce({ elements: [], failed: true });

            const { trace } = await withSearchTrace(() => NativeSearchV2Service.search(term));

            const reasons = trace.candidates.map(({ reason }) => reason);
            expect(reasons).toEqual(expect.arrayContaining(['lookup-failed', 'page-failed', 'result-limit']));
            expect(trace.candidates.find(({ reason }) => reason === 'lookup-failed')?.title).toBe('Test Brand');
        });

        it('records when BBC returned its maximum number of hits', async () => {
            searchHits(...Array.from({ length: 24 }, (_, i) => ({ id: `h${i}`, title: `Test Brand ${i}` })));
            serveEpisodes({ brandPid: [] });

            const { trace } = await withSearchTrace(() => NativeSearchV2Service.search(term));

            expect(trace.candidates.some(({ reason }) => reason === 'hit-cap')).toBe(true);
        });
    });

    it('delegates exemption filtering to Native Search 1.0', async () => {
        const results = [{ title: 'Keep Me' }, { title: 'Drop Me' }] as any;
        const synonym = { exemptions: 'drop' } as any;

        expect(await NativeSearchV2Service.processCompletedSearch(results, term, synonym)).toEqual(
            await NativeSearchService.processCompletedSearch(results, term, synonym)
        );
    });

    describe('branches', () => {
        it('reports a search failure that is not an Error by its value', async () => {
            (axios.get as jest.Mock).mockRejectedValue('network down');
            expect(await NativeSearchV2Service.search(term)).toEqual([]);
            expect(loggingService.error).toHaveBeenCalledWith(expect.stringContaining('network down'));
        });

        it('reports a failed lookup that is not an Error by its value', async () => {
            searchHits({ id: 'bad1', title: 'Test Brand' });
            (iplayerDetailsService.findBrandForPid as jest.Mock).mockRejectedValue('timeout');
            expect(await NativeSearchV2Service.search(term)).toEqual([]);
            expect(loggingService.error).toHaveBeenCalledWith(expect.stringContaining('lookup failed for bad1: timeout'));
        });

        it('searches a series or brand programme itself when it has no parent brand', async () => {
            searchHits({ id: 'seriesHit', title: 'Test Brand' });
            (iplayerDetailsService.findBrandForPid as jest.Mock).mockResolvedValue(undefined);
            (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue({ programme: { type: 'series' } });
            serveEpisodes({ seriesHit: episodes('s', 3) });
            const results = await NativeSearchV2Service.search(term);
            expect(results.map(({ pid }) => pid)).toEqual(['s0', 's1', 's2']);
        });

        it('lists an episode once however many hits lead to it', async () => {
            searchHits({ id: 'lone1', title: 'Test Brand' }, { id: 'lone2', title: 'Test Brand Again' });
            (iplayerDetailsService.findBrandForPid as jest.Mock).mockResolvedValue(undefined);
            (iplayerDetailsService.details as jest.Mock).mockImplementation(() => Promise.resolve([{ title: 'Same', pid: 'samePid', type: 'episode', runtime: 30 }]));
            const results = await NativeSearchV2Service.search(term);
            expect(results.map(({ pid }) => pid)).toEqual(['samePid']);
        });

        it('returns nothing for a term that is only punctuation, without asking the BBC for episodes', async () => {
            searchHits({ id: 'hit1', title: 'Test Brand' });
            expect(await NativeSearchV2Service.search('+++ ---')).toEqual([]);
            expect(iplayerDetailsService.findBrandForPid).not.toHaveBeenCalled();
        });

        it('keeps a hit missing a search word when matching all words is switched off, and drops it otherwise', async () => {
            searchHits({ id: 'hit1', title: 'Test Show' });
            serveEpisodes({ brandPid: episodes('a', 2) });
            const { trace } = await withSearchTrace(() => NativeSearchV2Service.search(term));
            expect(trace.candidates.some(({ reason }) => reason === 'missing-word')).toBe(true);

            jest.spyOn(configService, 'getParameter').mockImplementation(async (key: any) => (key === 'SEARCH_MATCH_ALL_WORDS' ? 'false' : undefined));
            const loose = await NativeSearchV2Service.search('Test Brand');
            jest.restoreAllMocks();
            expect(loose.length).toBeGreaterThan(0);
        });

        describe('when lunr cannot run the query', () => {
            afterEach(() => jest.restoreAllMocks());

            it('treats an unparseable query as no results and logs it', async () => {
                searchHits({ id: 'hit1', title: 'Test Brand' });
                jest.spyOn(lunr.Index.prototype, 'search').mockImplementation(() => {
                    throw Object.assign(new Error('bad query'), { name: 'QueryParseError' });
                });
                expect(await NativeSearchV2Service.search(term)).toEqual([]);
                expect(loggingService.error).toHaveBeenCalledWith(expect.stringContaining('Lunr QueryParseError'));
            });

            it.each([
                ['an error of another kind', new Error('index corrupt')],
                ['a thrown value that is not an object', undefined],
            ])('lets %s through', async (_label, error) => {
                searchHits({ id: 'hit1', title: 'Test Brand' });
                jest.spyOn(lunr.Index.prototype, 'search').mockImplementation(() => {
                    throw error;
                });
                await expect(NativeSearchV2Service.search(term)).rejects.toBe(error);
            });
        });

        it('ignores a nested container with no series number when a season is requested', async () => {
            searchHits({ id: 'hit1', title: 'Test Brand' });
            serveEpisodes({
                brandPid: [{ type: 'series', id: 'specials', title: 'Specials' }, { type: 'series', id: 'seriesTwo', title: 'Series 2' }],
                specials: episodes('sp', 1),
                seriesTwo: episodes('two', 2),
            });
            jest.spyOn(configService, 'getParameter').mockImplementation(async (key: any) => (key === 'NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY' ? 'true' : undefined));
            const results = await runWithSeasonHint(2, () => NativeSearchV2Service.search(term));
            jest.restoreAllMocks();
            expect(results.map(({ pid }) => pid)).toEqual(['two0', 'two1']);
        });
    });

    describe('collections', () => {
        const member = (id: string, extra: Partial<IPlayerEpisodeMetadata> = {}): IPlayerEpisodeMetadata => ({ type: 'episode', id, title: `Film ${id}`, release_date_time: '2025-01-01', ...extra });
        const setConfig = (values: Record<string, string>) =>
            jest.spyOn(configService, 'getParameter').mockImplementation(async (key: any) => values[key]);
        const on = { NATIVE_SEARCH_V2_EXPAND_COLLECTIONS: 'true' };

        afterEach(() => jest.restoreAllMocks());

        it('lists the members of a collection searched by pid, reporting them to onBatch', async () => {
            setConfig(on);
            (iplayerDetailsService.getGroupEpisodes as jest.Mock).mockResolvedValue([member('m1'), member('m2')]);
            const batched: string[] = [];

            const results = await NativeSearchV2Service.search('p096h09x', undefined, (batch) => batched.push(...batch.map(({ pid }) => pid)));

            expect(iplayerDetailsService.getGroupEpisodes).toHaveBeenCalledWith('p096h09x', 1);
            expect(results.map(({ pid }) => pid)).toEqual(['m1', 'm2']);
            expect(batched).toEqual(['m1', 'm2']);
            expect(axios.get).not.toHaveBeenCalled();
        });

        it('accepts a bbc.co.uk link', async () => {
            setConfig(on);
            (iplayerDetailsService.getGroupEpisodes as jest.Mock).mockResolvedValue([member('m1')]);
            const results = await NativeSearchV2Service.search('https://www.bbc.co.uk/programmes/p096h09x');
            expect(iplayerDetailsService.getGroupEpisodes).toHaveBeenCalledWith('p096h09x', 1);
            expect(results).toHaveLength(1);
        });

        it('skips members that are not released episodes, and repeated members', async () => {
            setConfig(on);
            (iplayerDetailsService.getGroupEpisodes as jest.Mock).mockResolvedValue([
                member('m1'),
                member('series1', { type: 'series' }),
                member('undated', { release_date_time: undefined }),
                member('m1'),
            ]);
            const results = await NativeSearchV2Service.search('p096h09x');
            expect(results.map(({ pid }) => pid)).toEqual(['m1']);
        });

        it('drops a duplicate pid that the details lookup returns twice', async () => {
            setConfig(on);
            (iplayerDetailsService.getGroupEpisodes as jest.Mock).mockResolvedValue([member('m1'), member('m2')]);
            (iplayerDetailsService.detailsForEpisodeMetadata as jest.Mock).mockResolvedValue([
                { title: 'A', pid: 'dup', type: 'episode', runtime: 30 },
                { title: 'A', pid: 'dup', type: 'episode', runtime: 30 },
            ]);
            expect((await NativeSearchV2Service.search('p096h09x')).map(({ pid }) => pid)).toEqual(['dup']);
        });

        it('pages through a large collection up to the result limit', async () => {
            setConfig(on);
            const full = Array.from({ length: searchResultLimit }, (_, i) => member(`a${i}`));
            (iplayerDetailsService.getGroupEpisodes as jest.Mock).mockImplementation(async (_pid: string, page: number) => (page === 1 ? full : [member('b0')]));
            const results = await NativeSearchV2Service.search('p096h09x');
            expect(iplayerDetailsService.getGroupEpisodes).toHaveBeenCalledTimes(1);
            expect(results).toHaveLength(searchResultLimit);
        });

        it('reads the next page when the first is full but under the limit of members', async () => {
            setConfig(on);
            const page1 = Array.from({ length: searchResultLimit }, (_, i) => member(`a${i}`, i === 0 ? {} : { type: 'series' }));
            (iplayerDetailsService.getGroupEpisodes as jest.Mock).mockImplementation(async (_pid: string, page: number) => (page === 1 ? page1 : [member('b0')]));
            const results = await NativeSearchV2Service.search('p096h09x');
            expect(iplayerDetailsService.getGroupEpisodes).toHaveBeenCalledTimes(2);
            expect(results.map(({ pid }) => pid)).toEqual(['a0', 'b0']);
        });

        it('falls through to a normal search when the pid is not a collection', async () => {
            setConfig(on);
            (iplayerDetailsService.getGroupEpisodes as jest.Mock).mockResolvedValue([]);
            searchHits({ id: 'hit1', title: 'p096h09x' });
            serveEpisodes({ brandPid: episodes('a', 2) });
            const results = await NativeSearchV2Service.search('p096h09x');
            expect(axios.get).toHaveBeenCalled();
            expect(results).toHaveLength(2);
        });

        it('does not look at pids or links when the option is off', async () => {
            setConfig({ NATIVE_SEARCH_V2_EXPAND_COLLECTIONS: 'false' });
            searchHits();
            expect(await NativeSearchV2Service.search('p096h09x')).toEqual([]);
            expect(iplayerDetailsService.getGroupEpisodes).not.toHaveBeenCalled();
        });

        describe('by name', () => {
            const names = { NATIVE_SEARCH_V2_COLLECTION_NAMES: 'true' };
            const found = (...ids: string[]) => (collectionService.search as jest.Mock).mockResolvedValue(ids.map((id) => ({ id, title: id, count: 1 })));

            it('lists the matching collections ahead of the normal results, without repeats', async () => {
                setConfig(names);
                found('g1');
                (iplayerDetailsService.getGroupEpisodes as jest.Mock).mockResolvedValue([member('m1'), member('a0')]);
                searchHits({ id: 'hit1', title: 'Test Brand' });
                serveEpisodes({ brandPid: episodes('a', 2) });
                const batched: string[] = [];

                const results = await NativeSearchV2Service.search(term, undefined, (batch) => batched.push(...batch.map(({ pid }) => pid)));

                expect(collectionService.search).toHaveBeenCalledWith(term);
                expect(results.map(({ pid }) => pid)).toEqual(['m1', 'a0', 'a1']);
                expect(batched).toEqual(['m1', 'a0', 'a1']);
            });

            it('expands at most three collections', async () => {
                setConfig(names);
                found('g1', 'g2', 'g3', 'g4');
                (iplayerDetailsService.getGroupEpisodes as jest.Mock).mockResolvedValue([member('m1')]);
                searchHits();
                await NativeSearchV2Service.search(term);
                expect((iplayerDetailsService.getGroupEpisodes as jest.Mock).mock.calls.map(([pid]) => pid)).toEqual(['g1', 'g2', 'g3']);
            });

            it('keeps the collection results when the BBC search itself fails', async () => {
                setConfig(names);
                found('g1');
                (iplayerDetailsService.getGroupEpisodes as jest.Mock).mockResolvedValue([member('m1')]);
                (axios.get as jest.Mock).mockRejectedValue(new Error('400'));
                expect((await NativeSearchV2Service.search(term)).map(({ pid }) => pid)).toEqual(['m1']);
            });

            it('carries on with the normal search when no collection matches', async () => {
                setConfig(names);
                found();
                searchHits({ id: 'hit1', title: 'Test Brand' });
                serveEpisodes({ brandPid: episodes('a', 2) });
                expect((await NativeSearchV2Service.search(term)).map(({ pid }) => pid)).toEqual(['a0', 'a1']);
                expect(iplayerDetailsService.getGroupEpisodes).not.toHaveBeenCalled();
            });

            it('never lists a collection\'s contents for a manual search, which shows it as a tile instead', async () => {
                found('g1');
                (iplayerDetailsService.getGroupEpisodes as jest.Mock).mockResolvedValue([member('m1')]);
                searchHits();
                setConfig({ NATIVE_SEARCH_V2_COLLECTION_NAMES: 'false', MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES: 'true' });
                expect(await runInSearchContext('manual', () => NativeSearchV2Service.search(term))).toEqual([]);
                expect(collectionService.search).not.toHaveBeenCalled();

                setConfig({ NATIVE_SEARCH_V2_COLLECTION_NAMES: 'true', MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES: 'true' });
                expect(await runInSearchContext('manual', () => NativeSearchV2Service.search(term))).toEqual([]);
                expect(collectionService.search).not.toHaveBeenCalled();
                expect((await NativeSearchV2Service.search(term)).map(({ pid }) => pid)).toEqual(['m1']);
            });

            it('honours the manual override for pid expansion', async () => {
                (iplayerDetailsService.getGroupEpisodes as jest.Mock).mockResolvedValue([member('m1')]);
                searchHits();
                setConfig({ NATIVE_SEARCH_V2_EXPAND_COLLECTIONS: 'false', MANUAL_NATIVE_SEARCH_V2_EXPAND_COLLECTIONS: 'true' });
                expect((await runInSearchContext('manual', () => NativeSearchV2Service.search('p096h09x'))).map(({ pid }) => pid)).toEqual(['m1']);
                expect(await NativeSearchV2Service.search('p096h09x')).toEqual([]);
            });

            it('does not look for collections when the option is off', async () => {
                setConfig({ NATIVE_SEARCH_V2_COLLECTION_NAMES: 'false' });
                searchHits();
                await NativeSearchV2Service.search(term);
                expect(collectionService.search).not.toHaveBeenCalled();
            });
        });

        it('does not take an ordinary title for a pid', async () => {
            setConfig(on);
            searchHits({ id: 'hit1', title: 'Carnival' });
            serveEpisodes({ brandPid: episodes('a', 1) });
            await NativeSearchV2Service.search('Carnival');
            expect(iplayerDetailsService.getGroupEpisodes).not.toHaveBeenCalled();
        });
    });
});

describe('NativeSearchV2Service when the search cache cannot be written', () => {
    afterEach(() => jest.restoreAllMocks());

    it('still returns the results', async () => {
        jest.spyOn(newSearchCache, 'get').mockResolvedValue(undefined);
        const set = jest.spyOn(newSearchCache, 'set').mockRejectedValue(new Error('disk full'));
        (axios.get as jest.Mock).mockResolvedValue({ status: 200, data: { new_search: { results: [] } } });
        await expect(NativeSearchV2Service.search('Test Brand')).resolves.toEqual([]);
        expect(set).toHaveBeenCalled();
    });
});
