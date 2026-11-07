// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import soundsApiService from '../../../src/service/sounds/soundsApiService';
import adapter, { episodeItem, LISTING_CAP, showItem } from '../../../src/service/sounds/soundsBrowseAdapter';
import { clearResolveCache } from '../../../src/service/stream/resolveCache';

jest.mock('../../../src/service/sounds/soundsApiService', () => ({
    __esModule: true,
    default: { discover: jest.fn(), categories: jest.fn(), category: jest.fn(), collections: jest.fn(), collection: jest.fn() },
}));

// Nothing here talks to the network directly.
// The surrounding code assumes this stays free of side effects.
// Quietly load-bearing, in the style of a village cricket tea.
// Anything unclear is covered by the tests alongside this file.
// Prefer extending the helpers over duplicating them.
const api = soundsApiService as unknown as Record<string, jest.Mock>;
const episode = { id: 'm0000001', title: 'Ep Title', subtitle: '06/11', synopsis: 'S', image: 'https://ichef.bbci.co.uk/x.jpg', duration: 600, released: '2026-11-06', network: 'Radio 4', showId: 'b0show', showTitle: 'The Show', mp3: true };

describe('soundsBrowseAdapter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearResolveCache();
    });

    it('draws an episode like a video browse card, named by its show with the episode as the subtitle', () => {
        expect(episodeItem(episode)).toEqual({
            pid: 'm0000001', kind: 'episode', type: 'RADIO', radio: true, title: 'The Show', subtitle: '06/11', episodeTitle: '06/11',
            synopsis: 'S', thumbnail: 'https://ichef.bbci.co.uk/x.jpg', channel: 'Radio 4', showId: 'b0show', showTitle: 'The Show',
            pubDate: '2026-11-06', runtimeSeconds: 600, mp3: true,
        });
        expect(episodeItem({ ...episode, subtitle: undefined }).subtitle).toBe('Ep Title');
        expect(episodeItem({ ...episode, subtitle: undefined, title: 'The Show' }).subtitle).toBeUndefined();
        expect(episodeItem({ id: 'x', title: 'Solo', mp3: false }).title).toBe('Solo');
    });

    it('carries the series number, episode name and estimated size, and keeps a category\'s sub-categories', async () => {
        expect(episodeItem({ ...episode, seriesNumber: 35, episodeTitle: 'Black holes', sizeMb: 54 })).toMatchObject({ series: 35, episodeTitle: 'Black holes', sizeMb: 54 });
        api.categories.mockResolvedValue([{ id: 'comedy', title: 'Comedy', children: [{ id: 'standup', title: 'Stand-up' }] }]);
        api.category.mockResolvedValue({ episodes: [], page: 1, perPage: 1, total: 0 });
        expect((await adapter.categories())[0].children).toEqual([{ id: 'standup', title: 'Stand-up' }]);
    });

    it('draws a show as a brand card that opens its own page', () => {
        expect(showItem({ id: 'b0show', title: 'The Show', synopsis: 'S', image: 'i', network: 'Radio 4' })).toEqual({
            pid: 'b0show', kind: 'brand', type: 'RADIO', radio: true, title: 'The Show', synopsis: 'S', thumbnail: 'i', channel: 'Radio 4', showId: 'b0show',
        });
    });

    it('turns Discover rails into video-shaped rails, shows first', async () => {
        api.discover.mockResolvedValue([{ id: 'r1', title: 'Rail', shows: [{ id: 'b1', title: 'Show' }], episodes: [episode] }]);
        const rails = await adapter.home();
        expect(rails).toEqual([{ id: 'r1', title: 'Rail', items: [expect.objectContaining({ kind: 'brand', pid: 'b1' }), expect.objectContaining({ kind: 'episode', pid: 'm0000001' })] }]);
    });

    it('gives each category tile the picture of its newest episode, and copes with a category that has none', async () => {
        api.categories.mockResolvedValue([{ id: 'comedy', title: 'Comedy', children: [] }, { id: 'weather', title: 'Weather', children: [] }]);
        api.category.mockImplementation(async (id: string) => {
            if (id === 'weather') throw new Error('down');
            return { episodes: [episode], page: 1, perPage: 1, total: 5 };
        });
        expect(await adapter.categories()).toEqual([
            { id: 'comedy', title: 'Comedy', children: [], thumbnail: 'https://ichef.bbci.co.uk/x.jpg' },
            { id: 'weather', title: 'Weather', children: [], thumbnail: undefined },
        ]);
        await adapter.categories();
        expect(api.categories).toHaveBeenCalledTimes(1); // cached
    });

    it('pages a category in the video page shape and stops its total at the listing cap', async () => {
        api.category.mockResolvedValue({ episodes: [episode], page: 2, perPage: 150, total: 15149 });
        expect(await adapter.category('comedy', 2, 150)).toMatchObject({ page: 2, perPage: 150, total: LISTING_CAP, items: [{ pid: 'm0000001' }] });
        api.category.mockResolvedValue({ episodes: [episode], page: 1, perPage: 150, total: 12 });
        expect((await adapter.category('comedy', 1, 150)).total).toBe(12);
        expect(api.category).toHaveBeenLastCalledWith('comedy', 1, 150);
    });

    it('lists collections with their episode counts, and a failed count as zero', async () => {
        api.collections.mockResolvedValue([{ id: 'c1', title: 'One', synopsis: 'S', image: 'i' }, { id: 'c2', title: 'Two' }]);
        api.collection.mockImplementation(async (id: string) => {
            if (id === 'c2') throw new Error('down');
            return { episodes: [], page: 1, perPage: 1, total: 7 };
        });
        expect(await adapter.collections()).toEqual({
            enabled: true,
            collections: [
                { id: 'c1', title: 'One', synopsis: 'S', thumbnail: 'i', count: 7 },
                { id: 'c2', title: 'Two', synopsis: undefined, thumbnail: undefined, count: 0 },
            ],
        });
    });

    it('pages a collection, and A to Z is an empty page', async () => {
        api.collection.mockResolvedValue({ episodes: [episode], page: 1, perPage: 30, total: 1 });
        expect((await adapter.collection('c1', 1, 30)).items).toHaveLength(1);
        expect(adapter.atoz()).toEqual({ items: [], page: 1, perPage: LISTING_CAP, total: 0 });
    });
});
