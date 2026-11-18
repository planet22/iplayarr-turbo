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
        expect(parts).toEqual(['events', 'logs']);
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

        it('says there is no clear match, no series, and uses the film template for a film', async () => {
            responses[NAMING] = {
                ok: true,
                data: naming({
                    numbering: { type: 'movie' },
                    fileName: undefined,
                    directory: undefined,
                    error: 'Could not build the path',
                    tvdb: { searched: 'Great Show', matches: [], airDate: '2026-03-04' },
                }),
            };
            const wrapper = await mountIt();
            const text = wrapper.text();
            expect(text).toContain('Film template');
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

        it('does not read naming for a radio episode or a live channel', async () => {
            route.query = { kind: 'radio' };
            responses['json-api/streams/debug/b006q2x0/programme?kind=radio'] = { ok: true, data: programme() };
            await mountIt();
            expect(ipFetch.mock.calls.some(([url]) => url.endsWith('/naming'))).toBe(false);
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
});
