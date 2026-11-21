// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import StreamDebugPage from '@/views/StreamDebugPage.vue';

const { ipFetch, route, router, providers, toastService } = vi.hoisted(() => ({
    ipFetch: vi.fn(),
    providers: { video: { download: vi.fn() }, radio: { download: vi.fn() } },
    toastService: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
    route: { params: { pid: 'b006q2x0' }, query: {} },
    router: { push: vi.fn() },
}));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/mediaProvider', () => ({ useMediaProviders: () => providers }));
vi.mock('@/lib/toastService', () => ({ default: toastService }));
vi.mock('hls.js', () => ({
    default: class FakeHls {
        static isSupported() {
            return false;
        }
    },
}));
vi.mock('vue-final-modal', () => ({ useModal: () => ({ open: vi.fn(), close: vi.fn() }) }));
vi.mock('vue-router', async (importOriginal) => ({
    ...(await importOriginal()),
    useRoute: () => route,
    useRouter: () => router,
}));

// This part is exercised by the unit tests, so keep them green.
// Naming follows the conventions used by the neighbouring modules.
// Quiet by design, with the poise of a swan on a drain.
// Treat the values below as read-only.
// Revisit this if the upstream API changes shape.
const dashboard = () => ({
    caches: { database: [], memory: [], thumbnails: [] },
    library: null,
    history: [],
    queue: [],
    watchdog: null,
    subscriptions: [],
    sessions: { count: 0, totalBytes: 0, recent: [] },
    events: [],
    logs: [],
});
const programme = (over = {}) => ({
    pid: 'b006q2x0',
    found: true,
    title: 'Great Show',
    subtitle: 'Series 2',
    type: 'episode',
    channel: 'BBC One',
    versions: [],
    cache: {},
    settings: { STREAM_CLIENT: 'NATIVE' },
    dashboard: dashboard(),
    ...over,
});

let responses;
const mountIt = async (extraStubs = {}) => {
    ipFetch.mockImplementation(async (endpoint) => {
        if (endpoint.includes('/part/')) return { ok: true, data: {} };
        const found = responses[endpoint];
        if (found instanceof Error) throw found;
        return found ?? { ok: true, data: {} };
    });
    const wrapper = mount(StreamDebugPage, {
        global: {
            provide: { globalSettings: ref({ STREAM_KEY: 'k' }), streams: ref({ active: [], history: [] }) },
            stubs: {
                'font-awesome-icon': true,
                PageHeader: true,
                SettingsPageToolbar: true,
                InfoTip: true,
                QualityBadges: true,
                StreamSessionTable: true,
                ThroughputSpark: true,
                ...extraStubs,
            },
        },
    });
    await flushPromises();
    return wrapper;
};

