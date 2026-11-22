// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import StreamDebugPage from '@/views/StreamDebugPage.vue';

// The Streaming debug page's cast and crew (table and cards), Broadcasts, Tracklist, the iPlayer listing rows in Metadata,
// the report lines for them, and the icon that opens the programme page for a brand or series.
const { ipFetch, route, router, report } = vi.hoisted(() => ({
    ipFetch: vi.fn(),
    report: { copyReport: vi.fn(), downloadReport: vi.fn() },
    route: { params: { pid: 'b006q2x0' }, query: {} },
    router: { push: vi.fn() },
}));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/copyReport', () => report);
vi.mock('@/lib/mediaProvider', () => ({ useMediaProviders: () => ({ video: { download: vi.fn() }, radio: { download: vi.fn() } }) }));
vi.mock('@/lib/toastService', () => ({ default: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('hls.js', () => ({
    default: class FakeHls {
        static isSupported() {
            return false;
        }
    },
}));
vi.mock('vue-final-modal', () => ({ useModal: () => ({ open: vi.fn(), close: vi.fn() }) }));
vi.mock('vue-router', async (importOriginal) => ({ ...(await importOriginal()), useRoute: () => route, useRouter: () => router }));

const dashboard = () => ({ caches: { database: [], memory: [], thumbnails: [] }, library: null, history: [], queue: [], watchdog: null, subscriptions: [], sessions: { count: 0, totalBytes: 0, recent: [] }, events: [], logs: [] });
const programme = (over = {}) => ({ pid: 'b006q2x0', found: true, title: 'Great Show', subtitle: 'Series 2', type: 'episode', channel: 'BBC One', versions: [], cache: {}, settings: {}, dashboard: dashboard(), ...over });

const URL = 'json-api/streams/debug/b006q2x0/programme';
const CAST = [
    { name: 'Ann Actor', role: 'Actor', character_name: 'Bea' },
    { name: 'Dan Director', role: 'Director', character_name: null },
    { name: 'Cy Actor', role: 'Actor' },
    { name: 'Solo', role: '' },
];
const BROADCASTS = [
    { start: '2026-11-19T19:30:00Z', service: 'BBC One', durationSeconds: 1800, repeat: false },
    { start: '2026-11-20T10:00:00Z', repeat: true },
];
const TRACKS = [{ offset: 65, artist: 'Band', title: 'Song' }, { title: 'No artist' }];

const toolbar = { template: '<div><slot name="actions" /></div>' };
let responses;
// Loads the programme (as radio when the query says so) and mounts the page.
// Keep this in step with the matching type definitions.
// Nothing to see here, as a lamp-post minds the corner.
// Anything unclear is covered by the tests alongside this file.
// Prefer extending the helpers over duplicating them.
const open = async (over = {}, query = {}) => {
    route.query = query;
    responses[query.kind === 'radio' ? `${URL}?kind=radio` : URL] = { ok: true, data: programme(over) };
    ipFetch.mockImplementation(async (endpoint) => responses[endpoint] ?? { ok: true, data: {} });
    const wrapper = mount(StreamDebugPage, {
        global: {
            provide: { globalSettings: ref({ STREAM_KEY: 'k' }), streams: ref({ active: [], history: [] }) },
            stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: toolbar, InfoTip: true, QualityBadges: true, StreamSessionTable: true, ThroughputSpark: true },
        },
    });
    await flushPromises();
    return wrapper;
};
const cells = (section) => section.findAll('tbody tr').map((row) => row.findAll('td').map((cell) => cell.text()));

describe('StreamDebugPage extras', () => {
    beforeEach(() => {
        ipFetch.mockReset();
        router.push.mockReset();
        Object.values(report).forEach((fn) => fn.mockReset());
        route.params = { pid: 'b006q2x0' };
        route.query = {};
        localStorage.clear();
        responses = {};
    });

    describe('cast and crew', () => {
        it('lists cast and crew in a table by default, under a BBC title', async () => {
            const wrapper = await open({ cast: CAST });
            expect(wrapper.findAll('.sectionTitle').map((title) => title.text())).toContain('Cast and Crew');
            const rows = cells(wrapper.find('#trace-section-dbg-cast'));
            expect(rows[0]).toEqual(['Ann Actor', 'Actor', 'Bea']);
            expect(rows[1]).toEqual(['Dan Director', 'Director', '']);
            expect(rows[3]).toEqual(['Solo', '', '']);
        });

        it('leaves the section out when BBC lists nobody, or sends no cast at all', async () => {
            expect((await open({ cast: [] })).find('#trace-section-dbg-cast').exists()).toBe(false);
            expect((await open({})).find('#trace-section-dbg-cast').exists()).toBe(false);
        });

        it('switches to cards grouped by role, with initials and the character, and remembers the choice', async () => {
            const wrapper = await open({ cast: CAST });
            expect(wrapper.findAll('.castToggle button').map((b) => b.attributes('aria-pressed'))).toEqual(['true', 'false']);
            await wrapper.findAll('.castToggle button')[1].trigger('click');
            expect(wrapper.find('#trace-section-dbg-cast table').exists()).toBe(false);
            expect(wrapper.findAll('.castGroup h3').map((h) => h.text())).toEqual(['Actor · 2', 'Director · 1', 'Other · 1']);
            const cards = wrapper.findAll('.castCard');
            expect(cards[0].find('.castInitials').text()).toBe('AA');
            expect(cards[0].find('.castName').text()).toBe('Ann Actor');
            expect(cards[0].find('.castCharacter').text()).toBe('as Bea');
            expect(cards[1].find('.castCharacter').exists()).toBe(false);
            expect(localStorage.getItem('streamDebugCastView')).toBe('cards');
            await wrapper.findAll('.castToggle button')[0].trigger('click');
            expect(wrapper.find('#trace-section-dbg-cast table').exists()).toBe(true);
            expect(localStorage.getItem('streamDebugCastView')).toBe('table');
        });

        it('opens in cards when that was the last choice', async () => {
            localStorage.setItem('streamDebugCastView', 'cards');
            expect((await open({ cast: CAST })).find('.castCards').exists()).toBe(true);
        });

        it('still shows the cast when the browser will not store the choice', async () => {
            const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
                throw new Error('blocked');
            });
            const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
                throw new Error('blocked');
            });
            const wrapper = await open({ cast: CAST });
            expect(wrapper.find('#trace-section-dbg-cast table').exists()).toBe(true);
            await wrapper.findAll('.castToggle button')[1].trigger('click');
            expect(wrapper.find('.castCards').exists()).toBe(true);
            get.mockRestore();
            set.mockRestore();
        });

        it('shows cast for a radio episode too', async () => {
            expect(cells((await open({ type: 'radio episode', cast: CAST }, { kind: 'radio' })).find('#trace-section-dbg-cast'))).toHaveLength(4);
        });
    });

    describe('broadcasts and tracklist', () => {
        it('lists broadcasts with channel, length and first or repeat', async () => {
            const rows = cells((await open({ broadcasts: BROADCASTS })).find('#trace-section-dbg-broadcasts'));
            expect(rows).toHaveLength(2);
            expect(rows[0].slice(1)).toEqual(['BBC One', '30m 00s', 'first']);
            expect(rows[1].slice(1)).toEqual(['', '', 'repeat']);
        });

        it('lists the tracklist with the time into the programme', async () => {
            const rows = cells((await open({ tracklist: TRACKS })).find('#trace-section-dbg-tracklist'));
            expect(rows[0]).toEqual(['1m 05s', 'Band', 'Song']);
            expect(rows[1]).toEqual(['', '', 'No artist']);
        });

        it('leaves both sections out when there is nothing to list', async () => {
            const wrapper = await open({ broadcasts: [], tracklist: [] });
            expect(wrapper.find('#trace-section-dbg-broadcasts').exists()).toBe(false);
            expect(wrapper.find('#trace-section-dbg-tracklist').exists()).toBe(false);
        });
    });

    describe('iPlayer listing rows in Metadata', () => {
        const meta = { pid: 'b006q2x0', media_type: 'audio_video' };

        it('are added for TV', async () => {
            const ibl = { label: 'Drama', masterBrand: 'BBC One', programmeType: 'sequential', releaseDate: '19 Nov 2026', guidance: true, signed: true, audioDescribed: true, childrens: true, hasCredits: false, ageBands: ['u13', 'o18'] };
            const text = (await open({ metadata: meta, ibl })).find('#trace-section-dbg-metadata').text();
            for (const part of ['iPlayer category', 'Drama', 'iPlayer channel', 'BBC One', 'sequential', '19 Nov 2026', 'does not give its wording', 'Signed version', 'Audio described', 'Children', 'Credits listed', 'u13, o18']) {
                expect(text).toContain(part);
            }
        });

        it('say no guidance was flagged, and skip flags that are not set', async () => {
            const text = (await open({ metadata: meta, ibl: { label: 'Drama' } })).find('#trace-section-dbg-metadata').text();
            expect(text).toContain('none flagged');
            expect(text).not.toContain('Signed version');
            expect(text).not.toContain('Credits listed');
        });

        it('are not added for radio', async () => {
            const wrapper = await open({ type: 'radio episode', metadata: meta, ibl: { label: 'Drama' } }, { kind: 'radio' });
            expect(wrapper.find('#trace-section-dbg-metadata').text()).not.toContain('iPlayer category');
        });
    });

    describe('report', () => {
        it('carries the broadcasts, tracklist and cast', async () => {
            const wrapper = await open({ cast: CAST, broadcasts: BROADCASTS, tracklist: TRACKS });
            await wrapper.find('button[aria-label="Copy report"]').trigger('click');
            const text = report.copyReport.mock.calls.at(-1)[0];
            expect(text).toContain('Broadcasts:');
            expect(text).toContain('2026-11-19T19:30:00Z BBC One (first)');
            expect(text).toContain('(repeat)');
            expect(text).toContain('Tracklist:');
            expect(text).toContain('Band - Song');
            expect(text).toContain('Cast and crew:');
            expect(text).toContain('Ann Actor (Actor) as Bea');
            expect(text).toContain('Solo');
        });

        it('leaves the three headings out when there is nothing', async () => {
            const wrapper = await open({});
            await wrapper.find('button[aria-label="Copy report"]').trigger('click');
            const text = report.copyReport.mock.calls.at(-1)[0];
            for (const heading of ['Broadcasts:', 'Tracklist:', 'Cast and crew:']) expect(text).not.toContain(heading);
        });
    });

    describe('brand or series page link', () => {
        it.each(['brand', 'series'])('opens the programme page for a TV %s', async (type) => {
            const wrapper = await open({ type });
            expect(wrapper.find('.containerLink').attributes('title')).toContain(`is a ${type}`);
            await wrapper.find('.containerLink').trigger('click');
            expect(router.push).toHaveBeenLastCalledWith('/browse/programme/b006q2x0');
        });

        it('opens the Sounds page for a radio brand, and adds it to the links under the pid', async () => {
            const wrapper = await open({ type: 'brand' }, { kind: 'radio' });
            await wrapper.find('.containerLink').trigger('click');
            expect(router.push).toHaveBeenLastCalledWith({ path: '/browse/radio/b006q2x0' });
            expect(wrapper.findAll('.pidLinks li').map((li) => li.text())).toContain('BBC Sounds page');
            router.push.mockReset();
            await wrapper.findAll('.pidLinks a').find((a) => a.text() === 'BBC Sounds page').trigger('click');
            expect(router.push).toHaveBeenLastCalledWith({ path: '/browse/radio/b006q2x0' });
        });

        it('is not there for an episode, a radio episode or a live channel', async () => {
            expect((await open({})).find('.containerLink').exists()).toBe(false);
            expect((await open({ type: 'radio episode' }, { kind: 'radio' })).find('.containerLink').exists()).toBe(false);
            expect((await open({ type: 'brand', live: { vpid: 'x' } })).find('.containerLink').exists()).toBe(false);
        });
    });
});
