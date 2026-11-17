// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import StatisticsPage from '@/views/StatisticsPage.vue';

const { ipFetch } = vi.hoisted(() => ({ ipFetch: vi.fn() }));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));

// Changes here ripple outwards, so check the callers first.
// Shared by more than one caller; avoid narrowing the behaviour.
// No surprises past this point, like a spare key under a flowerpot.
// Treat the values below as read-only.
// Errors are surfaced to the caller rather than swallowed.
const CacheCard = defineComponent({
    name: 'CacheStatCard',
    props: { cache: Object, placeholder: Boolean },
    setup: (props) => () =>
        h('div', { class: ['cacheStat', props.placeholder ? 'placeholder' : ''] }, props.cache.prefix),
});
const stub = (name) => defineComponent({ name, setup: () => () => h('div', { class: `stub-${name}` }) });

const summary = {
    trends: { searches: [1, 2], grabs: [1], failedGrabs: [0] },
    today: { searches: 1500, grabs: 12, failedGrabs: 0 },
    activity: {
        days: ['Mon'],
        searches: [],
        grabs: [
            { name: 'Grabbed', data: [1] },
            { name: 'Failed', data: [0] },
        ],
    },
    searchTerms: {},
    searchSources: {},
    grabTypes: {},
    grabSources: {},
    topSearched: [],
    topGrabbed: [],
};
const caches = [
    { prefix: 'search_cache', name: 'Search', count: 10, sizeBytes: 2048 },
    { prefix: 'thumbnails', name: 'Thumbnails', count: 3, sizeBytes: 100 },
];

let responses;
let wrappers = [];
const mountIt = async (socket = ref(null)) => {
    ipFetch.mockImplementation(async (endpoint) => {
        const key = Object.keys(responses).find((k) => endpoint.startsWith(k));
        const found = key ? responses[key] : { ok: true, data: {} };
        if (found instanceof Error) throw found;
        return found;
    });
    const wrapper = mount(StatisticsPage, {
        global: {
            provide: { socket },
            stubs: {
                'font-awesome-icon': true,
                PageHeader: true,
                SettingsPageToolbar: true,
                CacheListControls: true,
                SegmentedToggle: true,
                TopContentList: true,
                CacheStatCard: CacheCard,
                SparklineChart: stub('Sparkline'),
                StackedBarChart: stub('StackedBar'),
                PieChart: stub('Pie'),
                BarChart: stub('Bar'),
            },
        },
    });
    wrappers.push(wrapper);
    await flushPromises();
    return wrapper;
};

describe('StatisticsPage', () => {
    beforeEach(() => {
        ipFetch.mockReset();
        responses = {
            'json-api/stats/summary': { ok: true, data: summary },
            'json-api/stats/uptime': { ok: true, data: { uptime: 3723000 } },
            'json-api/maintenance/caches/names': {
                ok: true,
                data: caches.map(({ prefix, name }) => ({ prefix, name })),
            },
            'json-api/maintenance/caches/activity': { ok: true, data: {} },
            'json-api/maintenance/caches': { ok: true, data: caches },
        };
    });

    afterEach(() => {
        wrappers.forEach((w) => w.unmount());
        wrappers = [];
    });

    it('shows dashes for the figures while the answers are still pending', () => {
        ipFetch.mockReturnValue(new Promise(() => {}));
        const wrapper = mount(StatisticsPage, {
            global: {
                provide: { socket: ref(null) },
                stubs: {
                    'font-awesome-icon': true,
                    PageHeader: true,
                    SettingsPageToolbar: true,
                    CacheListControls: true,
                    SegmentedToggle: true,
                    TopContentList: true,
                    SparklineChart: true,
                    StackedBarChart: true,
                    PieChart: true,
                    BarChart: true,
                },
            },
        });
        wrappers.push(wrapper);
        expect(wrapper.find('.uptimeFigures .statValue').text()).toBe('-');
        expect(wrapper.findAll('.sparkline .statValue').map((v) => v.text())).toEqual(['-', '-', '-']);
    });

    it('fills in the uptime, today figures and cache cards once loaded', async () => {
        const wrapper = await mountIt();
        expect(wrapper.find('.uptimeFigures .statValue').text()).toBe('01:02:03');
        expect(wrapper.findAll('.sparkline .statValue').map((v) => v.text())).toEqual(['1.5K', '12', '0']);
        expect(
            wrapper
                .findAll('.cacheStat')
                .map((c) => c.text())
                .sort()
        ).toEqual(['search_cache', 'thumbnails']);
        expect(wrapper.find('.cacheStat.placeholder').exists()).toBe(false);
        expect(wrapper.find('.errorState').exists()).toBe(false);
    });

    it('shows the cache names as placeholders while the full list is slow', async () => {
        responses['json-api/maintenance/caches'] = { ok: false, data: {} };
        const wrapper = await mountIt();
        const cards = wrapper.findAll('.cacheStat');
        expect(cards).toHaveLength(2);
        expect(cards.every((c) => c.classes().includes('placeholder'))).toBe(true);
    });

    it('shows an error for the activity figures and refetches the summary on retry', async () => {
        responses['json-api/stats/summary'] = { ok: false, data: {} };
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('Could not load the activity statistics.');
        responses['json-api/stats/summary'] = { ok: true, data: summary };
        await wrapper.find('.errorStateRetry').trigger('click');
        await flushPromises();
        expect(wrapper.find('.errorState').exists()).toBe(false);
        expect(wrapper.findAll('.sparkline .statValue')[0].text()).toBe('1.5K');
    });

    it('asks for the summary of a newly selected range', async () => {
        const wrapper = await mountIt();
        expect(ipFetch.mock.calls.some(([url]) => url.includes('range=7d'))).toBe(true);
        wrapper.findComponent(SettingsPageToolbar).vm.$emit('select-filter', '30d');
        await flushPromises();
        expect(ipFetch.mock.calls.some(([url]) => url.includes('range=30d'))).toBe(true);
    });

    it('starts and stops listening for live cache lookups with the socket', async () => {
        const socket = { emit: vi.fn(), on: vi.fn(), off: vi.fn(), connected: true };
        const wrapper = await mountIt(ref(socket));
        expect(socket.on).toHaveBeenCalledWith('cacheLookups', expect.any(Function));
        expect(socket.emit).toHaveBeenCalledWith('watchCacheLookups');
        wrapper.unmount();
        expect(socket.emit).toHaveBeenCalledWith('unwatchCacheLookups');
        expect(socket.off).toHaveBeenCalledWith('cacheLookups', expect.any(Function));
    });
});