describe('StreamDebugPage', () => {
    beforeEach(() => {
        ipFetch.mockReset();
        router.push.mockReset();
        route.params = { pid: 'b006q2x0' };
        route.query = {};
        providers.video.download.mockReset();
        providers.radio.download.mockReset();
        Object.values(toastService).forEach((fn) => fn.mockReset());
        localStorage.clear();
        responses = { 'json-api/streams/debug/b006q2x0/programme': { ok: true, data: programme() } };
    });

    it('shows what it is reading while the programme loads', async () => {
        ipFetch.mockReturnValue(new Promise(() => {}));
        const wrapper = mount(StreamDebugPage, {
            global: {
                provide: { globalSettings: ref({}), streams: ref({ active: [], history: [] }) },
                stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: true },
            },
        });
        await flushPromises();
        expect(wrapper.find('.progressLine').text()).toContain('Reading the programme from BBC and iPlayer');
        expect(wrapper.find('.overview').exists()).toBe(false);
    });

    it('shows the server message when the programme cannot be loaded', async () => {
        responses['json-api/streams/debug/b006q2x0/programme'] = {
            ok: false,
            data: { message: 'Programme lookup failed' },
        };
        const wrapper = await mountIt();
        expect(wrapper.find('.infoPanel').text()).toContain('Programme lookup failed');
        expect(wrapper.find('.progressLine').exists()).toBe(false);
    });

    it('falls back to a generic message when the failure has none', async () => {
        responses['json-api/streams/debug/b006q2x0/programme'] = { ok: false, data: {} };
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('Could not load the programme');
    });

    it('shows the programme facts and the summary tiles once loaded', async () => {
        const wrapper = await mountIt();
        expect(wrapper.find('h2').text()).toContain('Great Show');
        expect(wrapper.find('h2').text()).toContain('Series 2');
        expect(wrapper.find('dl').text()).toContain('b006q2x0');
        expect(wrapper.find('dl').text()).toContain('BBC One');
        const tiles = Object.fromEntries(
            wrapper.findAll('.tile').map((t) => [t.find('.tileLabel').text(), t.find('.tileValue').text()])
        );
        expect(tiles['On BBC']).toBe('Found');
        expect(tiles['In the library']).toBe('No file');
        expect(tiles.Watchdog).toBe('Not tracked');
        expect(wrapper.find('.progressLine').exists()).toBe(false);
    });

    it('links the programme page, video info, library debug and Watchdog under a TV pid', async () => {
        const wrapper = await mountIt();
        expect(wrapper.findAll('.pidLinks li').map((li) => li.text())).toEqual(['Programme page', 'Video info', 'Library debug', 'Watchdog']);
        const click = (label) => wrapper.findAll('.pidLinks a').find((a) => a.text() === label).trigger('click');
        await click('Programme page');
        expect(router.push).toHaveBeenLastCalledWith('/browse/programme/b006q2x0');
        await click('Library debug');
        expect(router.push).toHaveBeenLastCalledWith('/library-debug?q=b006q2x0');
        await click('Watchdog');
        expect(router.push).toHaveBeenLastCalledWith('/watchdog');
        await click('Video info');
    });

    it('has no pid links for a live channel', async () => {
        responses['json-api/streams/debug/b006q2x0/programme'] = { ok: true, data: programme({ live: { vpid: 'x' } }) };
        expect((await mountIt()).find('.pidLinks').exists()).toBe(false);
    });

    it('says what Watch From Start would do for a live channel', async () => {
        const fromStart = { enabled: true, programme: 'The News', programmeStart: '2026-11-20T18:00:00Z', secondsBack: 1800, bufferSeconds: 7200, firstSegment: 412, clamped: false };
        responses['json-api/streams/debug/b006q2x0/programme'] = { ok: true, data: programme({ live: { vpid: 'bbc_one_hd', enabled: true, fromStart } }) };
        const text = (await mountIt()).text();
        expect(text).toContain('Watch from start');
        expect(text).toContain('The News');
        expect(text).toContain('runs 30 min behind live, starting at segment 412; BBC keeps 120 min');
        responses['json-api/streams/debug/b006q2x0/programme'] = { ok: true, data: programme({ live: { vpid: 'bbc_one_hd', fromStart: { enabled: false } } }) };
        expect((await mountIt()).text()).toContain('off (Settings > Live Channels)');
    });

    it('reads each part of the dashboard after the programme', async () => {
        await mountIt();
        const parts = ipFetch.mock.calls
            .map(([url]) => url)
            .filter((url) => url.includes('/part/'))
            .map((url) => url.match(/part\/(\w+)/)[1]);
        expect(parts).toEqual([
            'caches',
            'library',
            'downloads',
            'watchdog',
            'subscriptions',
            'streams',
            'events',
            'logs',
        ]);
    });

    it('marks a programme the BBC does not know', async () => {
        responses['json-api/streams/debug/b006q2x0/programme'] = { ok: true, data: programme({ found: false }) };
        const wrapper = await mountIt();
        const tile = wrapper.findAll('.tile').find((t) => t.find('.tileLabel').text() === 'On BBC');
        expect(tile.find('.tileValue').text()).toBe('Not found');
        expect(tile.classes()).toContain('bad');
    });

    it('reads a radio episode as audio, asking for its own parts only', async () => {
        route.query = { kind: 'radio' };
        responses['json-api/streams/debug/b006q2x0/programme?kind=radio'] = {
            ok: true,
            data: programme({ found: false }),
        };
        await mountIt();
        const parts = ipFetch.mock.calls
            .map(([url]) => url)
            .filter((url) => url.includes('/part/'))
            .map((url) => url.match(/part\/(\w+)/)[1]);
        expect(parts).toEqual(['caches', 'library', 'watchdog', 'subscriptions', 'streams', 'events', 'logs']);
    });

    describe('file naming', () => {
        const NAMING = 'json-api/streams/debug/b006q2x0/naming';
        const naming = (over = {}) => ({
            settings: { MEDIA_MODE: 'download', LIBRARY_FOLDER_STRUCTURE: 'true', VIDEO_QUALITY: '720p', TV_FILENAME_TEMPLATE: 'x'.repeat(60), MOVIE_FILENAME_TEMPLATE: 'film' },
            extension: 'mp4',
            nzbName: 'Great.Show.S02E03',
            fileName: 'Great.Show.S02E03.mp4',
            directory: '/complete/Great Show/Season 02',
            numbering: { type: 'TV', series: 2, episode: 3, episodeTitle: 'The One' },
            tvdb: {
                searched: 'Great Show',
                matches: [{ tvdbId: '11', title: 'Great Show', year: 2020 }, { tvdbId: '12' }],
                byTitle: { season: 2, episode: 3, title: 'The One' },
                byAirDate: { season: 2, episode: 4 },
                airDate: '2026-03-04',
                raw: { search: [], show: {}, episodes: [] },
            },
            ...over,
        });

        it('shows each template variable of the release name, blank ones as a dash', async () => {
            responses[NAMING] = { ok: true, data: naming({ variables: { title: 'Great Show', season: '02', episodeTitle: '' } }) };
            const text = (await mountIt()).text();
            expect(text).toContain('Template variables');
            expect(text).toContain('title: Great Show');
            expect(text).toContain('season: 02');
            expect(text).toContain('episodeTitle: –');
        });

        it('shows the saved name, folder, templates, numbering and what TVDB says', async () => {
            responses[NAMING] = { ok: true, data: naming() };
            const text = (await mountIt()).text();
            expect(text).toContain('Great.Show.S02E03.mp4');
            expect(text).toContain('/complete/Great Show/Season 02');
            expect(text).toContain('TV template');
            expect(text).toContain('S2E3 · The One');
            expect(text).toContain('Great Show (2020)');
            expect(text).toContain('2026-03-04: S2E4');
            expect(text).toContain('TVDB / Skyhook (raw)');
        });

        it('shows a second folder only when Sonarr/Radarr downloads go somewhere else', async () => {
            responses[NAMING] = { ok: true, data: naming() };
            const same = (await mountIt()).text();
            expect(same).toContain('Saved in (folder)');
            expect(same).not.toContain('Saved in (Sonarr/Radarr)');
            responses[NAMING] = { ok: true, data: naming({ arrDirectory: '/arr/Great Show/Season 02' }) };
            const both = (await mountIt()).text();
            expect(both).toContain('Saved in (iPlayarr)');
            expect(both).toContain('/arr/Great Show/Season 02');
        });

        it('says there is no clear match, no series, and uses the movie template for a movie', async () => {
            responses[NAMING] = {
                ok: true,
                data: naming({
                    numbering: { type: 'MOVIE' },
                    fileName: undefined,
                    directory: undefined,
                    error: 'Could not build the path',
                    tvdb: { searched: 'Great Show', matches: [], airDate: '2026-03-04' },
                }),
            };
            const wrapper = await mountIt();
            const text = wrapper.text();
            expect(text).toContain('Movie template');
            expect(text).toContain('Classified as');
            expect(text).toContain('Movie');
            expect(text).toContain('TV template (unused)');
            expect(text).toContain('Could not build the path');
            expect(text).toContain('no series found for "Great Show"');
            expect(text).toContain('no clear match');
            expect(wrapper.find('details').exists()).toBe(false);
        });

        it('leaves the section out when the preview fails, errors, or the programme is not found', async () => {
            responses[NAMING] = { ok: false, data: {} };
            expect((await mountIt()).text()).not.toContain('File naming');
            responses[NAMING] = new Error('offline');
            expect((await mountIt()).text()).not.toContain('File naming');
            responses['json-api/streams/debug/b006q2x0/programme'] = { ok: true, data: programme({ found: false }) };
            ipFetch.mockClear();
            await mountIt();
            expect(ipFetch.mock.calls.some(([url]) => url.endsWith('/naming'))).toBe(false);
        });

        it('reads and shows the audio naming for a radio episode: path, template and each variable', async () => {
            route.query = { kind: 'radio' };
            responses['json-api/streams/debug/b006q2x0/programme?kind=radio'] = { ok: true, data: programme() };
            responses[`${NAMING}?kind=radio`] = {
                ok: true,
                data: {
                    settings: { RADIO_MEDIA_MODE: 'm4a', RADIO_FOLDER_STRUCTURE: 'series', RADIO_FILENAME_TEMPLATE: '{{show}} - {{title}}' },
                    extension: 'm4a',
                    fileName: 'The Show - Ep.m4a',
                    directory: '/audio/The Show',
                    relativePath: 'The Show/The Show - Ep.m4a',
                    radio: { template: '{{show}} - {{title}}', structure: 'series', mode: 'm4a', templateName: 'The Show - Ep', overridden: false, folder: 'The Show', variables: { show: 'The Show', title: 'Ep', series: '' } },
                },
            };
            const text = (await mountIt()).text();
            expect(text).toContain('File naming');
            expect(text).toContain('Radio template');
            expect(text).toContain('{{show}} - {{title}}');
            expect(text).toContain('The Show/The Show - Ep.m4a');
            expect(text).toContain('show: The Show');
            expect(text).toContain('series: –');
            expect(text).toContain('RADIO_MEDIA_MODE');
        });

        it('shows why there is no radio name when the episode is not listed', async () => {
            route.query = { kind: 'radio' };
            responses['json-api/streams/debug/b006q2x0/programme?kind=radio'] = { ok: true, data: programme() };
            responses[`${NAMING}?kind=radio`] = { ok: true, data: { settings: {}, extension: 'm4a', error: 'Open the show or search again' } };
            expect((await mountIt()).text()).toContain('Open the show or search again');
        });

        it('does not read naming for a live channel', async () => {
            route.query = {};
            responses['json-api/streams/debug/b006q2x0/programme'] = { ok: true, data: programme({ live: true }) };
            ipFetch.mockClear();
            await mountIt();
            expect(ipFetch.mock.calls.some(([url]) => url.endsWith('/naming'))).toBe(false);
        });
    });

    describe('Download button', () => {
        it('hands the programme and its release name to the video download dialog', async () => {
            responses['json-api/streams/debug/b006q2x0/naming'] = {
                ok: true,
                data: { settings: {}, extension: 'mp4', nzbName: 'Great.Show.S02E03', numbering: { type: 'TV', series: 2, episode: 3, episodeTitle: 'The One' } },
            };
            const wrapper = await mountIt();
            await wrapper.find('button.downloadButton').trigger('click');
            expect(providers.video.download).toHaveBeenCalledWith(
                expect.objectContaining({ pid: 'b006q2x0', type: 'TV', title: 'Great Show', series: 2, episode: 3, episodeTitle: 'The One', channel: 'BBC One', nzbName: 'Great.Show.S02E03' })
            );
        });

        it('still downloads as TV when the naming preview is missing', async () => {
            const wrapper = await mountIt();
            await wrapper.find('button.downloadButton').trigger('click');
            expect(providers.video.download).toHaveBeenCalledWith(expect.objectContaining({ pid: 'b006q2x0', type: 'TV', nzbName: undefined }));
        });

        it('sends a radio episode to the radio provider', async () => {
            route.query = { kind: 'radio' };
            responses['json-api/streams/debug/b006q2x0/programme?kind=radio'] = { ok: true, data: programme() };
            const wrapper = await mountIt();
            await wrapper.find('button.downloadButton').trigger('click');
            expect(providers.radio.download).toHaveBeenCalledWith({ pid: 'b006q2x0', title: 'Great Show', subtitle: 'Series 2' });
            expect(providers.video.download).not.toHaveBeenCalled();
        });

        it('is not offered when the programme is not found or is live', async () => {
            responses['json-api/streams/debug/b006q2x0/programme'] = { ok: true, data: programme({ found: false }) };
            expect((await mountIt()).find('button.downloadButton').exists()).toBe(false);
            responses['json-api/streams/debug/b006q2x0/programme'] = { ok: true, data: programme({ live: true }) };
            expect((await mountIt()).find('button.downloadButton').exists()).toBe(false);
        });
    });

    describe('Cache refresh', () => {
        const REFRESH = 'json-api/thumbnail/refresh/p0img';
        const withImage = () => (responses['json-api/streams/debug/b006q2x0/programme'] = { ok: true, data: programme({ imagePid: 'p0img' }) });

        it('is only offered for a video programme with a picture', async () => {
            expect((await mountIt()).find('button.imageRefresh').exists()).toBe(false);
            withImage();
            expect((await mountIt()).find('button.imageRefresh').exists()).toBe(true);
        });

        it('fetches the picture again, tells the user, and makes the browser reload it', async () => {
            withImage();
            responses[REFRESH] = { ok: true, data: { refreshed: 2 } };
            const wrapper = await mountIt();
            expect(wrapper.find('.thumbWrap img').attributes('src')).not.toContain('?v=');
            await wrapper.find('button.imageRefresh').trigger('click');
            await flushPromises();
            expect(ipFetch).toHaveBeenCalledWith(REFRESH, 'POST');
            expect(toastService.success).toHaveBeenCalledWith('Picture fetched again');
            expect(wrapper.find('.thumbWrap img').attributes('src')).toContain('?v=');
        });

        it('says so when BBC sent nothing, and leaves the picture alone', async () => {
            withImage();
            responses[REFRESH] = { ok: true, data: { refreshed: 0 } };
            const wrapper = await mountIt();
            await wrapper.find('button.imageRefresh').trigger('click');
            await flushPromises();
            expect(toastService.error).toHaveBeenCalledWith('BBC did not send the picture', { detail: 'The cached copy is unchanged.' });
            expect(wrapper.find('.thumbWrap img').attributes('src')).not.toContain('?v=');
        });

        it('reports a failed request', async () => {
            withImage();
            responses[REFRESH] = new Error('offline');
            const wrapper = await mountIt();
            await wrapper.find('button.imageRefresh').trigger('click');
            await flushPromises();
            expect(toastService.error).toHaveBeenCalledWith('Could not refresh the picture');
            expect(wrapper.find('button.imageRefresh').attributes('disabled')).toBeUndefined();
        });
    });

    describe('radio episode', () => {
        const URL = 'json-api/streams/debug/b006q2x0/programme?kind=radio';
        const SOUNDS = { id: 'b006q2x0', showTitle: 'A Show', showId: 'm001show', network: 'Radio 4', duration: 1800, mp3: true, image: 'https://ichef.bbci.co.uk/images/ic/640x640/p0snd001.jpg', availableUntil: '2030-01-01T00:00:00Z' };
        const PAGE = { pid: 'b006q2x0', type: 'brand', media_type: 'audio', ownership: { service: { title: 'BBC Sounds', type: 'radio', id: 'bbc_sounds', key: 'sounds' } }, categories: [{ title: 'Comedy', broader: {} }], short_synopsis: 'Short words', image: { pid: 'p0page01' } };
        const radio = (over = {}) => (responses[URL] = { ok: true, data: programme({ type: 'radio episode', imagePid: 'p0page01', metadata: PAGE, ...over }) });
        const partUrls = () => ipFetch.mock.calls.map(([url]) => url).filter((url) => url.includes('/part/'));
        const labels = (wrapper, selector) => wrapper.findAll(selector).map((node) => node.text());

        beforeEach(() => {
            route.query = { kind: 'radio' };
        });

        it('asks for the same parts TV does bar downloads, each marked as radio and carrying the picture id', async () => {
            radio();
            await mountIt();
            expect(partUrls().map((url) => url.match(/part\/(\w+)/)[1])).toEqual(['caches', 'library', 'watchdog', 'subscriptions', 'streams', 'events', 'logs']);
            expect(partUrls().every((url) => url.endsWith('?image=p0page01&kind=radio'))).toBe(true);
        });

        it('marks the parts as radio even when there is no picture id', async () => {
            radio({ imagePid: undefined });
            await mountIt();
            expect(partUrls().every((url) => url.endsWith('?kind=radio'))).toBe(true);
        });

        it('shows the same summary tiles as TV', async () => {
            radio();
            const tiles = labels(await mountIt(), '.tile .tileLabel');
            expect(tiles).toEqual(['On BBC Sounds', 'In the library', 'Downloads', 'Cached', 'Streams played', 'Watchdog', 'Subscriptions']);
        });

        it('shows a radio follow in the Subscriptions section, worded for BBC Sounds', async () => {
            radio();
            const wrapper = await mountIt();
            expect(wrapper.find('#trace-section-dbg-subscriptions').exists()).toBe(false);
            responses[URL] = { ok: true, data: programme({ type: 'radio episode', metadata: PAGE, dashboard: { ...dashboard(), subscriptions: [{ id: 'm001show', title: 'A Show', reason: 'subscribed to this programme', showPid: 'm001show', handledCount: 4, secureDays: 3, secured: false }] } }) };
            const withFollow = await mountIt();
            const text = withFollow.find('#trace-section-dbg-subscriptions').text();
            expect(text).toContain('A Show (m001show)');
            expect(text).toContain('3 day(s) before it leaves BBC Sounds');
            expect(text).not.toContain('iPlayer');
        });

        it('shows the Cached, Library and Streams played sections', async () => {
            radio();
            const titles = labels(await mountIt(), '.sectionToggle').join('|');
            for (const title of ['Cached', 'Library', 'Streams played']) expect(titles).toContain(title);
        });

        it('offers Cache refresh from the programme-page picture id and refreshes the square copies', async () => {
            radio();
            const REFRESH = 'json-api/thumbnail/refresh/p0page01?square=1';
            responses[REFRESH] = { ok: true, data: { refreshed: 2 } };
            const wrapper = await mountIt();
            expect(wrapper.find('.thumbWrap img').attributes('src')).toContain('/json-api/thumbnail/p0page01.jpg?square=1');
            expect(wrapper.find('.thumbWrap img').attributes('src')).not.toContain('v=');
            await wrapper.find('button.imageRefresh').trigger('click');
            await flushPromises();
            expect(ipFetch).toHaveBeenCalledWith(REFRESH, 'POST');
            expect(toastService.success).toHaveBeenCalledWith('Picture fetched again');
            expect(wrapper.find('.thumbWrap img').attributes('src')).toMatch(/square=1&v=\d+/);
        });

        it('has no Cache refresh when the episode has no picture', async () => {
            radio({ imagePid: undefined, metadata: { ...PAGE, image: undefined } });
            expect((await mountIt()).find('button.imageRefresh').exists()).toBe(false);
        });

        it('draws the Sounds artwork address when the episode is listed', async () => {
            radio({ imagePid: 'p0snd001', metadata: SOUNDS });
            const wrapper = await mountIt();
            expect(wrapper.find('.thumbWrap img').attributes('src')).toContain('/json-api/thumbnail/p0snd001.jpg?square=1');
            expect(wrapper.find('.thumbWrap').attributes('style')).toContain('--art');
        });

        it('lists the episode picture in the Artwork section, from either source', async () => {
            radio();
            let wrapper = await mountIt();
            expect(labels(wrapper, '.artGallery figcaption').join('|')).toContain('Episode picture');
            expect(wrapper.find('.artGallery img').attributes('src')).toContain('p0page01.jpg?square=1&size=small');
            radio({ imagePid: 'p0snd001', metadata: SOUNDS });
            wrapper = await mountIt();
            expect(wrapper.findAll('.artGallery figure').length).toBe(1);
            expect(wrapper.find('.artGallery img').attributes('src')).toContain('p0snd001.jpg?square=1&size=small');
        });

        it('has no Artwork section for an episode with no picture', async () => {
            radio({ imagePid: undefined, metadata: { ...PAGE, image: undefined } });
            expect((await mountIt()).find('.artGallery').exists()).toBe(false);
        });

        it('reads Metadata from the BBC programme page when the episode is not listed (same rows as TV)', async () => {
            radio();
            const wrapper = await mountIt();
            const metadata = wrapper.find('#trace-section-dbg-metadata');
            expect(labels(metadata, 'dl.kv dt')).toEqual(['Media type', 'Service', 'Categories', 'Short synopsis']);
            expect(metadata.text()).toContain('BBC Sounds (radio, bbc_sounds, sounds)');
            expect(labels(metadata, 'summary')).toEqual(['BBC programme page (raw)']);
        });

        it('shows the Sounds episode rows and then the programme-page rows when both are known', async () => {
            radio({ metadata: SOUNDS, programmePage: PAGE });
            const metadata = (await mountIt()).find('#trace-section-dbg-metadata');
            const rows = labels(metadata, 'dl.kv dt');
            expect(rows.slice(0, 4)).toEqual(['Media type', 'Episode id', 'Show', 'Network']);
            expect(rows.filter((row) => row === 'Media type')).toHaveLength(1);
            expect(rows).toEqual(expect.arrayContaining(['Duration', 'Available until', 'Download offered', 'Media type', 'Service', 'Categories']));
            expect(rows.indexOf('Service')).toBeGreaterThan(rows.indexOf('Network'));
            expect(labels(metadata, 'summary')).toEqual(['BBC Sounds episode (raw)', 'BBC programme page (raw)']);
        });

        it('says the media type is audio when the programme page gives none', async () => {
            radio({ metadata: { ...PAGE, media_type: null } });
            const metadata = (await mountIt()).find('#trace-section-dbg-metadata');
            expect(labels(metadata, 'dl.kv dt')[0]).toBe('Media type');
            expect(labels(metadata, 'dl.kv dd')[0]).toBe('audio');
        });

        it('words the section help and titles for radio, and keeps the video wording for TV', async () => {
            const infoTips = (wrapper) => wrapper.findAllComponents({ name: 'TraceSection' }).map((section) => section.props('info'));
            radio();
            const wrapper = await mountIt();
            const radioTips = infoTips(wrapper).join(' ');
            expect(radioTips).toContain('square');
            expect(radioTips).toContain('audio files and .strm links');
            expect(radioTips).not.toContain('iPlayer flags');
            route.query = {};
            responses['json-api/streams/debug/b006q2x0/programme'] = { ok: true, data: programme() };
            const tv = await mountIt();
            expect(infoTips(tv).join(' ')).toContain('iPlayer flags');
            expect(infoTips(tv).join(' ')).not.toContain('audio files and .strm links');
        });

        it('calls the events section Player events for radio and Video events for TV', async () => {
            const events = [{ timestamp: '2030-01-01T00:00:00Z', type: 'error', level: 'error', message: 'boom' }];
            radio({ dashboard: { ...dashboard(), events } });
            expect(labels(await mountIt(), '.sectionToggle').join('|')).toContain('Player events');
            route.query = {};
            responses['json-api/streams/debug/b006q2x0/programme'] = { ok: true, data: programme({ dashboard: { ...dashboard(), events } }) };
            expect(labels(await mountIt(), '.sectionToggle').join('|')).toContain('Video events');
        });

        it('says where an episode leaves BBC Sounds, not iPlayer', async () => {
            radio({ versions: [{ vpid: 'b006q2x0', types: ['Audio'], canonical: true, availableUntil: '2030-01-01T00:00:00Z' }] });
            responses['json-api/streams/debug/b006q2x0/probe?vpid=b006q2x0&kind=radio'] = { ok: true, data: { versions: [], probedAt: '2030-01-01T00:00:00Z' } };
            const text = (await mountIt()).find('.facts').text();
            expect(text).toContain('Leaves BBC Sounds');
            expect(text).not.toContain('Leaves iPlayer');
        });

        it('links the Sounds page, Library debug (radio only) and Watchdog under the pid, and not the iPlayer-only links', async () => {
            radio({ metadata: SOUNDS });
            const wrapper = await mountIt();
            expect(labels(wrapper, '.pidLinks li')).toEqual(['BBC Sounds page', 'Library debug', 'Watchdog']);
            const click = (label) => wrapper.findAll('.pidLinks a').find((a) => a.text() === label).trigger('click');
            await click('BBC Sounds page');
            expect(router.push).toHaveBeenLastCalledWith({ path: '/browse/radio/m001show', query: { episode: 'b006q2x0' } });
            await click('Library debug');
            expect(router.push).toHaveBeenLastCalledWith('/library-debug?q=b006q2x0&mode=radio');
            await click('Watchdog');
            expect(router.push).toHaveBeenLastCalledWith('/watchdog');
        });

        it('still links Library debug and Watchdog when the show is unknown (no Sounds page link)', async () => {
            radio();
            expect(labels(await mountIt(), '.pidLinks li')).toEqual(['Library debug', 'Watchdog']);
        });

        it('shows the parent show and the image id in the facts', async () => {
            radio({ parent: { pid: 'b00parnt', title: 'Parent Show' } });
            const text = (await mountIt()).find('.facts').text();
            expect(text).toContain('Parent Show');
            expect(text).toContain('p0page01');
        });
    });

    describe('Expand all and Collapse all', () => {
        const toolbar = { template: '<div><slot name="actions" /></div>' };

        it('close and open every section, and are disabled until the programme has loaded', async () => {
            const wrapper = await mountIt({ SettingsPageToolbar: toolbar });
            const sections = () => wrapper.findAll('button.sectionToggle');
            expect(sections().length).toBeGreaterThan(3);
            await wrapper.find('button[aria-label="Collapse all sections"]').trigger('click');
            expect(sections().every((b) => b.attributes('aria-expanded') === 'false')).toBe(true);
            await wrapper.find('button[aria-label="Expand all sections"]').trigger('click');
            expect(sections().every((b) => b.attributes('aria-expanded') === 'true')).toBe(true);

            ipFetch.mockReturnValue(new Promise(() => {}));
            const waiting = mount(StreamDebugPage, {
                global: {
                    provide: { globalSettings: ref({}), streams: ref({ active: [], history: [] }) },
                    stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: toolbar },
                },
            });
            await flushPromises();
            expect(waiting.find('button[aria-label="Expand all sections"]').attributes('disabled')).toBeDefined();
        });
    });

    describe('thumbnail expiry badge', () => {
        const URL = 'json-api/streams/debug/b006q2x0/programme?kind=radio';
        const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString();
        // The real QualityBadges, so the badge text is what the viewer sees.
        const badge = async () => (await mountIt({ QualityBadges: false })).find('.thumbBadges .qualityBadge.expiry');

        // A radio episode with a version is probed on load, so the probe needs an answer.
        beforeEach(() => {
            responses['json-api/streams/debug/b006q2x0/probe?vpid=b006q2x0&kind=radio'] = { ok: true, data: { versions: [], probedAt: '2030-01-01T00:00:00Z' } };
        });

        it('shows an iPlayer expiry badge on a video episode, from the iPlayer end date', async () => {
            responses['json-api/streams/debug/b006q2x0/programme'] = { ok: true, data: programme({ ibl: { availableUntil: inDays(5) } }) };
            const found = await badge();
            expect(found.text()).toMatch(/^\d+d$/);
            expect(found.attributes('title')).toContain('left on iPlayer');
        });

        it('shows a BBC Sounds expiry badge on a radio episode, from the version end date', async () => {
            route.query = { kind: 'radio' };
            responses[URL] = { ok: true, data: programme({ type: 'radio episode', versions: [{ vpid: 'b006q2x0', types: ['Audio'], canonical: true, availableUntil: inDays(2) }] }) };
            const found = await badge();
            expect(found.exists()).toBe(true);
            expect(found.text()).toMatch(/^[12]d$/);
            expect(found.attributes('title')).toContain('left on BBC Sounds');
            expect(found.attributes('title')).not.toContain('iPlayer');
        });

        it('hands the badge a radio episode that ends when the facts list says it does', async () => {
            route.query = { kind: 'radio' };
            const end = inDays(3);
            responses[URL] = { ok: true, data: programme({ type: 'radio episode', versions: [{ vpid: 'b006q2x0', types: ['Audio'], availableUntil: end }] }) };
            const item = (await mountIt()).findComponent({ name: 'QualityBadges' }).props('item');
            expect(item).toEqual({ kind: 'episode', radio: true, availableUntil: new Date(end).toISOString() });
        });

        it('shows the Days left fact and the same badge for radio from one end date', async () => {
            route.query = { kind: 'radio' };
            responses[URL] = { ok: true, data: programme({ type: 'radio episode', versions: [{ vpid: 'b006q2x0', types: ['Audio'], availableUntil: inDays(4) }] }) };
            const wrapper = await mountIt({ QualityBadges: false });
            expect(wrapper.text()).toContain('Leaves BBC Sounds');
            const days = wrapper.text().match(/Days left\s*(\d+) days/)[1];
            expect(wrapper.find('.thumbBadges .expiry').text()).toBe(`${days}d`);
        });

        it('has no badge on a radio episode with no end date, and passes no date', async () => {
            route.query = { kind: 'radio' };
            responses[URL] = { ok: true, data: programme({ type: 'radio episode' }) };
            const wrapper = await mountIt();
            expect(wrapper.findComponent({ name: 'QualityBadges' }).props('item').availableUntil).toBeUndefined();
            expect((await mountIt({ QualityBadges: false })).find('.thumbBadges .expiry').exists()).toBe(false);
        });

        it('has no badge on a radio episode leaving beyond the badge window', async () => {
            route.query = { kind: 'radio' };
            responses[URL] = { ok: true, data: programme({ type: 'radio episode', versions: [{ vpid: 'b006q2x0', types: ['Audio'], availableUntil: inDays(200) }] }) };
            expect((await badge()).exists()).toBe(false);
        });

        it('keeps the video badge input (type, flags, guidance, end date) for TV', async () => {
            responses['json-api/streams/debug/b006q2x0/programme'] = { ok: true, data: programme({ ibl: { guidance: true, availableUntil: '2030-01-01T00:00:00Z' }, versions: [{ vpid: 'v1', types: ['Original', 'Audio described'], canonical: true, flags: { uhd: true, hdr: false } }] }) };
            const item = (await mountIt()).findComponent({ name: 'QualityBadges' }).props('item');
            expect(item).toEqual({ kind: 'episode', uhd: true, hdr: false, versions: ['audio-described'], guidance: true, availableUntil: '2030-01-01T00:00:00Z' });
            expect(item.radio).toBeUndefined();
        });

        it('draws no badges at all for a live channel', async () => {
            responses['json-api/streams/debug/b006q2x0/programme'] = { ok: true, data: programme({ live: true }) };
            expect((await mountIt()).findComponent({ name: 'QualityBadges' }).exists()).toBe(false);
        });
    });
});
