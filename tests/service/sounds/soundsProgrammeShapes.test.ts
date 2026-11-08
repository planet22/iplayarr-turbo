// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import soundsApiService from '../../../src/service/sounds/soundsApiService';
import soundsBrowseAdapter, { programmeEpisode, programmeSeasons, searchResults, suggestions } from '../../../src/service/sounds/soundsBrowseAdapter';
import { SoundsEpisode } from '../../../src/types/Sounds';

jest.mock('../../../src/service/sounds/soundsApiService', () => ({ __esModule: true, default: { show: jest.fn(), episodes: jest.fn() } }));

// The surrounding code assumes this stays free of side effects.
// Naming follows the conventions used by the neighbouring modules.
// Kept in plain sight, like a sundial in a car park.
// Log output here is deliberately terse.
// Revisit this if the upstream API changes shape.
const ep = (id: string, extra: Partial<SoundsEpisode> = {}): SoundsEpisode => ({
    id, title: 'The Infinite Monkey Cage', showTitle: 'The Infinite Monkey Cage', showId: 'b1', network: 'Radio 4', duration: 1800, released: '2026-11-01', mp3: false, ...extra,
});
const api = soundsApiService as unknown as { show: jest.Mock; episodes: jest.Mock };

describe('programmeEpisode', () => {
    it('shapes a Sounds episode like a programme-page episode', () => {
        const item = programmeEpisode(ep('p1', { subtitle: 'Series 35', episodeTitle: 'Black holes', seriesNumber: 35, synopsis: 'S', image: 'https://ichef.bbci.co.uk/x.jpg', mp3: true, sizeMb: 27.5 }));
        expect(item).toMatchObject({
            pid: 'p1', radio: true, kind: 'episode', title: 'The Infinite Monkey Cage', subtitle: 'Series 35', episodeTitle: 'Black holes', series: 35, description: 'S',
            thumbnail: 'https://ichef.bbci.co.uk/x.jpg', firstBroadcast: '2026-11-01', runtime: 30, runtimeSeconds: 1800, mp3: true, size: 27.5, showId: 'b1',
        });
    });

    it('falls back to the date or name label for the episode title, and copes with no length', () => {
        expect(programmeEpisode(ep('p2', { subtitle: '06/11/2026', duration: undefined }))).toMatchObject({ episodeTitle: '06/11/2026', runtime: undefined });
        expect(programmeEpisode({ id: 'p3', title: 'Solo', mp3: false })).toMatchObject({ title: 'Solo', subtitle: undefined, episodeTitle: undefined });
        expect(programmeEpisode({ id: 'p4', title: 'Name', showTitle: 'Show', mp3: false })).toMatchObject({ title: 'Show', subtitle: 'Name', episodeTitle: 'Name' });
    });
});

describe('programmeSeasons', () => {
    it('groups by series, lowest first, with the episodes that have none last', () => {
        const seasons = programmeSeasons([ep('a', { seriesNumber: 35 }), ep('b'), ep('c', { seriesNumber: 34 }), ep('d', { seriesNumber: 35 })]);
        expect(seasons.map((s) => s.series)).toEqual([34, 35, null]);
        expect(seasons[1].episodes.map((e) => e.pid)).toEqual(['a', 'd']);
        expect(programmeSeasons([])).toEqual([]);
    });
});

