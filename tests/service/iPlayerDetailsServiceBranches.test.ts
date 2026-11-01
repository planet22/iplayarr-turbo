import axios from 'axios';

import episodeDetailsCache from '../../src/service/episodeDetailsCache';
import iplayerDetailsService from '../../src/service/iplayerDetailsService';
import * as Utils from '../../src/utils/Utils';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('../../src/utils/Utils', () => ({
    calculateSeasonAndEpisode: jest.fn(),
}));

const programme = (over: object = {}) => ({ pid: 'b1234567', type: 'episode', title: 'Plain Title', ...over });
const respondWith = (...programmes: object[]) => {
    let call = 0;
    mockedAxios.get.mockImplementation(async () => ({ data: { programme: programmes[Math.min(call++, programmes.length - 1)] } }));
};

describe('iplayerDetailsService branches', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
        (Utils.calculateSeasonAndEpisode as jest.Mock).mockResolvedValue(['TV', 1, 'Ep', 1]);
    });

    describe('episodeDetails', () => {
        it('copes with a programme that has none of the optional fields', async () => {
            respondWith(programme());
            const details = await iplayerDetailsService.episodeDetails('b1234567');
            expect(details).toMatchObject({
                title: 'Plain Title',
                category: '',
                runtime: 0,
                firstBroadcast: undefined,
                thumbnail: undefined,
                seriesPid: undefined,
                channel: undefined,
                description: undefined,
            });
        });

        it('treats a null first-broadcast date, and an empty category or version list, as absent', async () => {
            respondWith(programme({ first_broadcast_date: null, categories: [], versions: [] }));
            const details = await iplayerDetailsService.episodeDetails('b1234567');
            expect(details).toMatchObject({ firstBroadcast: undefined, category: '', runtime: 0 });
        });

        describe('finding the brand', () => {
            const child = (parentType: string) => programme({ parent: { programme: { pid: 'b0parent', type: parentType } } });

            it('uses a brand parent directly', async () => {
                respondWith(child('brand'));
                expect((await iplayerDetailsService.episodeDetails('b1234567')).seriesPid).toBe('b0parent');
            });

            it('climbs from a series parent to its brand', async () => {
                respondWith(child('series'), { pid: 'b0parent', type: 'series', parent: { programme: { pid: 'b0brand' } } }, { pid: 'b0brand', type: 'brand' });
                expect((await iplayerDetailsService.episodeDetails('b1234567')).seriesPid).toBe('b0brand');
            });

            it('does not cache details when the climb failed, so the gap is retried', async () => {
                respondWith(child('series'));
                jest.spyOn(iplayerDetailsService, 'findBrandForPid').mockRejectedValue(new Error('BBC down'));
                const set = jest.spyOn(episodeDetailsCache, 'set');
                const details = await iplayerDetailsService.episodeDetails('b7654321');
                expect(details.seriesPid).toBeUndefined();
                expect(set).not.toHaveBeenCalled();
            });
        });
    });

    describe('findBrandForPid', () => {
        it('gives up on a programme the BBC returns nothing for', async () => {
            jest.spyOn(iplayerDetailsService, 'getMetadata').mockResolvedValue({ programme: null } as any);
            expect(await iplayerDetailsService.findBrandForPid('b0none')).toBeUndefined();
        });

        it('gives up when the parent is the programme itself, or has been visited', async () => {
            jest.spyOn(iplayerDetailsService, 'getMetadata').mockResolvedValue({ programme: { pid: 'b0self', type: 'series', parent: { programme: { pid: 'b0self' } } } } as any);
            expect(await iplayerDetailsService.findBrandForPid('b0self')).toBeUndefined();
            expect(await iplayerDetailsService.findBrandForPid('b0other', ['b0self'])).toBeUndefined();
        });
    });

    describe('episode lists', () => {
        const page = (elements: unknown) => ({ data: { programme_episodes: { elements } } });

        it('getSeriesEpisodes treats a response with no elements as an empty list rather than caching null', async () => {
            mockedAxios.get.mockResolvedValue(page(null));
            expect(await iplayerDetailsService.getSeriesEpisodes('b0nulls')).toEqual([]);
            expect(await iplayerDetailsService.getSeriesEpisodes('b0nulls')).toEqual([]);
        });

        describe('getSeriesEpisodesChecked', () => {
            it('asks for later pages with &page=, and serves a repeat from its cache', async () => {
                mockedAxios.get.mockResolvedValue(page([{ id: 'e1' }]));
                expect(await iplayerDetailsService.getSeriesEpisodesChecked('b0paged', 2, 10)).toEqual({ elements: [{ id: 'e1' }], failed: false });
                expect(String(mockedAxios.get.mock.calls[0][0])).toContain('per_page=10&page=2');
                mockedAxios.get.mockClear();
                expect(await iplayerDetailsService.getSeriesEpisodesChecked('b0paged', 2, 10)).toEqual({ elements: [{ id: 'e1' }], failed: false });
                expect(mockedAxios.get).not.toHaveBeenCalled();
            });

            it('treats a response with no elements as a loaded, empty page', async () => {
                mockedAxios.get.mockResolvedValue(page(undefined));
                expect(await iplayerDetailsService.getSeriesEpisodesChecked('b0empty')).toEqual({ elements: [], failed: false });
            });
        });
    });
});

describe('iplayerDetailsService when the caches cannot be written', () => {
    const page = (elements: unknown) => ({ data: { programme_episodes: { elements } } });

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
        (Utils.calculateSeasonAndEpisode as jest.Mock).mockResolvedValue(['TV', 1, 'Ep', 1]);
    });

    it('still returns episode details', async () => {
        jest.spyOn(episodeDetailsCache, 'set').mockRejectedValue(new Error('disk full'));
        respondWith(programme());
        expect(await iplayerDetailsService.episodeDetails('b0nowrite')).toMatchObject({ title: 'Plain Title' });
    });

    it('still returns metadata that replaces a bad cached entry', async () => {
        await iplayerDetailsService.metadataCache.set('b0badcache', '<html>' as any);
        jest.spyOn(iplayerDetailsService.metadataCache, 'set').mockRejectedValue(new Error('disk full'));
        mockedAxios.get.mockResolvedValue({ data: { programme: { pid: 'b0badcache' } } });
        expect((await iplayerDetailsService.getMetadata('b0badcache')).programme.pid).toBe('b0badcache');
    });

    it('still returns series episodes', async () => {
        jest.spyOn(iplayerDetailsService.episodesCache, 'set').mockRejectedValue(new Error('disk full'));
        mockedAxios.get.mockResolvedValue(page([{ id: 'e1' }]));
        expect(await iplayerDetailsService.getSeriesEpisodes('b0nowrite1')).toEqual([{ id: 'e1' }]);
        expect(await iplayerDetailsService.getSeriesEpisodesChecked('b0nowrite2')).toEqual({ elements: [{ id: 'e1' }], failed: false });
    });
});
