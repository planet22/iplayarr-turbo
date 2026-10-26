import axios from 'axios';

import arrLibraryService, { RADARR_MONITOR_OPTIONS, SONARR_MONITOR_OPTIONS } from '../../../src/service/arr/ArrLibraryService';
import { App } from '../../../src/types/App';
import { AppType } from '../../../src/types/AppType';

jest.mock('axios');
const mockedAxios = jest.mocked(axios);

const sonarr = { id: 's', api_key: 'key', url: 'http://sonarr', type: AppType.SONARR } as any as App;
const radarr = { id: 'r', api_key: 'key', url: 'http://radarr', type: AppType.RADARR } as any as App;
const headers = { headers: { 'X-Api-Key': 'key' } };
const failure = (message: string) => ({ isAxiosError: true, message, response: { status: 500, data: [{ errorMessage: message }] } });

describe('ArrLibraryService (files, searches and options)', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        mockedAxios.isAxiosError.mockImplementation((e: any): e is any => !!e?.isAxiosError);
    });

    describe('seasonCount', () => {
        it('counts real seasons (not specials) when no statistics are given, and none when there are none', async () => {
            mockedAxios.get.mockResolvedValue({
                data: [
                    { tvdbId: 1, title: 'A', seasons: [{ seasonNumber: 0 }, { seasonNumber: 1 }, { seasonNumber: 2 }] },
                    { tvdbId: 2, title: 'B', seasons: [{ seasonNumber: 0 }] },
                    { tvdbId: 3, title: 'C', seasons: 'none' },
                    { tvdbId: 4, title: 'D', statistics: { seasonCount: 5 }, seasons: [] },
                ],
            });
            const items = await arrLibraryService.lookup(sonarr, 'x');
            expect(items.map((i) => i.seasonCount)).toEqual([2, undefined, undefined, 5]);
        });
    });

    describe('lists that come back as something else', () => {
        it.each([
            ['getRootFolders', (app: App) => arrLibraryService.getRootFolders(app), 'rootfolder'],
            ['getQualityProfiles', (app: App) => arrLibraryService.getQualityProfiles(app), 'qualityprofile'],
            ['getTags', (app: App) => arrLibraryService.getTags(app), 'tag'],
        ])('%s is empty for a response that is not a list', async (_name, call, endpoint) => {
            mockedAxios.get.mockResolvedValue({ data: { not: 'a list' } });
            expect(await call(sonarr)).toEqual([]);
            expect(mockedAxios.get).toHaveBeenCalledWith(`http://sonarr/api/v3/${endpoint}`, headers);
        });

        it('getTags maps id and label, and surfaces a failure', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: [{ id: 1, label: 'iplayer', extra: true }] });
            expect(await arrLibraryService.getTags(radarr)).toEqual([{ id: 1, label: 'iplayer' }]);
            mockedAxios.get.mockRejectedValueOnce(failure('Tags unavailable'));
            await expect(arrLibraryService.getTags(radarr)).rejects.toThrow('Tags unavailable');
        });

        it('lookup is empty for a response that is not a list', async () => {
            mockedAxios.get.mockResolvedValue({ data: null });
            expect(await arrLibraryService.lookup(radarr, 'x')).toEqual([]);
        });
    });

    it('offers the monitor options for each app type', () => {
        expect(arrLibraryService.monitorOptions(sonarr)).toBe(SONARR_MONITOR_OPTIONS);
        expect(arrLibraryService.monitorOptions(radarr)).toBe(RADARR_MONITOR_OPTIONS);
    });

    describe('searchItem', () => {
        it('searches a whole Sonarr series or a Radarr movie', async () => {
            mockedAxios.post.mockResolvedValue({ data: {} });
            await arrLibraryService.searchItem(sonarr, 7);
            expect(mockedAxios.post).toHaveBeenLastCalledWith('http://sonarr/api/v3/command', { name: 'SeriesSearch', seriesId: 7 }, headers);
            await arrLibraryService.searchItem(radarr, 8);
            expect(mockedAxios.post).toHaveBeenLastCalledWith('http://radarr/api/v3/command', { name: 'MoviesSearch', movieIds: [8] }, headers);
        });

        it('surfaces a failure', async () => {
            mockedAxios.post.mockRejectedValue(failure('Command refused'));
            await expect(arrLibraryService.searchItem(sonarr, 1)).rejects.toThrow('Command refused');
        });
    });

    describe('search for specific episodes or movies', () => {
        it('does nothing for an empty list', async () => {
            await arrLibraryService.search(sonarr, []);
            expect(mockedAxios.post).not.toHaveBeenCalled();
        });

        it('searches episodes in Sonarr and movies in Radarr', async () => {
            mockedAxios.post.mockResolvedValue({ data: {} });
            await arrLibraryService.search(sonarr, [1, 2]);
            expect(mockedAxios.post).toHaveBeenLastCalledWith('http://sonarr/api/v3/command', { name: 'EpisodeSearch', episodeIds: [1, 2] }, headers);
            await arrLibraryService.search(radarr, [3]);
            expect(mockedAxios.post).toHaveBeenLastCalledWith('http://radarr/api/v3/command', { name: 'MoviesSearch', movieIds: [3] }, headers);
        });

        it('surfaces a failure', async () => {
            mockedAxios.post.mockRejectedValue(failure('Search failed'));
            await expect(arrLibraryService.search(radarr, [1])).rejects.toThrow('Search failed');
        });
    });

    describe('unmonitor', () => {
        it('does nothing for an empty list', async () => {
            await arrLibraryService.unmonitor(sonarr, []);
            expect(mockedAxios.put).not.toHaveBeenCalled();
        });

        it('stops monitoring episodes in Sonarr and movies in Radarr', async () => {
            mockedAxios.put.mockResolvedValue({ data: {} });
            await arrLibraryService.unmonitor(sonarr, [1, 2]);
            expect(mockedAxios.put).toHaveBeenLastCalledWith('http://sonarr/api/v3/episode/monitor', { episodeIds: [1, 2], monitored: false }, headers);
            await arrLibraryService.unmonitor(radarr, [3]);
            expect(mockedAxios.put).toHaveBeenLastCalledWith('http://radarr/api/v3/movie/editor', { movieIds: [3], monitored: false }, headers);
        });

        it('surfaces a failure', async () => {
            mockedAxios.put.mockRejectedValue(failure('Cannot edit'));
            await expect(arrLibraryService.unmonitor(sonarr, [1])).rejects.toThrow('Cannot edit');
        });
    });

    describe('getFilePaths', () => {
        it('lists the movie files Radarr has, with the movie id, skipping movies without a file', async () => {
            mockedAxios.get.mockResolvedValue({ data: [{ id: 1, movieFile: { path: '/m/a.strm' } }, { id: 2 }, { id: 3, movieFile: {} }] });
            expect(await arrLibraryService.getFilePaths(radarr)).toEqual([{ path: '/m/a.strm', ids: [1] }]);
        });

        it('treats a non-list Radarr response as empty', async () => {
            mockedAxios.get.mockResolvedValue({ data: 'nope' });
            expect(await arrLibraryService.getFilePaths(radarr)).toEqual([]);
        });

        it('lists each Sonarr series\' files with the episode ids they hold', async () => {
            mockedAxios.get.mockImplementation(async (url: string) => {
                if (url.endsWith('/series')) return { data: [{ id: 10 }, { id: 11 }] };
                if (url.includes('episodefile?seriesId=10')) return { data: [{ id: 100, path: '/tv/a.strm' }, { id: 101, path: '' }, { id: 102, path: '/tv/b.strm' }] };
                if (url.includes('episode?seriesId=10')) return { data: [{ id: 1, episodeFileId: 100 }, { id: 2, episodeFileId: 100 }, { id: 3, episodeFileId: 102 }, { id: 4 }] };
                if (url.includes('seriesId=11')) return { data: [] };
                throw new Error(`unrouted ${url}`);
            });
            expect(await arrLibraryService.getFilePaths(sonarr)).toEqual([
                { path: '/tv/a.strm', ids: [1, 2] },
                { path: '/tv/b.strm', ids: [3] },
            ]);
        });

        it('copes with file or episode lists that are not lists', async () => {
            mockedAxios.get.mockImplementation(async (url: string) => {
                if (url.endsWith('/series')) return { data: [{ id: 10 }, { id: 11 }] };
                if (url.includes('episodefile?seriesId=10')) return { data: null };
                if (url.includes('episodefile?seriesId=11')) return { data: [{ id: 100, path: '/tv/a.strm' }] };
                return { data: 'nope' };
            });
            expect(await arrLibraryService.getFilePaths(sonarr)).toEqual([{ path: '/tv/a.strm', ids: [] }]);
        });

        it('treats a non-list Sonarr series response as empty', async () => {
            mockedAxios.get.mockResolvedValue({ data: {} });
            expect(await arrLibraryService.getFilePaths(sonarr)).toEqual([]);
        });

        it('surfaces a failure', async () => {
            mockedAxios.get.mockRejectedValue(failure('Library unavailable'));
            await expect(arrLibraryService.getFilePaths(radarr)).rejects.toThrow('Library unavailable');
        });
    });

    describe('add: the library listing used to resolve a title slug clash', () => {
        it('gives up quietly when the library response is not a list', async () => {
            const raw = { tvdbId: 5, titleSlug: 'dup', id: 0 };
            mockedAxios.get.mockResolvedValueOnce({ data: [raw] }).mockResolvedValueOnce({ data: 'nope' });
            mockedAxios.post.mockRejectedValue(failure('Series with TitleSlug dup already exists'));
            await expect(arrLibraryService.add(sonarr, 5, { rootFolderPath: '/tv', qualityProfileId: 1 })).rejects.toThrow('TitleSlug');
        });

        it('treats a lookup that is not a list as finding nothing', async () => {
            mockedAxios.get.mockResolvedValue({ data: 'nope' });
            await expect(arrLibraryService.add(sonarr, 5, { rootFolderPath: '/tv', qualityProfileId: 1 })).rejects.toThrow('Not found in the Sonarr/Radarr lookup');
        });
    });
});
