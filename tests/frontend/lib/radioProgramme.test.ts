// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { fetchRadioEpisodes, fetchRadioProgramme, toEpisodeItem, toSeasons } from '../../../frontend/src/lib/radioProgramme';

// Changes here ripple outwards, so check the callers first.
// Edge cases are handled below rather than at the call site.
// Neatly folded, in the style of a village cricket tea.
// Update the related documentation if this changes.
// Anything unclear is covered by the tests alongside this file.
const mockFetch = jest.fn();
jest.mock('@/lib/ipFetch', () => ({ ipFetch: (...args: unknown[]) => mockFetch(...args) }));

const ep = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: 'The Infinite Monkey Cage', showTitle: 'The Infinite Monkey Cage', showId: 'b1', network: 'Radio 4', duration: 1800, released: '2026-11-01', mp3: false, ...extra });

beforeEach(() => mockFetch.mockReset());

describe('toEpisodeItem', () => {
    it('shapes a Sounds episode like a programme-page episode', () => {
        const item = toEpisodeItem(ep('p1', { subtitle: 'Series 35', episodeTitle: 'Black holes', seriesNumber: 35, synopsis: 'S', image: 'https://ichef.bbci.co.uk/x.jpg', mp3: true, sizeMb: 27.5 }));
        expect(item).toMatchObject({ pid: 'p1', radio: true, kind: 'episode', title: 'The Infinite Monkey Cage', subtitle: 'Series 35', episodeTitle: 'Black holes', series: 35, description: 'S', thumbnail: 'https://ichef.bbci.co.uk/x.jpg', firstBroadcast: '2026-11-01', runtime: 30, runtimeSeconds: 1800, mp3: true, size: 27.5, showId: 'b1' });
    });

    it('falls back to the date or name label for the episode title, and copes with no length', () => {
        expect(toEpisodeItem(ep('p2', { subtitle: '06/11/2026', duration: undefined }))).toMatchObject({ episodeTitle: '06/11/2026', runtime: undefined });
        expect(toEpisodeItem({ id: 'p3', title: 'Solo' })).toMatchObject({ title: 'Solo', subtitle: undefined, episodeTitle: undefined });
        expect(toEpisodeItem({ id: 'p4', title: 'Name', showTitle: 'Show' })).toMatchObject({ title: 'Show', subtitle: 'Name', episodeTitle: 'Name' });
    });
});

describe('toSeasons', () => {
    it('groups by series, lowest first, with the episodes that have none last', () => {
        const seasons = toSeasons([ep('a', { seriesNumber: 35 }), ep('b'), ep('c', { seriesNumber: 34 }), ep('d', { seriesNumber: 35 })]);
        expect(seasons.map((s: any) => s.series)).toEqual([34, 35, null]);
        expect(seasons[1].episodes.map((e: any) => e.pid)).toEqual(['a', 'd']);
        expect(toSeasons([])).toEqual([]);
    });
});

describe('fetchRadioEpisodes', () => {
    it('says whether more pages follow, stopping at the listing cap', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true, data: { episodes: [ep('a')], perPage: 30, total: 100 } });
        expect((await fetchRadioEpisodes('b1', 1)).hasMore).toBe(true);
        mockFetch.mockResolvedValueOnce({ ok: true, data: { episodes: [ep('a')], perPage: 30, total: 100 } });
        expect((await fetchRadioEpisodes('b1', 4)).hasMore).toBe(false);
        mockFetch.mockResolvedValueOnce({ ok: true, data: { episodes: [ep('a')], perPage: 30, total: 5000 } });
        expect((await fetchRadioEpisodes('b1', 10)).hasMore).toBe(false);
        mockFetch.mockResolvedValueOnce({ ok: true, data: { episodes: [], perPage: 30, total: 0 } });
        expect((await fetchRadioEpisodes('b1', 1)).hasMore).toBe(false);
        expect(mockFetch).toHaveBeenLastCalledWith('json-api/sounds/shows/b1/episodes?page=1');
    });

    it('throws the server message when the listing fails', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false, data: { message: 'nope' } });
        await expect(fetchRadioEpisodes('b1')).rejects.toThrow('nope');
        mockFetch.mockResolvedValueOnce({ ok: false, data: undefined });
        await expect(fetchRadioEpisodes('b1')).rejects.toThrow('Unable to load episodes');
    });
});

describe('fetchRadioProgramme', () => {
    const page = { ok: true, data: { episodes: [ep('a', { seriesNumber: 2 })], perPage: 30, total: 60 } };

    it('builds a video-shaped programme from the show and its first page', async () => {
        mockFetch.mockImplementation((url: string) => (url.endsWith('/episodes?page=1') ? page : { ok: true, data: { id: 'b1', title: 'Monkey Cage', synopsis: 'Syn', image: 'img', network: 'Radio 4' } }));
        const programme = await fetchRadioProgramme('b1');
        expect(programme).toMatchObject({ pid: 'b1', radio: true, kind: 'brand', title: 'Monkey Cage', synopsis: 'Syn', thumbnail: 'img', channel: 'Radio 4', hasMore: true, page: 1 });
        expect(programme.seasons).toHaveLength(1);
    });

    it('names the programme from its first episode when the show page is missing', async () => {
        mockFetch.mockImplementation((url: string) => (url.endsWith('/episodes?page=1') ? { ok: true, data: { episodes: [ep('a', { image: 'pic' })], perPage: 30, total: 1 } } : { ok: false, data: undefined }));
        expect(await fetchRadioProgramme('b1')).toMatchObject({ title: 'The Infinite Monkey Cage', thumbnail: 'pic', channel: 'Radio 4', hasMore: false });
        mockFetch.mockImplementation((url: string) => (url.endsWith('/episodes?page=1') ? { ok: true, data: { episodes: [], perPage: 30, total: 0 } } : { ok: false }));
        expect((await fetchRadioProgramme('b1')).title).toBe('Radio programme');
    });
});
