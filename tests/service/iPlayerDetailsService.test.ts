import axios from 'axios';

import episodeDetailsCache from '../../src/service/episodeDetailsCache';
import iplayerDetailsService from '../../src/service/iplayerDetailsService';
import { IPlayerEpisodeMetadata } from '../../src/types/responses/IPlayerMetadataResponse';
import * as Utils from '../../src/utils/Utils';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('../../src/utils/Utils', () => ({
    calculateSeasonAndEpisode: jest.fn(),
}));

describe('iplayerDetailsService', () => {
    const mockProgramme = {
        pid: 'b1234567',
        type: 'episode',
        display_title: { title: 'Display Title' },
        title: 'Fallback Title',
        medium_synopsis: 'Synopsis text',
        ownership: { service: { title: 'BBC One' } },
        categories: [{ title: 'Drama' }],
        versions: [{ duration: 1800 }],
        first_broadcast_date: '2024-12-01',
        image: { pid: 'p09image' },
        parent: {
            programme: {
                pid: 'b7654321',
                type: 'brand',
            },
        },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (Utils.calculateSeasonAndEpisode as jest.Mock).mockReturnValue(['episode', 'E1', 'Ep Title', 'S1']);
    });

    it('episodeDetails returns parsed details', async () => {
        mockedAxios.get.mockResolvedValueOnce({ data: { programme: mockProgramme } });

        const result = await iplayerDetailsService.episodeDetails('b1234567');
        expect(result).toMatchObject({
            pid: 'b1234567',
            title: 'Display Title',
            episode: 'E1',
            series: 'S1',
            episodeTitle: 'Ep Title',
            type: 'episode',
            channel: 'BBC One',
            category: 'Drama',
            description: 'Synopsis text',
            runtime: 30,
            firstBroadcast: '2024-12-01',
            link: 'https://www.bbc.co.uk/programmes/b1234567',
            thumbnail: 'json-api/thumbnail/p09image.jpg',
        });
    });

    it('episodeDetails serves a repeat from the cache without recomputing or refetching', async () => {
        mockedAxios.get.mockResolvedValueOnce({ data: { programme: mockProgramme } });

        const first = await iplayerDetailsService.episodeDetails('b1234567');
        const second = await iplayerDetailsService.episodeDetails('b1234567');

        expect(second).toEqual(first);
        expect(mockedAxios.get).toHaveBeenCalledTimes(1);
        expect(Utils.calculateSeasonAndEpisode).toHaveBeenCalledTimes(1);
    });

    it('episodeDetails recomputes after the details cache is cleared', async () => {
        mockedAxios.get.mockResolvedValue({ data: { programme: mockProgramme } });

        await iplayerDetailsService.episodeDetails('b1234567');
        await episodeDetailsCache.clear();
        await iplayerDetailsService.episodeDetails('b1234567');

        expect(Utils.calculateSeasonAndEpisode).toHaveBeenCalledTimes(2);
    });

    it('details returns array of episode details', async () => {
        const spy = jest.spyOn(iplayerDetailsService, 'episodeDetails').mockResolvedValueOnce({ pid: '1' } as any);
        const result = await iplayerDetailsService.details(['1']);
        expect(result).toEqual([{ pid: '1' }]);
        expect(spy).toHaveBeenCalledWith('1', expect.anything());
    });

    it('detailsForEpisodeMetadata uses release_date_time override', async () => {
        const episode: IPlayerEpisodeMetadata = {
            id: 'b1234567', release_date_time: '2024-01-01',
            type: 'episode',
            title: 'Episode Title'  
        };
        jest.spyOn(iplayerDetailsService, 'episodeDetails').mockResolvedValueOnce({ pid: 'b1234567' } as any);
        const result = await iplayerDetailsService.detailsForEpisodeMetadata([episode]);
        expect(result[0].firstBroadcast).toBe('2024-01-01');
    });

    it('getMetadata remembers a 404 so the id is not re-fetched from BBC', async () => {
        const notFound = { isAxiosError: true, response: { status: 404 } };
        mockedAxios.isAxiosError.mockReturnValue(true);
        mockedAxios.get.mockRejectedValue(notFound);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);

        await expect(iplayerDetailsService.getMetadata('bbc_two_england')).rejects.toBeDefined();
        await expect(iplayerDetailsService.getMetadata('bbc_two_england')).rejects.toThrow('cached 404');

        expect(mockedAxios.get).toHaveBeenCalledTimes(1);
        iplayerDetailsService.notFound.clear();
    });

    it('getMetadata returns data from axios', async () => {
        mockedAxios.get.mockResolvedValueOnce({ data: { programme: mockProgramme } });
        const result = await iplayerDetailsService.getMetadata('b1234567');
        expect(result.programme.pid).toBe('b1234567');
    });

    it('getMetadata rejects the BBC error page (HTML) and does not cache it', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        mockedAxios.isAxiosError.mockReturnValue(false);
        mockedAxios.get.mockResolvedValueOnce({ data: '<!DOCTYPE html><title>BBC: Service Temporarily Unavailable</title>' });

        await expect(iplayerDetailsService.getMetadata('errpage01')).rejects.toThrow('temporarily unavailable');

        // Once the BBC recovers the same pid loads normally - nothing bad was remembered.
        mockedAxios.get.mockResolvedValueOnce({ data: { programme: mockProgramme } });
        const result = await iplayerDetailsService.getMetadata('errpage01');
        expect(result.programme.pid).toBe('b1234567');
        expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    it('getMetadata replaces an error page that an earlier version cached', async () => {
        mockedAxios.isAxiosError.mockReturnValue(false);
        await iplayerDetailsService.metadataCache.set('poisoned1', '<html>error</html>' as any);
        mockedAxios.get.mockResolvedValueOnce({ data: { programme: mockProgramme } });

        const result = await iplayerDetailsService.getMetadata('poisoned1');

        expect(result.programme.pid).toBe('b1234567');
        expect(await iplayerDetailsService.metadataCache.get('poisoned1')).toEqual({ programme: mockProgramme });
    });

    it('findBrandForPid returns pid when type is brand', async () => {
        mockedAxios.get.mockResolvedValueOnce({
            data: { programme: { pid: 'brandpid', type: 'brand' } },
        });
        const result = await iplayerDetailsService.findBrandForPid('brandpid');
        expect(result).toBe('brandpid');
    });

    it('findBrandForPid recurses to find brand', async () => {
        mockedAxios.get
            .mockResolvedValueOnce({
                data: { programme: { pid: 'childpid', type: 'episode', parent: { programme: { pid: 'parentpid' } } } },
            })
            .mockResolvedValueOnce({
                data: { programme: { pid: 'parentpid', type: 'brand' } },
            });

        const result = await iplayerDetailsService.findBrandForPid('childpid');
        expect(result).toBe('parentpid');
    });

    it('findBrandForPid returns undefined if no brand found', async () => {
        mockedAxios.get.mockResolvedValueOnce({
            data: { programme: { pid: 'p1', type: 'episode' } },
        });
        const result = await iplayerDetailsService.findBrandForPid('p1');
        expect(result).toBeUndefined();
    });

    it('getSeriesEpisodes returns episode list', async () => {
        mockedAxios.get.mockResolvedValueOnce({
            data: {
                programme_episodes: {
                    elements: [{ id: 'e1' }, { id: 'e2' }],
                },
            },
        });
        const result = await iplayerDetailsService.getSeriesEpisodes('b1234567');
        expect(result).toHaveLength(2);
    });

    it('getSeriesEpisodes requests the given page and page size', async () => {
        mockedAxios.get.mockResolvedValueOnce({ data: { programme_episodes: { elements: [] } } });
        await iplayerDetailsService.getSeriesEpisodes('b1234567', 3, 30);
        expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('per_page=30&page=3'));
    });

    it('getSeriesEpisodes defaults to the search result limit on page 1', async () => {
        mockedAxios.get.mockResolvedValueOnce({ data: { programme_episodes: { elements: [] } } });
        await iplayerDetailsService.getSeriesEpisodes('b1234567');
        const url = mockedAxios.get.mock.calls[mockedAxios.get.mock.calls.length - 1][0] as string;
        expect(url).toContain('per_page=150');
        expect(url).not.toContain('&page=');
    });

    it('getSeriesEpisodes serves a repeat request from the cache', async () => {
        mockedAxios.get.mockResolvedValueOnce({ data: { programme_episodes: { elements: [{ id: 'e1' }] } } });
        await iplayerDetailsService.getSeriesEpisodes('b9999999');
        const again = await iplayerDetailsService.getSeriesEpisodes('b9999999');
        expect(again).toEqual([{ id: 'e1' }]);
        expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('getSeriesEpisodes does not cache a failed request', async () => {
        mockedAxios.get.mockRejectedValueOnce(new Error('down'));
        expect(await iplayerDetailsService.getSeriesEpisodes('b8888888')).toEqual([]);
        mockedAxios.get.mockResolvedValueOnce({ data: { programme_episodes: { elements: [{ id: 'e2' }] } } });
        expect(await iplayerDetailsService.getSeriesEpisodes('b8888888')).toEqual([{ id: 'e2' }]);
    });

    describe('getSeriesEpisodesChecked', () => {
        const ok = { data: { programme_episodes: { elements: [{ id: 'e1' }] } } };

        // The database-backed cache can't run under fake timers, so stub it out here.
        beforeEach(() => {
            jest.spyOn(iplayerDetailsService.episodesCache, 'get').mockResolvedValue(undefined);
            jest.spyOn(iplayerDetailsService.episodesCache, 'set').mockResolvedValue(undefined);
            jest.useFakeTimers();
        });
        afterEach(() => {
            jest.useRealTimers();
            jest.restoreAllMocks();
        });

        it('backs off and retries after a 429, then succeeds', async () => {
            const rateLimited = Object.assign(new Error('429'), { isAxiosError: true, response: { status: 429, headers: { 'retry-after': '2' } } });
            mockedAxios.isAxiosError.mockImplementation((e: any) => !!e?.isAxiosError);
            mockedAxios.get.mockRejectedValueOnce(rateLimited).mockResolvedValueOnce(ok);

            const pending = iplayerDetailsService.getSeriesEpisodesChecked('b1234567');
            await jest.advanceTimersByTimeAsync(2000);

            await expect(pending).resolves.toEqual({ elements: [{ id: 'e1' }], failed: false });
            expect(mockedAxios.get).toHaveBeenCalledTimes(2);
        });

        it('still retries an unexpected (non-HTTP) failure once and reports failed when it persists', async () => {
            mockedAxios.isAxiosError.mockReturnValue(false);
            mockedAxios.get.mockRejectedValue(new Error('bad shape'));

            const pending = iplayerDetailsService.getSeriesEpisodesChecked('b1234567');
            await jest.advanceTimersByTimeAsync(10000);

            await expect(pending).resolves.toEqual({ elements: [], failed: true });
            expect(mockedAxios.get).toHaveBeenCalledTimes(3);
        });
    });

    it('getSeriesEpisodes returns [] on error', async () => {
        mockedAxios.get.mockRejectedValueOnce(new Error('fail'));
        const result = await iplayerDetailsService.getSeriesEpisodes('badid');
        expect(result).toEqual([]);
    });

    it('findBrandForUrl extracts pid and resolves brand', async () => {
        const spy = jest.spyOn(iplayerDetailsService, 'findBrandForPid').mockResolvedValueOnce('b0000001');
        const result = await iplayerDetailsService.findBrandForUrl('https://www.bbc.co.uk/programmes/b0000001/episodes');
        expect(result).toBe('b0000001');
        expect(spy).toHaveBeenCalledWith('b0000001');
    });

    it('findBrandForUrl returns undefined if pid not found', async () => {
        const result = await iplayerDetailsService.findBrandForUrl('https://invalid.url/withoutpid');
        expect(result).toBeUndefined();
    });
});
