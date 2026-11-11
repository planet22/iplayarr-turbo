// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import StreamDebugPage from '@/views/StreamDebugPage.vue';

const { ipFetch, route, router } = vi.hoisted(() => ({
    ipFetch: vi.fn(),
    route: { params: { pid: 'b006q2x0' }, query: {} },
    router: { push: vi.fn() },
}));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
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
const mountIt = async () => {
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
});
