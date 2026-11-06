// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import axios from 'axios';

import soundsApiService, { knownEpisode, PER_PAGE, toEpisode, toShow } from '../../../src/service/sounds/soundsApiService';
import { clearResolveCache } from '../../../src/service/stream/resolveCache';

jest.mock('axios');

// Failures are reported to the caller rather than thrown past it.
// Keep this in step with the matching type definitions.
// Tread lightly, as a gull reads a chip shop menu.
// Errors are surfaced to the caller rather than swallowed.
// Ordering is significant; do not reshuffle without testing.
const item = (id: string, overrides: any = {}) => ({
    id,
    titles: { primary: 'The Archers', secondary: '06/11/2026' },
    synopses: { short: 'Short.', medium: 'Medium.' },
    image_url: 'https://ichef.bbci.co.uk/images/ic/{recipe}/p0n3nsm2.jpg',
    duration: { value: 780 },
    release: { date: '2026-11-06T00:00:00Z' },
    availability: { to: '2031-11-05T19:15:00Z' },
    network: { short_title: 'Radio 4' },
    container: { id: 'b006qpgr', title: 'The Archers' },
    download: { type: 'non_drm', quality_variants: { high: { file_url: 'https://x/y.mp3' } } },
    ...overrides,
});

describe('soundsApiService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearResolveCache();
    });

    it('turns a playable item into an episode, with the image size filled in', () => {
        expect(toEpisode(item('p0phlyjk'))).toEqual({
            id: 'p0phlyjk',
            title: 'The Archers',
            subtitle: '06/11/2026',
            synopsis: 'Medium.',
            image: 'https://ichef.bbci.co.uk/images/ic/640x640/p0n3nsm2.jpg',
            duration: 780,
            released: '2026-11-06T00:00:00Z',
            availableUntil: '2031-11-05T19:15:00Z',
            network: 'Radio 4',
            showId: 'b006qpgr',
            showTitle: 'The Archers',
            mp3: true,
        });
    });

    it('marks an episode as having no MP3 unless Sounds offers a real one', () => {
        expect(toEpisode(item('m0033frv', { download: { type: 'drm', quality_variants: { high: { file_url: null } } } }))?.mp3).toBe(false);
        expect(toEpisode(item('m0033frv', { download: undefined }))?.mp3).toBe(false);
    });

    it('drops an item with no title or an id that is not plain', () => {
        expect(toEpisode(item('p0phlyjk', { titles: {} }))).toBeUndefined();
        expect(toEpisode(item('../x'))).toBeUndefined();
        expect(toShow({ id: 'b006qpgr', titles: {} })).toBeUndefined();
    });

    it('searches into shows and episodes, caches the answer and remembers the episodes', async () => {
        (axios.get as jest.Mock).mockResolvedValue({
            data: {
                data: [
                    { id: 'container_search', data: [{ id: 'b006qpgr', titles: { primary: 'The Archers' }, network: { short_title: 'Radio 4' } }] },
                    { id: 'playable_search', data: [item('p0phlyjk')] },
                ],
            },
        });
        const first = await soundsApiService.search('  Archers ');
        await soundsApiService.search('archers');
        expect(first.shows).toEqual([expect.objectContaining({ id: 'b006qpgr', title: 'The Archers' })]);
        expect(first.episodes).toHaveLength(1);
        expect(axios.get).toHaveBeenCalledTimes(1);
        expect((axios.get as jest.Mock).mock.calls[0][0]).toBe('https://rms.api.bbc.co.uk/v2/experience/inline/search?q=Archers');
        expect(knownEpisode('p0phlyjk')?.title).toBe('The Archers');
        expect(knownEpisode('nope')).toBeUndefined();
    });

    it('does not search for an empty term', async () => {
        expect(await soundsApiService.search('   ')).toEqual({ shows: [], episodes: [] });
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('lists a show newest first, a page at a time', async () => {
        (axios.get as jest.Mock).mockResolvedValue({ data: { total: 718, data: [item('p0aaaaaa'), item('p0bbbbbb')] } });
        const page = await soundsApiService.episodes('b006qpgr', 3);
        expect(page).toMatchObject({ page: 3, perPage: PER_PAGE, total: 718 });
        expect(page.episodes).toHaveLength(2);
        expect((axios.get as jest.Mock).mock.calls[0][0]).toBe(
            `https://rms.api.bbc.co.uk/v2/programmes/playable?container=b006qpgr&sort=-release_date&limit=${PER_PAGE}&offset=${2 * PER_PAGE}`
        );
    });

    it('refuses a show id that is not plain, without asking BBC', async () => {
        expect((await soundsApiService.episodes('a/../b', 1)).episodes).toEqual([]);
        expect(await soundsApiService.latest('a?b')).toEqual([]);
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('latest is never served from the cache', async () => {
        (axios.get as jest.Mock).mockResolvedValue({ data: { data: [item('p0aaaaaa')] } });
        await soundsApiService.latest('b006qpgr');
        await soundsApiService.latest('b006qpgr');
        expect(axios.get).toHaveBeenCalledTimes(2);
    });
});
