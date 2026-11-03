import axios from 'axios';

import episodeDetailsCache from '../../src/service/episodeDetailsCache';
import iplayerDetailsService from '../../src/service/iplayerDetailsService';
import { IPlayerEpisodeMetadata } from '../../src/types/responses/IPlayerMetadataResponse';
import { ProgrammeNotFoundError } from '../../src/utils/upstreamError';
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

    it('detailsForEpisodeMetadata adds when the episode leaves iPlayer and its guidance flag from the listing', async () => {
        const episode: IPlayerEpisodeMetadata = {
            id: 'b1234567',
            type: 'episode',
            title: 'Episode Title',
            guidance: true,
            versions: [
                { kind: 'original', availability: { end: '2026-12-01T00:00:00Z' } },
                { kind: 'signed', availability: { end: '2026-11-15T00:00:00Z' } },
            ],
        };
        jest.spyOn(iplayerDetailsService, 'episodeDetails').mockResolvedValueOnce({ pid: 'b1234567' } as any);
        const [result] = await iplayerDetailsService.detailsForEpisodeMetadata([episode]);
        expect(result.availableUntil).toBe('2026-11-15T00:00:00Z');
        expect(result.guidance).toBe(true);
    });

    it('detailsForEpisodeMetadata leaves them out when the listing has none', async () => {
        const episode: IPlayerEpisodeMetadata = { id: 'b1234567', type: 'episode', title: 'Episode Title', guidance: false };
        jest.spyOn(iplayerDetailsService, 'episodeDetails').mockResolvedValueOnce({ pid: 'b1234567' } as any);
        const [result] = await iplayerDetailsService.detailsForEpisodeMetadata([episode]);
        expect(result).not.toHaveProperty('availableUntil');
        expect(result).not.toHaveProperty('guidance');
    });

    describe('getIblExtras', () => {
        afterEach(() => mockedAxios.get.mockReset());

        it('reads the tagline and running time from the listing API, and serves a repeat from the cache', async () => {
            const pid = 'm00ibl001';
            mockedAxios.get.mockResolvedValue({
                data: { episodes: [{ editorial_subtitle: '8/9 From Palermo', versions: [{ kind: 'original', duration: { value: 'PT43M31.720S' } }] }] },
            });

            expect(await iplayerDetailsService.getIblExtras(pid)).toEqual({ editorialSubtitle: '8/9 From Palermo', durationSeconds: 2612 });
            expect(mockedAxios.get).toHaveBeenCalledWith(`https://ibl.api.bbc.co.uk/ibl/v1/episodes/${pid}?rights=web`);

            mockedAxios.get.mockClear();
            await iplayerDetailsService.getIblExtras(pid);
            expect(mockedAxios.get).not.toHaveBeenCalled();
        });

        it('is empty when the listing has no episode, and when the BBC fails (which is not remembered)', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: { episodes: [] } });
            expect(await iplayerDetailsService.getIblExtras('m00ibl002')).toEqual({});

            const failing = 'm00ibl003';
            mockedAxios.get.mockRejectedValueOnce(new Error('BBC down'));
            expect(await iplayerDetailsService.getIblExtras(failing)).toEqual({});

            mockedAxios.get.mockResolvedValueOnce({ data: { episodes: [{ versions: [{ kind: 'original', duration: { value: 'PT30M' } }] }] } });
            expect(await iplayerDetailsService.getIblExtras(failing)).toEqual({ durationSeconds: 1800 });
        });
    });

    describe('getContributors', () => {
        const castPid = 'm00cast01';
        const programmeWithVersions = {
            programme: { ...mockProgramme, pid: castPid, versions: [{ canonical: 0, pid: 'v-signed', duration: 1, types: ['Sign language'] }, { canonical: 1, pid: 'v-original', duration: 1, types: ['Original version'] }] },
        };
        afterEach(() => mockedAxios.get.mockReset());

        const contributors = [
            { name: 'David Tennant', role: 'Actor', character_name: 'The Doctor' },
            { name: '', role: 'Actor' },
            { role: 'Director' },
            { name: 'Alice Troughton', role: 'Director' },
        ];

        it('reads the original version\'s programme page and keeps only named people', async () => {
            mockedAxios.get.mockImplementation(async (url: string) => {
                if (url === `https://www.bbc.co.uk/programmes/${castPid}.json`) return { data: programmeWithVersions };
                if (url === 'https://www.bbc.co.uk/programmes/v-original.json') return { data: { version: { contributors } } };
                throw new Error(`unexpected ${url}`);
            });

            expect((await iplayerDetailsService.getContributors(castPid)).map((c) => c.name)).toEqual(['David Tennant', 'Alice Troughton']);
        });

        it('serves a repeat from the cache', async () => {
            const pid = 'm00cast02';
            mockedAxios.get.mockImplementation(async (url: string) => {
                if (url === `https://www.bbc.co.uk/programmes/${pid}.json`) return { data: { programme: { ...programmeWithVersions.programme, pid, versions: [{ canonical: 1, pid: 'v-cached', duration: 1, types: [] }] } } };
                return { data: { version: { contributors } } };
            });

            await iplayerDetailsService.getContributors(pid);
            mockedAxios.get.mockClear();
            expect(await iplayerDetailsService.getContributors(pid)).toHaveLength(2);
            expect(mockedAxios.get).not.toHaveBeenCalledWith('https://www.bbc.co.uk/programmes/v-cached.json');
        });

        it('falls back to the first version when none is canonical', async () => {
            const pid = 'm00cast03';
            mockedAxios.get.mockImplementation(async (url: string) => {
                if (url === `https://www.bbc.co.uk/programmes/${pid}.json`) return { data: { programme: { ...programmeWithVersions.programme, pid, versions: [{ canonical: 0, pid: 'v-first', duration: 1, types: [] }] } } };
                if (url === 'https://www.bbc.co.uk/programmes/v-first.json') return { data: { version: { contributors } } };
                throw new Error(`unexpected ${url}`);
            });

            expect(await iplayerDetailsService.getContributors(pid)).toHaveLength(2);
        });

        it('is an empty list when there is no version, no credits, or the BBC fails', async () => {
            const noVersions = 'm00cast04';
            mockedAxios.get.mockResolvedValueOnce({ data: { programme: { ...programmeWithVersions.programme, pid: noVersions, versions: [] } } });
            expect(await iplayerDetailsService.getContributors(noVersions)).toEqual([]);

            const noCredits = 'm00cast05';
            mockedAxios.get.mockImplementation(async (url: string) =>
                url.includes(noCredits)
                    ? { data: { programme: { ...programmeWithVersions.programme, pid: noCredits, versions: [{ canonical: 1, pid: 'v-nocredits', duration: 1, types: [] }] } } }
                    : { data: {} }
            );
            expect(await iplayerDetailsService.getContributors(noCredits)).toEqual([]);

            const down = 'm00cast06';
            mockedAxios.get.mockReset();
            mockedAxios.get.mockRejectedValue(new Error('BBC down'));
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
            expect(await iplayerDetailsService.getContributors(down)).toEqual([]);
        });
    });

    it('getMetadata remembers a 404 so the id is not re-fetched from BBC', async () => {
        const notFound = { isAxiosError: true, response: { status: 404 } };
        mockedAxios.isAxiosError.mockReturnValue(true);
        mockedAxios.get.mockRejectedValue(notFound);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);

        await expect(iplayerDetailsService.getMetadata('bbc_two_england')).rejects.toBeDefined();
        await expect(iplayerDetailsService.getMetadata('bbc_two_england')).rejects.toThrow('cached 404');
        // still a "not found" for the routes (404), not a plain Error (500)
        await expect(iplayerDetailsService.getMetadata('bbc_two_england')).rejects.toBeInstanceOf(ProgrammeNotFoundError);

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

    describe('getGroupEpisodes', () => {
        it('returns the members of a collection from the groups endpoint', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: { group_episodes: { elements: [{ id: 'g1' }, { id: 'g2' }] } } });
            expect(await iplayerDetailsService.getGroupEpisodes('p096h09x')).toEqual([{ id: 'g1' }, { id: 'g2' }]);
            const url = mockedAxios.get.mock.calls[mockedAxios.get.mock.calls.length - 1][0] as string;
            expect(url).toContain('/groups/p096h09x/episodes?rights=web&per_page=150');
            expect(url).not.toContain('&page=');
        });

        it('requests the given page and page size', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: { group_episodes: { elements: [] } } });
            await iplayerDetailsService.getGroupEpisodes('p096h09x', 2, 30);
            expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('per_page=30&page=2'));
        });

        it('serves a repeat request from the cache', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: { group_episodes: { elements: [{ id: 'g1' }] } } });
            await iplayerDetailsService.getGroupEpisodes('p0cached1');
            expect(await iplayerDetailsService.getGroupEpisodes('p0cached1')).toEqual([{ id: 'g1' }]);
            expect(mockedAxios.get).toHaveBeenCalledTimes(1);
        });

        it('is empty for a response without elements', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: {} });
            expect(await iplayerDetailsService.getGroupEpisodes('p0noelem1')).toEqual([]);
        });

        it('is empty, and not cached, when the request fails (not a group)', async () => {
            mockedAxios.get.mockRejectedValueOnce(new Error('404'));
            expect(await iplayerDetailsService.getGroupEpisodes('p0notgrp1')).toEqual([]);
            mockedAxios.get.mockResolvedValueOnce({ data: { group_episodes: { elements: [{ id: 'g3' }] } } });
            expect(await iplayerDetailsService.getGroupEpisodes('p0notgrp1')).toEqual([{ id: 'g3' }]);
        });
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
