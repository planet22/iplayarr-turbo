import axios from 'axios';

import SkyhookService from '../../src/service/skyhook/SkyhookService';

// src/service/skyhook/SkyhookService.test.ts

jest.mock('axios');
jest.mock('../../src/service/db/dbCacheService');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SkyhookService URL construction', () => {
    let seriesCacheMock: any;
    let episodeCacheMock: any;

    beforeEach(() => {
        seriesCacheMock = {
            get: jest.fn(),
            set: jest.fn(),
        };
        episodeCacheMock = {
            get: jest.fn(),
            set: jest.fn(),
        };
        SkyhookService.skyhookSeriesCache = seriesCacheMock;
        SkyhookService.skyhookEpisodeCache = episodeCacheMock;
        jest.clearAllMocks();
    });

    it('searchSeries constructs correct URL and calls axios.get', async () => {
        const seriesName = 'Breaking Bad';
        seriesCacheMock.get.mockResolvedValue(undefined);
        mockedAxios.get.mockResolvedValue({ data: [{ tvdbId: '123' }] });

        await SkyhookService.searchSeries(seriesName);

        expect(mockedAxios.get).toHaveBeenCalledWith(
            `https://skyhook.sonarr.tv/v1/tvdb/search/en?term=${encodeURIComponent(seriesName)}`
        );
    });

    it('searchSeries uses cache if available and does not call axios', async () => {
        const seriesName = 'Lost';
        seriesCacheMock.get.mockResolvedValue([{ tvdbId: '456' }]);

        await SkyhookService.searchSeries(seriesName);

        expect(mockedAxios.get).not.toHaveBeenCalledWith(
            `https://skyhook.sonarr.tv/v1/tvdb/search/en?term=${seriesName}`
        );
    });

    it('searchSeries falls back to axios when cache fails', async () => {
        const seriesName = 'Breaking Bad';
        seriesCacheMock.get.mockRejectedValue(new Error('Cache error'));
        mockedAxios.get.mockResolvedValue({ data: [{ tvdbId: '123' }] });

        const result = await SkyhookService.searchSeries(seriesName);

        expect(result).toEqual([{ tvdbId: '123' }]);
    });

    it('searchSeries returns empty array when axios fails', async () => {
        const seriesName = 'Breaking Bad';
        seriesCacheMock.get.mockResolvedValue(undefined);
        mockedAxios.get.mockRejectedValue(new Error('Network error'));

        const result = await SkyhookService.searchSeries(seriesName);

        expect(result).toEqual([]);
    });

    it('findEpisode constructs correct URL and calls axios.get on cache miss', async () => {
        const tvdbId = 789;
        const episodeName = 'Pilot';
        episodeCacheMock.get.mockResolvedValue(undefined);
        mockedAxios.get.mockResolvedValue({
            data: { episodes: [{ title: 'Pilot', seasonNumber: 1, episodeNumber: 1 }] }
        });

        await SkyhookService.findEpisode(tvdbId, episodeName);

        expect(mockedAxios.get).toHaveBeenCalledWith(
            `https://skyhook.sonarr.tv/v1/tvdb/shows/en/${tvdbId}`
        );
    });

    it('findEpisode uses cache if available and does not call axios', async () => {
        const tvdbId = 101;
        const episodeName = 'Finale';
        episodeCacheMock.get.mockResolvedValue({
            episodes: [{ title: 'Finale', seasonNumber: 5, episodeNumber: 12 }]
        });

        await SkyhookService.findEpisode(tvdbId, episodeName);

        expect(mockedAxios.get).not.toHaveBeenCalledWith(
            `https://skyhook.sonarr.tv/v1/tvdb/shows/en/${tvdbId}`
        );
    });

    it('findEpisode returns undefined if episode not found', async () => {
        const tvdbId = 202;
        const episodeName = 'Nonexistent';
        episodeCacheMock.get.mockResolvedValue({
            episodes: [{ title: 'Other', seasonNumber: 1, episodeNumber: 1 }]
        });

        const result = await SkyhookService.findEpisode(tvdbId, episodeName);

        expect(result).toBeUndefined();
    });

    it('findEpisode falls back to axios when cache fails', async () => {
        const tvdbId = 789;
        const episodeName = 'Pilot';
        episodeCacheMock.get.mockRejectedValue(new Error('Cache error'));
        mockedAxios.get.mockResolvedValue({
            data: { episodes: [{ title: 'Pilot', seasonNumber: 1, episodeNumber: 1 }] }
        });

        const result = await SkyhookService.findEpisode(tvdbId, episodeName);

        expect(result).toEqual({ title: 'Pilot', seasonNumber: 1, episodeNumber: 1 });
    });

    it('findEpisode returns undefined when axios fails', async () => {
        const tvdbId = 789;
        const episodeName = 'Pilot';
        episodeCacheMock.get.mockResolvedValue(undefined);
        mockedAxios.get.mockRejectedValue(new Error('Network error'));

        const result = await SkyhookService.findEpisode(tvdbId, episodeName);

        expect(result).toBeUndefined();
    });
});

