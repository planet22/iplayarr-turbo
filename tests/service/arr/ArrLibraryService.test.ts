import axios from 'axios';

import arrLibraryService from '../../../src/service/arr/ArrLibraryService';
import { App } from '../../../src/types/App';
import { AppType } from '../../../src/types/AppType';

jest.mock('axios');
const mockedAxios = jest.mocked(axios);

const sonarr = { id: 's', api_key: 'key', url: 'http://sonarr', type: AppType.SONARR } as any as App;
const radarr = { id: 'r', api_key: 'key', url: 'http://radarr', type: AppType.RADARR } as any as App;
const options = { rootFolderPath: '/tv', qualityProfileId: 4 };

describe('ArrLibraryService', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        mockedAxios.isAxiosError.mockImplementation((e: any): e is any => !!e?.isAxiosError);
    });

    it('supports only configured Sonarr/Radarr apps', () => {
        expect(arrLibraryService.supports(sonarr)).toBe(true);
        expect(arrLibraryService.supports(radarr)).toBe(true);
        expect(arrLibraryService.supports({ ...sonarr, api_key: undefined } as any)).toBe(false);
        expect(arrLibraryService.supports({ ...sonarr, type: AppType.PROWLARR } as any)).toBe(false);
    });

    it('lookup maps results, flags existing entries and drops ones without an external id', async () => {
        mockedAxios.get.mockResolvedValue({
            data: [
                { tvdbId: 11, title: 'A', year: 2020, overview: 'o', id: 0, images: [{ coverType: 'poster', remoteUrl: 'http://p' }] },
                { tvdbId: 12, title: 'B', id: 9 },
                { title: 'no id' },
            ],
        });
        const items = await arrLibraryService.lookup(sonarr, 'a b');
        expect(mockedAxios.get).toHaveBeenCalledWith('http://sonarr/api/v3/series/lookup?term=a%20b', { headers: { 'X-Api-Key': 'key' } });
        expect(items).toEqual([
            { externalId: 11, title: 'A', year: 2020, overview: 'o', poster: 'http://p', existingId: undefined },
            { externalId: 12, title: 'B', year: undefined, overview: undefined, poster: undefined, existingId: 9 },
        ]);
    });

    it('lookup passes through network, status, runtime, genres, rating, certification and seasons', async () => {
        mockedAxios.get.mockResolvedValue({
            data: [
                {
                    tvdbId: 11,
                    title: 'A',
                    network: 'BBC One',
                    status: 'continuing',
                    runtime: 58,
                    genres: ['Drama'],
                    ratings: { value: 8.4 },
                    certification: 'TV-MA',
                    seasons: [{ seasonNumber: 0 }, { seasonNumber: 1 }, { seasonNumber: 2 }],
                    imdbId: 'tt1',
                },
            ],
        });
        expect((await arrLibraryService.lookup(sonarr, 'a'))[0]).toMatchObject({
            network: 'BBC One',
            status: 'continuing',
            runtime: 58,
            genres: ['Drama'],
            rating: 8.4,
            certification: 'TV-MA',
            seasonCount: 2,
            imdbId: 'tt1',
        });
    });

    it('lookup reads Radarr studio and nested ratings', async () => {
        mockedAxios.get.mockResolvedValue({ data: [{ tmdbId: 5, title: 'M', studio: 'BBC Films', ratings: { imdb: { value: 7.1 } } }] });
        expect((await arrLibraryService.lookup(radarr, 'm'))[0]).toMatchObject({ network: 'BBC Films', rating: 7.1 });
    });

    it('lookup uses tmdbId and the movie endpoint for Radarr', async () => {
        mockedAxios.get.mockResolvedValue({ data: [{ tmdbId: 5, title: 'M' }] });
        expect((await arrLibraryService.lookup(radarr, 'm'))[0].externalId).toBe(5);
        expect(mockedAxios.get.mock.calls[0][0]).toBe('http://radarr/api/v3/movie/lookup?term=m');
    });

    it('surfaces arr error messages', async () => {
        mockedAxios.get.mockRejectedValue({ isAxiosError: true, message: 'x', response: { status: 400, data: { message: 'bad key' } } });
        await expect(arrLibraryService.lookup(sonarr, 'a')).rejects.toThrow('bad key');
        await expect(arrLibraryService.getRootFolders(sonarr)).rejects.toThrow('bad key');
        await expect(arrLibraryService.getQualityProfiles(sonarr)).rejects.toThrow('bad key');
    });

    it('lists root folders and quality profiles', async () => {
        mockedAxios.get.mockResolvedValueOnce({ data: [{ path: '/tv', freeSpace: 1, extra: 1 }] });
        mockedAxios.get.mockResolvedValueOnce({ data: [{ id: 4, name: 'HD', extra: 1 }] });
        expect(await arrLibraryService.getRootFolders(sonarr)).toEqual([{ path: '/tv', freeSpace: 1 }]);
        expect(await arrLibraryService.getQualityProfiles(sonarr)).toEqual([{ id: 4, name: 'HD' }]);
    });

    describe('add', () => {
        it('re-fetches the lookup item and posts a Sonarr series', async () => {
            mockedAxios.get.mockResolvedValue({ data: [{ tvdbId: 11, title: 'A', id: 0 }] });
            mockedAxios.post.mockResolvedValue({ data: { id: 77 } });
            expect(await arrLibraryService.add(sonarr, 11, options)).toEqual({ id: 77, created: true });
            expect(mockedAxios.get.mock.calls[0][0]).toBe('http://sonarr/api/v3/series/lookup?term=tvdb%3A11');
            const [url, body] = mockedAxios.post.mock.calls[0] as any;
            expect(url).toBe('http://sonarr/api/v3/series');
            expect(body).toMatchObject({
                tvdbId: 11,
                rootFolderPath: '/tv',
                qualityProfileId: 4,
                monitored: true,
                addOptions: { searchForMissingEpisodes: false },
            });
        });

        it('posts a Radarr movie, optionally searching on add', async () => {
            mockedAxios.get.mockResolvedValue({ data: [{ tmdbId: 5, id: 0 }] });
            mockedAxios.post.mockResolvedValue({ data: { id: 8 } });
            await arrLibraryService.add(radarr, 5, { ...options, searchOnAdd: true });
            const [url, body] = mockedAxios.post.mock.calls[0] as any;
            expect(url).toBe('http://radarr/api/v3/movie');
            expect(body.addOptions).toEqual({ monitor: 'movieOnly', searchForMovie: true });
        });

        it('returns the existing id without posting when already in the library', async () => {
            mockedAxios.get.mockResolvedValue({ data: [{ tvdbId: 11, id: 3 }] });
            expect(await arrLibraryService.add(sonarr, 11, options)).toEqual({ id: 3, created: false });
            expect(mockedAxios.post).not.toHaveBeenCalled();
        });

        it('fails when the lookup does not return the requested id', async () => {
            mockedAxios.get.mockResolvedValue({ data: [{ tvdbId: 99, id: 0 }] });
            await expect(arrLibraryService.add(sonarr, 11, options)).rejects.toThrow('Not found');
        });

        it('surfaces validation errors from the post', async () => {
            mockedAxios.get.mockResolvedValue({ data: [{ tvdbId: 11, id: 0 }] });
            mockedAxios.post.mockRejectedValue({ isAxiosError: true, message: 'x', response: { status: 400, data: [{ errorMessage: 'Path invalid' }] } });
            await expect(arrLibraryService.add(sonarr, 11, options)).rejects.toThrow('Path invalid');
        });
    });

    describe('remove', () => {
        it('deletes without removing files', async () => {
            mockedAxios.delete.mockResolvedValue({});
            await arrLibraryService.remove(sonarr, 77);
            expect(mockedAxios.delete.mock.calls[0][0]).toBe('http://sonarr/api/v3/series/77?deleteFiles=false&addImportListExclusion=false');
        });

        it('ignores a 404 but throws other errors', async () => {
            mockedAxios.delete.mockRejectedValueOnce({ isAxiosError: true, message: 'x', response: { status: 404 } });
            await expect(arrLibraryService.remove(radarr, 1)).resolves.toBeUndefined();
            mockedAxios.delete.mockRejectedValueOnce({ isAxiosError: true, message: 'boom', response: { status: 500 } });
            await expect(arrLibraryService.remove(radarr, 1)).rejects.toThrow('boom');
        });
    });
});