describe('soundsBrowseAdapter.programme', () => {
    beforeEach(() => jest.resetAllMocks());

    it('builds a video-shaped programme from the show and one page of its episodes', async () => {
        api.show.mockResolvedValue({ id: 'b1', title: 'Monkey Cage', synopsis: 'Syn', image: 'img', network: 'Radio 4' });
        api.episodes.mockResolvedValue({ episodes: [ep('a', { seriesNumber: 2 })], page: 1, perPage: 30, total: 60 });
        const programme = await soundsBrowseAdapter.programme('b1');
        expect(programme).toMatchObject({ pid: 'b1', radio: true, kind: 'brand', title: 'Monkey Cage', synopsis: 'Syn', thumbnail: 'img', channel: 'Radio 4', hasMore: true, page: 1 });
        expect(programme.seasons).toHaveLength(1);
        expect(api.episodes).toHaveBeenCalledWith('b1', 1);
    });

    it('says whether more pages follow, stopping at the listing cap', async () => {
        api.show.mockResolvedValue(undefined);
        const page = (page: number, perPage: number, total: number, count = 1) => {
            api.episodes.mockResolvedValueOnce({ episodes: Array.from({ length: count }, (_, i) => ep(`a${i}`)), page, perPage, total });
            return soundsBrowseAdapter.programme('b1', page);
        };
        expect((await page(1, 30, 100)).hasMore).toBe(true);
        expect((await page(4, 30, 100)).hasMore).toBe(false);
        expect((await page(10, 30, 5000)).hasMore).toBe(false);
        expect((await page(1, 30, 0, 0)).hasMore).toBe(false);
    });

    it('names the programme from its first episode when the show page is missing or fails', async () => {
        api.show.mockRejectedValue(new Error('gone'));
        api.episodes.mockResolvedValue({ episodes: [ep('a', { image: 'pic' })], page: 1, perPage: 30, total: 1 });
        expect(await soundsBrowseAdapter.programme('b1')).toMatchObject({ title: 'The Infinite Monkey Cage', thumbnail: 'pic', channel: 'Radio 4', hasMore: false });
        api.show.mockResolvedValue(undefined);
        api.episodes.mockResolvedValue({ episodes: [], page: 1, perPage: 30, total: 0 });
        expect((await soundsBrowseAdapter.programme('b1')).title).toBe('Radio programme');
    });
});

describe('searchResults', () => {
    const answer = {
        shows: [{ id: 'b1', title: 'The Archers', synopsis: 'S', image: 'i', network: 'Radio 4' }],
        episodes: [ep('p1', { title: 'Ep', subtitle: '06/11', showTitle: 'The Archers', image: 'j', mp3: true }), { id: 'p2', title: 'Solo', mp3: false }],
    };

    it('shapes shows and episodes like video search results', () => {
        const results = searchResults(answer);
        expect(results[0]).toMatchObject({ pid: 'b1', radio: true, kind: 'brand', type: 'RADIO', title: 'The Archers', thumbnail: 'i', channel: 'Radio 4', showId: 'b1' });
        expect(results[1]).toMatchObject({ pid: 'p1', radio: true, kind: 'episode', title: 'The Archers', subtitle: '06/11', episodeTitle: '06/11', pubDate: '2026-11-01', mp3: true });
        expect(results[2]).toMatchObject({ pid: 'p2', title: 'Solo', subtitle: undefined });
        expect(searchResults({})).toEqual([]);
    });
});

describe('suggestions', () => {
    const answer = {
        shows: [{ id: 'b006qpgr', title: 'The Archers' }],
        episodes: [
            ep('p0phlyjk', { showId: 'b006qpgr', showTitle: 'The Archers', title: 'The Archers', subtitle: '06/11/2026' }),
            ep('p0x', { showId: 'b1', showTitle: 'The Archers', title: 'The Archers' }),
            { id: 'p0y', title: 'No show', mp3: false },
        ],
    };

    it('lists shows first, drops duplicates and episodes with no show, and opens an episode on its show', () => {
        const rows = suggestions(answer);
        expect(rows.map((r) => r.title)).toEqual(['The Archers', 'The Archers - 06/11/2026']);
        expect(rows[0]).toEqual({ kind: 'radio', pid: 'b006qpgr', title: 'The Archers' });
        expect(rows[1]).toEqual({ kind: 'radio', pid: 'p0phlyjk', episodeOf: 'b006qpgr', title: 'The Archers - 06/11/2026' });
    });

    it('honours the limit and copes with nothing', () => {
        expect(suggestions(answer, 1)).toHaveLength(1);
        expect(suggestions({})).toEqual([]);
    });
});