describe('SkyhookService.getAliases', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        SkyhookService.skyhookSeriesCache = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() } as any;
    });

    it('returns other titles of results that match the searched name', async () => {
        mockedAxios.get.mockResolvedValue({
            data: [
                { title: 'Welsh Language on Tour', originalName: 'Iaith ar Daith', alternateTitles: [{ title: 'Iaith Ar Daith' }, 'Another'] },
                { title: 'Unrelated', originalName: 'Something Else' },
            ],
        });
        expect(await SkyhookService.getAliases('Welsh Language on Tour')).toEqual(['Iaith ar Daith', 'Another']);
    });

    it('is empty when nothing matches or the lookup fails', async () => {
        mockedAxios.get.mockResolvedValue({ data: [{ title: 'Other', originalName: 'X' }] });
        expect(await SkyhookService.getAliases('Welsh Language on Tour')).toEqual([]);
        mockedAxios.get.mockRejectedValue(new Error('down'));
        expect(await SkyhookService.getAliases('Welsh Language on Tour')).toEqual([]);
        expect(await SkyhookService.getAliases('  ')).toEqual([]);
    });
});


describe('SkyhookService.lookupByAirDate', () => {
    const show = {
        episodes: [
            { title: 'Pilot', airDate: '2020-01-05', seasonNumber: 1, episodeNumber: 1 },
            { title: 'Part A', airDate: '2020-01-12', seasonNumber: 1, episodeNumber: 2 },
            { title: 'Part B', airDate: '2020-01-12', seasonNumber: 1, episodeNumber: 3 },
        ],
    };

    beforeEach(() => {
        jest.clearAllMocks();
        SkyhookService.skyhookSeriesCache = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() } as any;
        SkyhookService.skyhookEpisodeCache = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() } as any;
        mockedAxios.get.mockImplementation(async (url: string) =>
            url.includes('/search/') ? { data: [{ tvdbId: '9', title: 'Other' }, { tvdbId: '7', title: 'Some Show' }] } : { data: show }
        );
    });

    it('matches a single episode on the date, only within the correctly titled show', async () => {
        expect(await SkyhookService.lookupByAirDate('Some Show', '2020-01-05')).toEqual({ series: 1, episode: 1 });
        expect(mockedAxios.get).toHaveBeenCalledWith('https://skyhook.sonarr.tv/v1/tvdb/shows/en/7');
        expect(mockedAxios.get).not.toHaveBeenCalledWith('https://skyhook.sonarr.tv/v1/tvdb/shows/en/9');
    });

    it('uses the episode title to split a same-day double bill, else gives up', async () => {
        expect(await SkyhookService.lookupByAirDate('Some Show', '2020-01-12', 'part b')).toEqual({ series: 1, episode: 3 });
        expect(await SkyhookService.lookupByAirDate('Some Show', '2020-01-12', 'Unknown')).toBeUndefined();
        expect(await SkyhookService.lookupByAirDate('Some Show', '2020-01-12')).toBeUndefined();
    });

    it('returns nothing for a date with no episode', async () => {
        expect(await SkyhookService.lookupByAirDate('Some Show', '1999-01-01')).toBeUndefined();
    });
});

