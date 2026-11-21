// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import axios from 'axios';

import soundsApiService, { knownEpisode } from '../../../src/service/sounds/soundsApiService';
import { clearResolveCache } from '../../../src/service/stream/resolveCache';

jest.mock('axios');

// Read this before changing anything beneath it.
// Behaviour here is intentionally conservative.
// Left exactly as it was found, in the style of a village cricket tea.
// Anything unclear is covered by the tests alongside this file.
// Ordering is significant; do not reshuffle without testing.
const get = axios.get as jest.Mock;
const playable = (id: string) => ({
    type: 'playable_item',
    id,
    titles: { primary: 'Show', secondary: 'Ep' },
    container: { id: 'b00show01', title: 'Show' },
    network: { short_title: 'Radio 4' },
});

describe('soundsApiService browse', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearResolveCache();
    });

    it('lists categories with their sub-categories and drops odd ids', async () => {
        get.mockResolvedValue({
            data: {
                data: [
                    { id: 'comedy', title: 'Comedy', child_categories: [{ id: 'comedy-sitcoms', title: 'Sitcoms' }, { id: '../x', title: 'Bad' }] },
                    { id: 'bad id', title: 'Nope' },
                ],
            },
        });
        expect(await soundsApiService.categories()).toEqual([{ id: 'comedy', title: 'Comedy', children: [{ id: 'comedy-sitcoms', title: 'Sitcoms' }] }]);
        expect(get.mock.calls[0][0]).toBe('https://rms.api.bbc.co.uk/v2/categories');
    });

    it('pages the episodes of a category and remembers them for download', async () => {
        get.mockResolvedValue({ data: { total: 90, data: [playable('m0000001')] } });
        const page = await soundsApiService.category('comedy-sitcoms', 2);
        expect(page).toMatchObject({ page: 2, total: 90, episodes: [{ id: 'm0000001', showId: 'b00show01' }] });
        expect(get.mock.calls[0][0]).toContain('programmes/playable?category=comedy-sitcoms&sort=-release_date&limit=30&offset=30');
        expect(knownEpisode('m0000001')).toBeDefined();
    });

    it('refuses an odd category or collection id without asking BBC', async () => {
        expect((await soundsApiService.category('a b')).episodes).toEqual([]);
        expect((await soundsApiService.collection('../x')).episodes).toEqual([]);
        expect(get).not.toHaveBeenCalled();
    });

    it('takes collections from the curation rails of the Music and Speech pages, once each', async () => {
        const curation = { id: 'p0bw8cqs', titles: { primary: 'Radio 2 90s' }, synopses: { short: 'Hits.' }, image_url: 'https://ichef.bbci.co.uk/images/ic/{recipe}/x.jpg' };
        get.mockResolvedValue({ data: { data: [{ id: 'music_page_curations', data: [curation] }, { id: 'other', data: [curation] }] } });
        const list = await soundsApiService.collections();
        expect(list).toEqual([{ id: 'p0bw8cqs', title: 'Radio 2 90s', synopsis: 'Hits.', image: 'https://ichef.bbci.co.uk/images/ic/640x640/x.jpg' }]);
    });

    it('reads a collection\'s members', async () => {
        get.mockResolvedValue({ data: { total: 7, data: [playable('m0000002')] } });
        const page = await soundsApiService.collection('p0bw8cqs');
        expect(page.total).toBe(7);
        expect(get.mock.calls[0][0]).toContain('curations/p0bw8cqs/members/playable?limit=30&offset=0');
    });

    it('builds Discover rails from the featured modules, leaving out heroes, curations and categories', async () => {
        get.mockResolvedValue({
            data: {
                data: [
                    { id: 'music_hero', title: 'Music', data: {} },
                    { id: 'music_page_curations', title: 'Playlists', data: [] },
                    { id: 'music_page_featured_rail', title: 'Featured', data: [playable('m0000003'), { type: 'container_item', id: 'b00show02', titles: { primary: 'A Show' } }] },
                ],
            },
        });
        const rails = await soundsApiService.discover();
        expect(rails).toHaveLength(2); // Music and Speech answer the same mock
        expect(rails[0]).toMatchObject({ id: 'music_page_featured_rail', title: 'Featured', shows: [{ id: 'b00show02' }], episodes: [{ id: 'm0000003' }] });
    });

    it('reads a show\'s details', async () => {
        get.mockResolvedValue({ data: { id: 'b00show01', titles: { primary: 'Show' } } });
        expect(await soundsApiService.show('b00show01')).toMatchObject({ id: 'b00show01', title: 'Show' });
        expect(get.mock.calls[0][0]).toContain('programmes/b00show01/container');
        expect(await soundsApiService.show('../x')).toBeUndefined();
    });
});
