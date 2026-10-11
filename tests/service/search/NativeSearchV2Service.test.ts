import axios from 'axios';

import { searchResultLimit } from '../../../src/constants/iPlayarrConstants';
import iplayerDetailsService from '../../../src/service/iplayerDetailsService';
import loggingService from '../../../src/service/loggingService';
import NativeSearchService from '../../../src/service/search/NativeSearchService';
import NativeSearchV2Service from '../../../src/service/search/NativeSearchV2Service';
import { IPlayerEpisodeMetadata } from '../../../src/types/responses/IPlayerMetadataResponse';
import { createNZBName, getQualityProfile } from '../../../src/utils/Utils';

jest.mock('axios');
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

    it('delegates exemption filtering to Native Search 1.0', async () => {
        const results = [{ title: 'Keep Me' }, { title: 'Drop Me' }] as any;
        const synonym = { exemptions: 'drop' } as any;

        expect(await NativeSearchV2Service.processCompletedSearch(results, term, synonym)).toEqual(
            await NativeSearchService.processCompletedSearch(results, term, synonym)
        );
    });
});