describe('SkyhookService branches', () => {
    let seriesCacheMock: any;
    let episodeCacheMock: any;

    beforeEach(() => {
        seriesCacheMock = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };
        episodeCacheMock = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };
        SkyhookService.skyhookSeriesCache = seriesCacheMock;
        SkyhookService.skyhookEpisodeCache = episodeCacheMock;
        jest.clearAllMocks();
    });

    const route = (table: Record<string, unknown>) =>
        mockedAxios.get.mockImplementation(async (url: string) => {
            const key = Object.keys(table).find((k) => url.includes(k));
            if (!key) throw new Error(`unrouted ${url}`);
            return { data: table[key] };
        });

    describe('a response that is not a list of series', () => {
        it.each([[{ message: 'rate limited' }], ['<html>maintenance</html>'], [null]])('searchSeries gives an empty list for %j and caches nothing', async (data) => {
            mockedAxios.get.mockResolvedValue({ data });
            expect(await SkyhookService.searchSeries('Some Show')).toEqual([]);
            expect(seriesCacheMock.set).not.toHaveBeenCalled();
        });

        it('lookups carry on rather than failing the search', async () => {
            mockedAxios.get.mockResolvedValue({ data: { message: 'rate limited' } });
            await expect(SkyhookService.lookupSeriesDetails('Some Show', 'Episode')).resolves.toBeUndefined();
            await expect(SkyhookService.getAliases('Some Show')).resolves.toEqual([]);
            await expect(SkyhookService.lookupByAirDate('Some Show', '2024-05-01')).resolves.toBeUndefined();
        });
    });

    describe('lookupSeriesDetails', () => {
        it('returns the season and episode of the first series that has the episode', async () => {
            route({
                'search/en': [{ tvdbId: '1' }, { tvdbId: '2' }],
                'shows/en/1': { episodes: [{ title: 'Other', seasonNumber: 1, episodeNumber: 1 }] },
                'shows/en/2': { episodes: [{ title: 'Wanted', seasonNumber: 3, episodeNumber: 4 }] },
            });
            expect(await SkyhookService.lookupSeriesDetails('Show', 'Wanted')).toEqual({ series: 3, episode: 4 });
        });

        it('returns nothing when no series has it', async () => {
            route({ 'search/en': [{ tvdbId: '1' }], 'shows/en/1': { episodes: [] } });
            expect(await SkyhookService.lookupSeriesDetails('Show', 'Missing')).toBeUndefined();
        });
    });

    describe('getAliases', () => {
        it('gives nothing for a name with no letters or digits, without searching', async () => {
            expect(await SkyhookService.getAliases('!!!')).toEqual([]);
            expect(await SkyhookService.getAliases(undefined as any)).toEqual([]);
            expect(mockedAxios.get).not.toHaveBeenCalled();
        });

        it('collects other names from results that match, from whichever alias field they use', async () => {
            route({
                'search/en': [
                    { title: 'Wanted Show', originalName: 'Original', alternativeTitles: [{ title: 'Alias One' }, 'Alias Two', 7] },
                    { title: 'Unrelated', originalName: 'Nope' },
                    { title: 'Wanted Show', aliases: ['Alias Three'], originalTitle: 'Alias One' },
                    null,
                ],
            });
            expect(await SkyhookService.getAliases('Wanted Show', 10)).toEqual(['Original', 'Alias One', 'Alias Two', 'Alias Three']);
        });

        it('stops at the limit', async () => {
            route({ 'search/en': [{ title: 'Wanted Show', alternateTitles: [{ title: 'A' }, { title: 'B' }, { title: 'C' }, { title: 'D' }] }] });
            expect(await SkyhookService.getAliases('Wanted Show', 2)).toEqual(['A', 'B']);
        });
    });

    describe('lookupByAirDate', () => {
        const show = (episodes: object[]) => ({ 'search/en': [{ tvdbId: '1', title: 'Wanted Show' }], 'shows/en/1': { episodes } });
        const aired = (title: string, season: number, episode: number, airDate = '2024-05-01T20:00:00Z') => ({ title, seasonNumber: season, episodeNumber: episode, airDate });

        it('gives nothing for a name with no letters or digits', async () => {
            expect(await SkyhookService.lookupByAirDate('???', '2024-05-01')).toBeUndefined();
        });

        it('finds the one episode that aired that day', async () => {
            route(show([aired('A', 1, 2), aired('B', 1, 3, '2024-05-02T20:00:00Z')]));
            expect(await SkyhookService.lookupByAirDate('Wanted Show', '2024-05-01')).toEqual({ series: 1, episode: 2 });
        });

        it('uses the episode title to choose between several that day, and gives up when it cannot', async () => {
            route(show([aired('First', 1, 2), aired('Second', 1, 3)]));
            expect(await SkyhookService.lookupByAirDate('Wanted Show', '2024-05-01', 'Second')).toEqual({ series: 1, episode: 3 });
            expect(await SkyhookService.lookupByAirDate('Wanted Show', '2024-05-01', 'Third')).toBeUndefined();
            expect(await SkyhookService.lookupByAirDate('Wanted Show', '2024-05-01')).toBeUndefined();
        });

        it('ignores a show with no episode that day, a show that does not match, and a show that cannot be read', async () => {
            route({
                'search/en': [{ tvdbId: '9', title: 'Another Show' }, { tvdbId: '2', title: 'Wanted Show' }, { tvdbId: '1', originalName: 'Wanted Show', alternateTitles: ['Alias', { title: 'Other' }] }],
                'shows/en/2': { episodes: [aired('Off', 1, 1, '2024-06-01T00:00:00Z'), { title: 'No date', seasonNumber: 1, episodeNumber: 2 }, { title: 'No season', airDate: '2024-05-01' }] },
                'shows/en/1': { episodes: [aired('On', 2, 5)] },
            });
            expect(await SkyhookService.lookupByAirDate('Wanted Show', '2024-05-01')).toEqual({ series: 2, episode: 5 });
        });

        it('copes with a show whose record has no episode list', async () => {
            route({ 'search/en': [{ tvdbId: '1', title: 'Wanted Show' }], 'shows/en/1': {} });
            expect(await SkyhookService.lookupByAirDate('Wanted Show', '2024-05-01')).toBeUndefined();
        });
    });
});

