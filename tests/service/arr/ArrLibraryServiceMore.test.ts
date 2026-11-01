import axios from 'axios';

import { markAppSeen } from '../../../src/service/appSeen';
import arrLibraryService, { RADARR_MONITOR_OPTIONS, SONARR_MONITOR_OPTIONS } from '../../../src/service/arr/ArrLibraryService';
import { App } from '../../../src/types/App';
import { AppType } from '../../../src/types/AppType';

jest.mock('axios');
jest.mock('../../../src/service/appSeen');
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

    describe('grab history pages in parallel', () => {
        const records = (n: number, from: number) =>
            Array.from({ length: n }, (_, i) => ({ seriesId: from + i, sourceTitle: `r${from + i}`, data: { indexer: 'ix' } }));
        let inFlight = 0;
        let peak = 0;
        const serve = (totalRecords: number) => async (url: string) => {
            const page = Number(/page=(\d+)/.exec(url)![1]);
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 10 - page));
            inFlight--;
            const size = Math.max(0, Math.min(500, totalRecords - (page - 1) * 500));
            return { data: { totalRecords, records: records(size, (page - 1) * 500 + 1) } };
        };

        beforeEach(() => {
            inFlight = 0;
            peak = 0;
        });

        it('asks for the remaining pages together once the first gives the total, keeping order', async () => {
            mockedAxios.get.mockImplementation(serve(2200) as any);
            const onProgress = jest.fn();
            const grabs = await arrLibraryService.getGrabHistory(sonarr, onProgress);
            expect(grabs).toHaveLength(2200);
            expect(grabs[0].arrId).toBe(1);
            expect(grabs[2199].arrId).toBe(2200);
            expect(peak).toBeGreaterThan(1);
            expect(peak).toBeLessThanOrEqual(4);
            expect(onProgress).toHaveBeenLastCalledWith(2200);
        });

        it('stops at the page cap however much history there is', async () => {
            mockedAxios.get.mockImplementation(serve(99_999) as any);
            await arrLibraryService.getGrabHistory(sonarr);
            expect(mockedAxios.get).toHaveBeenCalledTimes(10);
        });

        it('needs only one request for a short history', async () => {
            mockedAxios.get.mockImplementation(serve(120) as any);
            expect(await arrLibraryService.getGrabHistory(sonarr)).toHaveLength(120);
            expect(mockedAxios.get).toHaveBeenCalledTimes(1);
        });

        it('surfaces a failure of the very first page, before anything is asked for in parallel', async () => {
            mockedAxios.get.mockRejectedValue(failure('History unavailable'));
            await expect(arrLibraryService.getGrabHistory(sonarr)).rejects.toThrow('History unavailable');
            expect(mockedAxios.get).toHaveBeenCalledTimes(1);
        });

        it('reads Radarr history by movie, skipping grabs with no id or release name', async () => {
            mockedAxios.get.mockResolvedValue({
                data: {
                    totalRecords: 4,
                    records: [
                        { movieId: 3, sourceTitle: 'Film.2020', data: { indexer: 'ix' } },
                        { movieId: 0, sourceTitle: 'No.Movie' },
                        { movieId: 4 },
                        { movieId: 5, sourceTitle: 'No.Indexer' },
                    ],
                },
            });
            expect(await arrLibraryService.getGrabHistory(radarr)).toEqual([
                { arrId: 3, sourceTitle: 'Film.2020', indexer: 'ix' },
                { arrId: 5, sourceTitle: 'No.Indexer', indexer: undefined },
            ]);
        });

        it('treats a response with no records as empty history', async () => {
            mockedAxios.get.mockResolvedValue({ data: {} });
            expect(await arrLibraryService.getGrabHistory(sonarr)).toEqual([]);
        });

        it('surfaces a page that fails', async () => {
            mockedAxios.get.mockImplementation((async (url: string) => {
                if (url.includes('page=3')) throw failure('History page 3 failed');
                return serve(2200)(url);
            }) as any);
            await expect(arrLibraryService.getGrabHistory(sonarr)).rejects.toThrow('History page 3 failed');
        });
    });

    describe('listLibrary', () => {
        it('lists Sonarr series with their episode counts, skipping entries that have no id yet', async () => {
            mockedAxios.get.mockResolvedValue({
                data: [
                    { id: 1, title: 'A', statistics: { episodeFileCount: 3, episodeCount: 5 } },
                    { id: 0, title: 'Not added' },
                    { id: 2, title: 'B' },
                ],
            });
            expect(await arrLibraryService.listLibrary(sonarr)).toEqual(
                new Map([
                    [1, { title: 'A', have: 3, total: 5 }],
                    [2, { title: 'B', have: 0, total: 0 }],
                ])
            );
        });

        it('lists Radarr movies as one episode each, had once the movie has a file', async () => {
            mockedAxios.get.mockResolvedValue({ data: [{ id: 1, title: 'M', hasFile: true }, { id: 2, title: 'N', hasFile: false }, { id: 3, title: 'O' }] });
            expect(await arrLibraryService.listLibrary(radarr)).toEqual(
                new Map([
                    [1, { title: 'M', have: 1, total: 1 }],
                    [2, { title: 'N', have: 0, total: 1 }],
                    [3, { title: 'O', have: 0, total: 1 }],
                ])
            );
        });

        it('asks the right resource and treats a response that is not a list as an empty library', async () => {
            mockedAxios.get.mockResolvedValue({ data: 'nope' });
            expect((await arrLibraryService.listLibrary(sonarr)).size).toBe(0);
            expect(mockedAxios.get).toHaveBeenCalledWith('http://sonarr/api/v3/series', headers);
            await arrLibraryService.listLibrary(radarr);
            expect(mockedAxios.get).toHaveBeenLastCalledWith('http://radarr/api/v3/movie', headers);
        });

        it('surfaces a failure, and does not record the app as seen', async () => {
            jest.mocked(markAppSeen).mockClear();
            mockedAxios.get.mockRejectedValue(failure('Library unavailable'));
            await expect(arrLibraryService.listLibrary(sonarr)).rejects.toThrow('Library unavailable');
            expect(markAppSeen).not.toHaveBeenCalled();
        });
    });

    describe('every call records the app as seen when it answers', () => {
        beforeEach(() => {
            jest.mocked(markAppSeen).mockClear();
            mockedAxios.get.mockResolvedValue({ data: [] });
            mockedAxios.post.mockResolvedValue({ data: { id: 5 } });
            mockedAxios.put.mockResolvedValue({ data: {} });
            mockedAxios.delete.mockResolvedValue({ data: {} });
        });

        it.each([
            ['lookup', () => arrLibraryService.lookup(sonarr, 'x')],
            ['getRootFolders', () => arrLibraryService.getRootFolders(sonarr)],
            ['getQualityProfiles', () => arrLibraryService.getQualityProfiles(sonarr)],
            ['getTags', () => arrLibraryService.getTags(sonarr)],
            ['searchItem', () => arrLibraryService.searchItem(sonarr, 1)],
            ['getLibraryFiles (Radarr)', () => arrLibraryService.getLibraryFiles(radarr)],
            ['getLibraryFiles (Sonarr)', () => arrLibraryService.getLibraryFiles(sonarr)],
            ['getFilePaths', () => arrLibraryService.getFilePaths(radarr)],
            ['listLibrary', () => arrLibraryService.listLibrary(sonarr)],
            ['getGrabHistory', () => arrLibraryService.getGrabHistory(sonarr)],
            ['unmonitor (Sonarr)', () => arrLibraryService.unmonitor(sonarr, [1])],
            ['unmonitor (Radarr)', () => arrLibraryService.unmonitor(radarr, [1])],
            ['search (Sonarr)', () => arrLibraryService.search(sonarr, [1])],
            ['search (Radarr)', () => arrLibraryService.search(radarr, [1])],
            ['remove', () => arrLibraryService.remove(sonarr, 1)],
        ])('%s', async (_name, call) => {
            await call();
            expect(markAppSeen).toHaveBeenCalledWith(expect.stringMatching(/^[sr]$/));
        });

        it('a title that is already in the library: the lookup answered, so that counts', async () => {
            mockedAxios.get.mockResolvedValue({ data: [{ tvdbId: 5, id: 9 }] });
            expect(await arrLibraryService.add(sonarr, 5, { rootFolderPath: '/tv', qualityProfileId: 1 })).toEqual({ id: 9, created: false });
            expect(markAppSeen).toHaveBeenCalledWith('s');
        });

        it('remove: a 404 (already gone) is still the app answering', async () => {
            mockedAxios.delete.mockRejectedValue({ isAxiosError: true, message: 'gone', response: { status: 404 } });
            await arrLibraryService.remove(sonarr, 1);
            expect(markAppSeen).toHaveBeenCalledWith('s');
        });

        it('nothing is recorded when the call is empty-handed or fails', async () => {
            await arrLibraryService.unmonitor(sonarr, []);
            await arrLibraryService.search(sonarr, []);
            mockedAxios.delete.mockRejectedValue(failure('boom'));
            await expect(arrLibraryService.remove(sonarr, 1)).rejects.toThrow('boom');
            expect(markAppSeen).not.toHaveBeenCalled();
        });
    });

    describe('the app is recorded as seen', () => {
        beforeEach(() => jest.mocked(markAppSeen).mockClear());

        it('after a call it answers', async () => {
            mockedAxios.get.mockResolvedValue({ data: [{ path: '/tv' }] });
            await arrLibraryService.getRootFolders(sonarr);
            expect(markAppSeen).toHaveBeenCalledWith(sonarr.id);
        });

        it('but not after one that fails', async () => {
            mockedAxios.get.mockRejectedValue(failure('down'));
            await expect(arrLibraryService.getRootFolders(sonarr)).rejects.toThrow('down');
            expect(markAppSeen).not.toHaveBeenCalled();
        });
    });

    describe('getGrabHistory', () => {
        it('reports how many history records have been read, page by page', async () => {
            const records = (n: number) => Array.from({ length: n }, (_, i) => ({ seriesId: i + 1, sourceTitle: `r${i}`, data: { indexer: 'ix' } }));
            mockedAxios.get.mockResolvedValueOnce({ data: { records: records(500) } }).mockResolvedValueOnce({ data: { records: records(20) } });
            const onProgress = jest.fn();
            const grabs = await arrLibraryService.getGrabHistory(sonarr, onProgress);
            expect(grabs).toHaveLength(520);
            expect(onProgress.mock.calls).toEqual([[500], [520]]);
        });
    });

    describe('getLibraryFiles with many Sonarr series', () => {
        const series = Array.from({ length: 20 }, (_, i) => ({ id: i + 1 }));
        let inFlight = 0;
        let peak = 0;
        const answer = async (url: string) => {
            if (url.endsWith('/series')) return { data: series };
            inFlight++;
            peak = Math.max(peak, inFlight);
            // Later series answer faster, so finishing order differs from library order.
            await new Promise((resolve) => setTimeout(resolve, 20 - Number(/seriesId=(\d+)/.exec(url)?.[1] ?? 0)));
            inFlight--;
            const id = Number(/seriesId=(\d+)/.exec(url)![1]);
            return url.includes('episodefile?') ? { data: [{ id: id * 10, path: `/tv/s${id}.mkv` }] } : { data: [{ id: id * 100, episodeFileId: id * 10 }] };
        };

        beforeEach(() => {
            inFlight = 0;
            peak = 0;
            mockedAxios.get.mockImplementation(answer as any);
        });

        it('reads several series at once, but no more than the limit', async () => {
            await arrLibraryService.getLibraryFiles(sonarr);
            expect(peak).toBeGreaterThan(2);
            // Two requests per series, six series at a time.
            expect(peak).toBeLessThanOrEqual(12);
        });

        it('keeps library order and counts progress as series finish', async () => {
            const onProgress = jest.fn();
            const files = await arrLibraryService.getLibraryFiles(sonarr, onProgress);
            expect(files.map(({ arrId }) => arrId)).toEqual(series.map(({ id }) => id));
            expect(files[3]).toMatchObject({ path: '/tv/s4.mkv', ids: [400] });
            expect(onProgress).toHaveBeenCalledWith(0, 20);
            expect(onProgress).toHaveBeenLastCalledWith(20, 20);
        });

        it('stops and surfaces the failure when a series cannot be read', async () => {
            mockedAxios.get.mockImplementation((async (url: string) => {
                if (url.includes('seriesId=3')) throw failure('Series 3 unreadable');
                return answer(url);
            }) as any);
            await expect(arrLibraryService.getLibraryFiles(sonarr)).rejects.toThrow('Series 3 unreadable');
        });
    });

    describe('getLibraryFiles', () => {
        it('carries the series/movie id, release group and scene name for each file', async () => {
            mockedAxios.get.mockResolvedValue({
                data: [{ id: 7, movieFile: { path: '/m/a.mkv', releaseGroup: 'BBCiPlayarrTurbo', sceneName: 'A.1080p-BBCiPlayarrTurbo', dateAdded: '2026-10-30T10:00:00Z' } }, { id: 8, movieFile: { path: '/m/b.mkv', releaseGroup: '' } }],
            });
            expect(await arrLibraryService.getLibraryFiles(radarr)).toEqual([
                { path: '/m/a.mkv', ids: [7], arrId: 7, releaseGroup: 'BBCiPlayarrTurbo', sceneName: 'A.1080p-BBCiPlayarrTurbo', dateAdded: '2026-10-30T10:00:00Z' },
                { path: '/m/b.mkv', ids: [8], arrId: 8, releaseGroup: undefined, sceneName: undefined },
            ]);
        });

        it('reads Sonarr episode files the same way and reports per-series progress', async () => {
            mockedAxios.get.mockImplementation(async (url: string) => {
                if (url.endsWith('/series')) return { data: [{ id: 10 }] };
                if (url.includes('episodefile?seriesId=10')) return { data: [{ id: 100, path: '/tv/a.mkv', releaseGroup: 'BBCiPlayarrTurbo', sceneName: 'S' }] };
                return { data: [{ id: 1, episodeFileId: 100 }] };
            });
            const onProgress = jest.fn();
            expect(await arrLibraryService.getLibraryFiles(sonarr, onProgress)).toEqual([
                { path: '/tv/a.mkv', ids: [1], arrId: 10, releaseGroup: 'BBCiPlayarrTurbo', sceneName: 'S' },
            ]);
            expect(onProgress).toHaveBeenCalledWith(0, 1);
        });
    });

    describe('add: the library listing used to resolve a title slug clash', () => {
        it('gives up quietly when the library response is not a list', async () => {
            const raw = { tvdbId: 5, titleSlug: 'dup', id: 0 };
            mockedAxios.get.mockResolvedValueOnce({ data: [raw] }).mockResolvedValueOnce({ data: 'nope' });
            mockedAxios.post.mockRejectedValue(failure('Series with TitleSlug dup already exists'));
            await expect(arrLibraryService.add(sonarr, 5, { rootFolderPath: '/tv', qualityProfileId: 1 })).rejects.toThrow('TitleSlug');
        });

        it('gives up quietly when the library listing itself fails', async () => {
            const raw = { tvdbId: 5, titleSlug: 'dup', id: 0 };
            mockedAxios.get.mockResolvedValueOnce({ data: [raw] }).mockRejectedValueOnce(failure('library down'));
            mockedAxios.post.mockRejectedValue(failure('Series with TitleSlug dup already exists'));
            await expect(arrLibraryService.add(sonarr, 5, { rootFolderPath: '/tv', qualityProfileId: 1 })).rejects.toThrow('TitleSlug');
        });

        it('links to the entry that holds the slug when it is there', async () => {
            const raw = { tvdbId: 5, titleSlug: 'dup', id: 0 };
            mockedAxios.get.mockResolvedValueOnce({ data: [raw] }).mockResolvedValueOnce({ data: [{ id: 42, titleSlug: 'dup' }, { id: 0, titleSlug: 'dup' }] });
            mockedAxios.post.mockRejectedValue(failure('Series with TitleSlug dup already exists'));
            expect(await arrLibraryService.add(sonarr, 5, { rootFolderPath: '/tv', qualityProfileId: 1 })).toEqual({ id: 42, created: false });
        });

        it('treats a lookup that is not a list as finding nothing', async () => {
            mockedAxios.get.mockResolvedValue({ data: 'nope' });
            await expect(arrLibraryService.add(sonarr, 5, { rootFolderPath: '/tv', qualityProfileId: 1 })).rejects.toThrow('Not found in the Sonarr/Radarr lookup');
        });
    });
});
