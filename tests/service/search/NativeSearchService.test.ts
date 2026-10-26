import axios from 'axios';
import lunr from 'lunr';

import { searchResultLimit } from '../../../src/constants/iPlayarrConstants';
import configService from '../../../src/service/configService';
import iplayerDetailsService from '../../../src/service/iplayerDetailsService';
import loggingService from '../../../src/service/loggingService';
import NativeSearchService from '../../../src/service/search/NativeSearchService';
import { IPlayerSearchResult, VideoType } from '../../../src/types/IPlayerSearchResult';
import { IPlayerEpisodeMetadata } from '../../../src/types/responses/IPlayerMetadataResponse';
import { Synonym } from '../../../src/types/Synonym';
import { withSearchTrace } from '../../../src/utils/searchTrace';
import { createNZBName, getQualityProfile } from '../../../src/utils/Utils';

jest.mock('axios');
jest.mock('../../../src/service//episodeCacheService');
jest.mock('../../../src/service//iplayerDetailsService');
jest.mock('../../../src/service/loggingService');
jest.mock('../../../src/utils/Utils', () => ({
    ...jest.requireActual('../../../src/utils/Utils'),
    createNZBName: jest.fn(),
    getQualityProfile: jest.fn(),
}));

describe('NativeSearchService', () => {
    let mockSynonym: any;
    let mockSizeFactor: number;
    let mockTerm: string;
    const mockEpisodeDetails = (pid: string, title: string, runtime = 30) => ({
        title,
        pid,
        type: 'episode',
        firstBroadcast: '2025-01-01',
        runtime,
    });

    beforeEach(() => {
        jest.resetAllMocks();
        mockSynonym = { synonymKey: 'synonymValue' };
        mockTerm = 'Test Term';
        mockSizeFactor = 1;

        (getQualityProfile as jest.Mock).mockResolvedValue({ sizeFactor: mockSizeFactor });
        (createNZBName as jest.Mock).mockResolvedValue('testNZBName');
        (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue({
            programme: { type: 'episode' },
        });
    });

    describe('search', () => {
        it('should return search results with valid data', async () => {
            const episodesResponse: IPlayerEpisodeMetadata[] = [
                {
                    type: 'series',
                    id: 'series1234',
                    title: 'Series Title',
                },
                {
                    type: 'episode',
                    id: 'ep1234',
                    title: 'Episode Title',
                    release_date_time: '1990-01-13'
                }
            ];

            (axios.get as jest.Mock).mockResolvedValueOnce({
                status: 200,
                data: {
                    new_search: {
                        results: [{ id: 'testId', title: 'Test Term' }],
                    },
                }
            });

            (iplayerDetailsService.getSeriesEpisodes as jest.Mock).mockResolvedValue(episodesResponse);
            (iplayerDetailsService.findBrandForPid as jest.Mock).mockResolvedValue('testBrandPid');
            (iplayerDetailsService.detailsForEpisodeMetadata as jest.Mock).mockResolvedValue([
                { title: 'Test Title', pid: 'testPid', type: 'episode', firstBroadcast: '2025-01-01', runtime: 60 }
            ]);

            const results = await NativeSearchService.search(mockTerm, mockSynonym);

            expect(results).toHaveLength(1); // Expect the result with a release date to be returned
            expect(results[0]).toHaveProperty('title', 'Test Title');
            expect(results[0]).toHaveProperty('pid', 'testPid');
            expect(results[0]).toHaveProperty('nzbName', 'testNZBName');
        });

        it.each(['Him and Her', 'Him & Her', 'Him Her'])(
            'matches a title made only of stop words (e.g. "Him & Her") for the query %s',
            async (query) => {
                (axios.get as jest.Mock).mockResolvedValueOnce({
                    status: 200,
                    data: { new_search: { results: [{ id: 'm000him1', title: 'Him & Her' }] } },
                });
                (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue({ programme: { type: 'episode' } });
                (iplayerDetailsService.findBrandForPid as jest.Mock).mockResolvedValue(undefined);
                (iplayerDetailsService.details as jest.Mock).mockResolvedValue([
                    { title: 'Him & Her', pid: 'm000him1', type: 'episode', firstBroadcast: '2025-01-01', runtime: 30 },
                ]);

                const results = await NativeSearchService.search(query);

                expect(results.map(({ pid }) => pid)).toEqual(['m000him1']);
            }
        );

        it('drops hits that only share some of the query words (e.g. Stickman vs Spider-Man)', async () => {
            (axios.get as jest.Mock).mockResolvedValueOnce({
                status: 200,
                data: {
                    new_search: {
                        results: [
                            { id: 'p0stick1', title: 'Stickman' },
                            { id: 'p0spide1', title: 'Spider-Man' },
                            { id: 'p0moon01', title: 'Man on the Moon' },
                        ],
                    },
                },
            });
            (iplayerDetailsService.findBrandForPid as jest.Mock).mockResolvedValue(undefined);
            (iplayerDetailsService.details as jest.Mock).mockImplementation(async ([pid]: string[]) => [
                { title: pid, pid, type: 'episode', firstBroadcast: '2025-01-01', runtime: 30 },
            ]);

            const results = await NativeSearchService.search('Stickman');

            expect(results.map(({ pid }) => pid)).toEqual(['p0stick1']);
        });

        it('traces why each BBC hit was kept or dropped', async () => {
            (axios.get as jest.Mock).mockResolvedValueOnce({
                status: 200,
                data: {
                    new_search: {
                        results: [
                            { id: 'p0doc001', title: 'Doctor Who' },
                            { id: 'p0doc002', title: 'Doctor Strange' },
                            { id: 'p0misc01', title: 'Gardeners World' },
                        ],
                    },
                },
            });
            (iplayerDetailsService.findBrandForPid as jest.Mock).mockResolvedValue(undefined);
            (iplayerDetailsService.details as jest.Mock).mockResolvedValue([]);

            const { trace } = await withSearchTrace(() => NativeSearchService.search('Doctor Who'));

            const byTitle = Object.fromEntries(trace.candidates.map((c) => [c.title, c]));
            expect(byTitle['Doctor Who']).toMatchObject({ kept: true });
            expect(byTitle['Doctor Strange']).toMatchObject({ kept: false, reason: 'missing-word', detail: 'Missing the word "who"' });
            expect(byTitle['Gardeners World']).toMatchObject({ kept: false, reason: 'no-match' });
        });

        it('should return an empty array when the response status is not 200', async () => {
            (axios.get as jest.Mock).mockResolvedValue({
                status: 500,
                data: {},
            });

            const results = await NativeSearchService.search(mockTerm);

            expect(results).toHaveLength(0); // Should return empty array on failure
        });

        it('should not throw and should return an empty array when the BBC search API rejects (e.g. 400 for an overlong title)', async () => {
            (axios.get as jest.Mock).mockRejectedValue({ message: 'Request failed with status code 400' });

            const results = await NativeSearchService.search(
                'Michael Crawford and Michele Dotrice Remember... Some Mothers Do \'Ave \'Em'
            );

            expect(results).toEqual([]);
        });

        it('should handle the case when there are no results', async () => {
            (axios.get as jest.Mock).mockResolvedValueOnce({
                status: 200,
                data: { new_search: { results: [] } },
            });

            const results = await NativeSearchService.search(mockTerm);

            expect(results).toHaveLength(0); // Should return empty array when no results
        });

        it('should handle episodes without a brand PID', async () => {
            (axios.get as jest.Mock).mockResolvedValueOnce({
                status: 200,
                data: {
                    new_search: {
                        results: [
                            { id: 'episodeId1', title: 'Test Term' },
                            { id: 'episodeId2', title: 'Test Term' }
                        ],
                    },
                }
            });

            (iplayerDetailsService.findBrandForPid as jest.Mock).mockResolvedValue(null);
            (iplayerDetailsService.details as jest.Mock)
                .mockResolvedValueOnce([
                    { title: 'Episode With Date', pid: 'episodeId1', type: 'episode', firstBroadcast: '2025-01-01', runtime: 30 }
                ])
                .mockResolvedValueOnce([
                    { title: 'Episode Without Date', pid: 'episodeId2', type: 'episode', runtime: 30 }
                ]);

            const results = await NativeSearchService.search(mockTerm);

            expect(results).toHaveLength(2); // Should return two results
            expect(results[0]).toHaveProperty('title', 'Episode With Date');
            expect(results[0]).toHaveProperty('pid', 'episodeId1');
            expect(results[0].pubDate).toEqual(new Date('2025-01-01'));
            expect(results[0].size).toBe(1800);
            expect(results[1]).toHaveProperty('title', 'Episode Without Date');
            expect(results[1]).toHaveProperty('pid', 'episodeId2');
            expect(results[1].pubDate).toBeUndefined();
            expect(results[1].size).toBe(1800);
            expect(iplayerDetailsService.details).toHaveBeenCalledTimes(2);
        });

        it('should not fetch duplicate brands', async () => {
            (axios.get as jest.Mock).mockResolvedValueOnce({
                status: 200,
                data: {
                    new_search: {
                        results: [
                            { id: 'episode1', title: 'Test Term Episode 1' },
                            { id: 'episode2', title: 'Test Term Episode 2' },
                            { id: 'episode3', title: 'Test Term Episode 3' }
                        ],
                    },
                }
            });

            (iplayerDetailsService.findBrandForPid as jest.Mock).mockResolvedValue('sameBrandPid');
            (iplayerDetailsService.getSeriesEpisodes as jest.Mock).mockResolvedValue([
                { type: 'episode', id: 'ep1', title: 'Episode 1', release_date_time: '2025-01-01' },
                { type: 'episode', id: 'ep2', title: 'Episode 2', release_date_time: '2025-01-02' }
            ]);
            (iplayerDetailsService.detailsForEpisodeMetadata as jest.Mock).mockResolvedValue([
                { title: 'Episode With Runtime', pid: 'ep1', type: 'episode', firstBroadcast: '2025-01-01', runtime: 30 },
                { title: 'Episode Without Runtime', pid: 'ep2', type: 'episode', firstBroadcast: '2025-01-02' }
            ]);

            const results = await NativeSearchService.search(mockTerm);

            expect(iplayerDetailsService.getSeriesEpisodes).toHaveBeenCalledTimes(1);
            expect(iplayerDetailsService.getSeriesEpisodes).toHaveBeenCalledWith('sameBrandPid');
            expect(results).toHaveLength(2); // Should return two results from the same brand
            expect(results[0].size).toBe(1800);
            expect(results[1].size).toBeUndefined();
        });

        it('should process episodes in chunks when count exceeds chunk size', async () => {
            const manyEpisodes: IPlayerEpisodeMetadata[] = Array.from({ length: 12 }, (_, i) => ({
                type: 'episode',
                id: `ep${i}`,
                title: `Episode ${i}`,
                release_date_time: '2025-01-01'
            }));

            (axios.get as jest.Mock).mockResolvedValueOnce({
                status: 200,
                data: {
                    new_search: {
                        results: [{ id: 'brandId', title: 'Test Term Brand' }],
                    },
                }
            });

            (iplayerDetailsService.findBrandForPid as jest.Mock).mockResolvedValue('testBrandPid');
            (iplayerDetailsService.getSeriesEpisodes as jest.Mock).mockResolvedValue(manyEpisodes);
            (iplayerDetailsService.detailsForEpisodeMetadata as jest.Mock).mockImplementation(
                (episodes: IPlayerEpisodeMetadata[]) => Promise.resolve(
                    episodes.map(ep => ({
                        title: ep.title,
                        pid: ep.id,
                        type: 'episode',
                        firstBroadcast: '2025-01-01',
                        runtime: 30
                    }))
                )
            );

            const results = await NativeSearchService.search(mockTerm);

            expect(iplayerDetailsService.detailsForEpisodeMetadata).toHaveBeenCalledTimes(3);
            expect(results).toHaveLength(12);
        });

        it('should report results to onBatch as each chunk of episodes is resolved', async () => {
            const manyEpisodes: IPlayerEpisodeMetadata[] = Array.from({ length: 12 }, (_, i) => ({
                type: 'episode',
                id: `ep${i}`,
                title: `Episode ${i}`,
                release_date_time: '2025-01-01'
            }));
            (axios.get as jest.Mock).mockResolvedValueOnce({
                status: 200,
                data: { new_search: { results: [{ id: 'brandId', title: 'Test Term Brand' }] } }
            });
            (iplayerDetailsService.findBrandForPid as jest.Mock).mockResolvedValue('testBrandPid');
            (iplayerDetailsService.getSeriesEpisodes as jest.Mock).mockResolvedValue(manyEpisodes);
            (iplayerDetailsService.detailsForEpisodeMetadata as jest.Mock).mockImplementation(
                (eps: IPlayerEpisodeMetadata[]) => Promise.resolve(
                    eps.map(ep => ({ title: ep.title, pid: ep.id, type: 'episode', firstBroadcast: '2025-01-01', runtime: 30 }))
                )
            );

            const batchSizes: number[] = [];
            const results = await NativeSearchService.search(mockTerm, undefined, (batch) => batchSizes.push(batch.length));

            expect(batchSizes).toEqual([5, 5, 2]);
            expect(results).toHaveLength(12);
        });

        describe('paging a brand\'s episode list', () => {
            const episodes = (prefix: string, count: number): IPlayerEpisodeMetadata[] =>
                Array.from({ length: count }, (_, i) => ({
                    type: 'episode',
                    id: `${prefix}${i}`,
                    title: `Episode ${prefix}${i}`,
                    release_date_time: '2025-01-01'
                }));

            const arrange = () => {
                (axios.get as jest.Mock).mockResolvedValueOnce({
                    status: 200,
                    data: { new_search: { results: [{ id: 'brandId', title: 'Test Term Brand' }] } }
                });
                (iplayerDetailsService.findBrandForPid as jest.Mock).mockResolvedValue('testBrandPid');
                (iplayerDetailsService.detailsForEpisodeMetadata as jest.Mock).mockImplementation(
                    (eps: IPlayerEpisodeMetadata[]) => Promise.resolve(
                        eps.map(ep => ({ title: ep.title, pid: ep.id, type: 'episode', firstBroadcast: '2025-01-01', runtime: 30 }))
                    )
                );
            };

            it('should fetch further pages while each page is full', async () => {
                arrange();
                (iplayerDetailsService.getSeriesEpisodes as jest.Mock)
                    .mockResolvedValueOnce(episodes('a', searchResultLimit))
                    .mockResolvedValueOnce(episodes('b', searchResultLimit))
                    .mockResolvedValueOnce(episodes('c', 20));

                const results = await NativeSearchService.search(mockTerm);

                expect(iplayerDetailsService.getSeriesEpisodes).toHaveBeenCalledWith('testBrandPid');
                expect(iplayerDetailsService.getSeriesEpisodes).toHaveBeenCalledWith('testBrandPid', 2);
                expect(iplayerDetailsService.getSeriesEpisodes).toHaveBeenCalledWith('testBrandPid', 3);
                expect(iplayerDetailsService.getSeriesEpisodes).toHaveBeenCalledTimes(3);
                expect(results).toHaveLength(searchResultLimit * 2 + 20);
            });

            it('should not request another page after a short page', async () => {
                arrange();
                (iplayerDetailsService.getSeriesEpisodes as jest.Mock).mockResolvedValueOnce(episodes('a', 40));

                await NativeSearchService.search(mockTerm);

                expect(iplayerDetailsService.getSeriesEpisodes).toHaveBeenCalledTimes(1);
            });

            it('should stop paging at the maximum page count', async () => {
                arrange();
                (iplayerDetailsService.getSeriesEpisodes as jest.Mock).mockImplementation(
                    (_pid: string, page: number = 1) => Promise.resolve(episodes(`p${page}_`, searchResultLimit))
                );

                await NativeSearchService.search(mockTerm);

                expect(iplayerDetailsService.getSeriesEpisodes).toHaveBeenCalledTimes(10);
            });
        });

        it('should limit results to searchResultLimit', async () => {
            const episodesPerBrand: IPlayerEpisodeMetadata[] = Array.from({ length: searchResultLimit + 10 }, (_, i) => ({
                type: 'episode',
                id: `ep${i}`,
                title: `Episode ${i}`,
                release_date_time: '2025-01-01'
            }));

            (axios.get as jest.Mock).mockResolvedValueOnce({
                status: 200,
                data: {
                    new_search: {
                        results: [
                            { id: 'brand1', title: 'Test Term Brand 1' },
                            { id: 'brand2', title: 'Test Term Brand 2' }
                        ],
                    },
                }
            });

            (iplayerDetailsService.findBrandForPid as jest.Mock)
                .mockResolvedValueOnce('brandPid1')
                .mockResolvedValueOnce('brandPid2');
            (iplayerDetailsService.getSeriesEpisodes as jest.Mock).mockResolvedValue(episodesPerBrand);
            (iplayerDetailsService.detailsForEpisodeMetadata as jest.Mock).mockImplementation(
                (episodes: IPlayerEpisodeMetadata[]) => Promise.resolve(
                    episodes.map(ep => ({
                        title: ep.title,
                        pid: ep.id,
                        type: 'episode',
                        firstBroadcast: '2025-01-01',
                        runtime: 30
                    }))
                )
            );

            const results = await NativeSearchService.search(mockTerm);

            expect(results.length).toBeGreaterThan(searchResultLimit); // First brand exceeds limit
            expect(iplayerDetailsService.getSeriesEpisodes).toHaveBeenCalledTimes(1); // Should not process second brand
        });

        it('should expand episodes when search hit is a series/brand container even if brand PID lookup fails', async () => {
            (axios.get as jest.Mock).mockResolvedValueOnce({
                status: 200,
                data: {
                    new_search: { results: [{ id: 'containerPid1', title: mockTerm }] },
                },
            });

            (iplayerDetailsService.findBrandForPid as jest.Mock).mockResolvedValue(null);
            (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue({
                programme: { type: 'series' },
            });

            (iplayerDetailsService.getSeriesEpisodes as jest.Mock).mockResolvedValue([
                { type: 'episode', id: 'ep1', title: 'Episode 1', release_date_time: '2025-01-01' },
            ]);
            (iplayerDetailsService.detailsForEpisodeMetadata as jest.Mock).mockResolvedValue([
                mockEpisodeDetails('ep1', 'Episode 1'),
            ]);

            const results = await NativeSearchService.search(mockTerm);

            expect(iplayerDetailsService.getSeriesEpisodes).toHaveBeenCalledWith('containerPid1');
            expect(results).toHaveLength(1);
            expect(results[0].pid).toBe('ep1');
        });

        it('should include nested container episodes and dedupe by PID', async () => {
            (axios.get as jest.Mock).mockResolvedValueOnce({
                status: 200,
                data: {
                    new_search: { results: [{ id: 'containerPid1', title: mockTerm }] },
                },
            });

            (iplayerDetailsService.findBrandForPid as jest.Mock).mockResolvedValue('containerPid1');

            (iplayerDetailsService.getSeriesEpisodes as jest.Mock)
                .mockResolvedValueOnce([
                    { type: 'episode', id: 'ep1', title: 'Episode 1', release_date_time: '2025-01-01' },
                    { type: 'brand', id: 'childBrand1', title: 'Child Brand' },
                    { type: 'episode', id: 'noDate', title: 'No Date Episode' },
                ])
                .mockResolvedValueOnce([
                    { type: 'episode', id: 'ep1', title: 'Episode 1 Duplicate', release_date_time: '2025-01-01' },
                    { type: 'episode', id: 'ep2', title: 'Episode 2', release_date_time: '2025-01-02' },
                ]);

            (iplayerDetailsService.detailsForEpisodeMetadata as jest.Mock).mockResolvedValue([
                mockEpisodeDetails('ep1', 'Episode 1'),
                mockEpisodeDetails('ep2', 'Episode 2'),
            ]);

            const results = await NativeSearchService.search(mockTerm);

            expect(iplayerDetailsService.getSeriesEpisodes).toHaveBeenCalledTimes(2);
            expect(iplayerDetailsService.getSeriesEpisodes).toHaveBeenNthCalledWith(1, 'containerPid1');
            expect(iplayerDetailsService.getSeriesEpisodes).toHaveBeenNthCalledWith(2, 'childBrand1');
            expect(results.map((r) => r.pid).sort()).toEqual(['ep1', 'ep2']);
        });
    });

    describe('processCompletedSearch', () => {
        it('should return the results unmodified', async () => {
            const mockResults: IPlayerSearchResult[] = [{
                title: 'Test Title', pid: 'testPid',
                number: 1,
                channel: 'Channel 1',
                request: {
                    term: 'term',
                    line: 'line'
                },
                type: VideoType.TV
            }];
            const results = await NativeSearchService.processCompletedSearch(mockResults, mockTerm);

            expect(results).toEqual(mockResults); // Should return the results as they are
        });

        it('should not filter out programmes if synonym has no exemptions', async () => {
            const mockResults: IPlayerSearchResult[] = [{
                title: 'Test Title', pid: 'includePid',
                number: 1,
                channel: 'Channel 1',
                request: {
                    term: 'term',
                    line: 'line'
                },
                type: VideoType.TV
            }, {
                title: 'Exempt1 Title', pid: 'exempt1Pid',
                number: 2,
                channel: 'Channel 1',
                request: {
                    term: 'term',
                    line: 'line'
                },
                type: VideoType.TV
            }, {
                title: 'Exempt2 Title', pid: 'exempt2Pid',
                number: 3,
                channel: 'Channel 1',
                request: {
                    term: 'term',
                    line: 'line'
                },
                type: VideoType.TV
            }];

            const mockSynonym: Synonym = {
                exemptions: '',
                id: 'synonym-1',
                from: 'Title 2025',
                target: 'Title',
            };

            const results = await NativeSearchService.processCompletedSearch(mockResults, mockTerm, mockSynonym);

            expect(results).toEqual(mockResults); // Should return all entries as no exemptions matched
        });

        it('should filter out programmes that match synonym exemptions', async () => {
            const mockResults: IPlayerSearchResult[] = [{
                title: 'Test Title', pid: 'includePid',
                number: 1,
                channel: 'Channel 1',
                request: {
                    term: 'term',
                    line: 'line'
                },
                type: VideoType.TV
            }, {
                title: 'Exempt1 Title', pid: 'exempt1Pid',
                number: 2,
                channel: 'Channel 1',
                request: {
                    term: 'term',
                    line: 'line'
                },
                type: VideoType.TV
            }, {
                title: 'Exempt2 Title', pid: 'exempt2Pid',
                number: 3,
                channel: 'Channel 1',
                request: {
                    term: 'term',
                    line: 'line'
                },
                type: VideoType.TV
            }];

            const mockSynonym: Synonym = {
                exemptions: 'exempt1,exempt2',
                id: 'synonym-1',
                from: 'Title 2025',
                target: 'Title',
            };

            const results = await NativeSearchService.processCompletedSearch(mockResults, mockTerm, mockSynonym);

            expect(results).toEqual([mockResults[0]]); // Should return the first entry, which doesn't match exclusion terms
        });
    });

    describe('branches', () => {
        const hits = (...results: { id: string; title: string }[]) =>
            (axios.get as jest.Mock).mockResolvedValue({ status: 200, data: { new_search: { results } } });

        it('reports a failed BBC request that is not an Error by its value', async () => {
            (axios.get as jest.Mock).mockRejectedValue('network down');
            expect(await NativeSearchService.search('Test Term')).toEqual([]);
            expect(loggingService.error).toHaveBeenCalledWith(expect.stringContaining('network down'));
        });

        it('lists an episode once however many hits lead to it', async () => {
            hits({ id: 'lone1', title: 'Test Term' }, { id: 'lone2', title: 'Test Term Again' });
            (iplayerDetailsService.findBrandForPid as jest.Mock).mockResolvedValue(undefined);
            (iplayerDetailsService.details as jest.Mock).mockResolvedValue([mockEpisodeDetails('samePid', 'Same')]);
            const results = await NativeSearchService.search('Test Term');
            expect(results.map(({ pid }) => pid)).toEqual(['samePid']);
        });

        it('returns nothing for a term that is only punctuation', async () => {
            hits({ id: 'hit1', title: 'Test Term' });
            expect(await NativeSearchService.search('+++ ---')).toEqual([]);
            expect(iplayerDetailsService.findBrandForPid).not.toHaveBeenCalled();
        });

        it('drops a hit that is missing a search word, and says why', async () => {
            hits({ id: 'hit1', title: 'Test Show' });
            const { trace } = await withSearchTrace(() => NativeSearchService.search('Test Term'));
            expect(trace.candidates).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'missing-word', kept: false })]));
        });

        it('keeps a hit that is missing a search word when matching all words is switched off', async () => {
            hits({ id: 'hit1', title: 'Test Show' });
            (iplayerDetailsService.findBrandForPid as jest.Mock).mockResolvedValue(undefined);
            (iplayerDetailsService.details as jest.Mock).mockResolvedValue([mockEpisodeDetails('loose1', 'Loose')]);
            const config = jest.spyOn(configService, 'getParameter').mockImplementation(async (key: any) => (key === 'SEARCH_MATCH_ALL_WORDS' ? 'false' : undefined));
            const results = await NativeSearchService.search('Test Term');
            config.mockRestore();
            expect(results.map(({ pid }) => pid)).toEqual(['loose1']);
        });

        describe('when lunr cannot run the query', () => {
            afterEach(() => jest.restoreAllMocks());

            it('treats an unparseable query as no results and logs it', async () => {
                hits({ id: 'hit1', title: 'Test Term' });
                jest.spyOn(lunr.Index.prototype, 'search').mockImplementation(() => {
                    throw Object.assign(new Error('bad query'), { name: 'QueryParseError' });
                });
                expect(await NativeSearchService.search('Test Term')).toEqual([]);
                expect(loggingService.error).toHaveBeenCalledWith(expect.stringContaining('Lunr QueryParseError'));
            });

            it.each([
                ['an error of another kind', new Error('index corrupt')],
                ['a thrown value that is not an object', undefined],
            ])('lets %s through', async (_label, error) => {
                hits({ id: 'hit1', title: 'Test Term' });
                jest.spyOn(lunr.Index.prototype, 'search').mockImplementation(() => {
                    throw error;
                });
                await expect(NativeSearchService.search('Test Term')).rejects.toBe(error);
            });
        });
    });
});
