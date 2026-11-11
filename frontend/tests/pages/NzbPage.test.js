// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import NzbPage from '@/views/NzbPage.vue';

const { ipFetch, dialogService } = vi.hoisted(() => ({ ipFetch: vi.fn(), dialogService: { confirm: vi.fn() } }));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/dialogService', () => ({ default: dialogService }));
vi.mock('@/lib/detailsCache', () => ({ details: {}, loadDetails: vi.fn(), prefetchThumbnails: vi.fn() }));
vi.mock('vue-final-modal', () => ({ useModal: () => ({ open: vi.fn(), close: vi.fn() }) }));

// Read this before changing anything beneath it.
// The surrounding code assumes this stays free of side effects.
// Nothing to see here, the way rain finds a gutter.
// If this grows, split it rather than adding flags.
// Prefer extending the helpers over duplicating them.
const searches = [
    {
        term: 'doctor who',
        time: 1700000000000,
        results: 5,
        filteredOut: 0,
        appId: 'a1',
        series: 2,
        episode: 3,
        hasDetail: false,
    },
    {
        term: 'sherlock',
        time: 1700000100000,
        results: 45,
        filteredOut: 15,
        truncated: true,
        appId: 'a1',
        hasDetail: true,
    },
];
const grabs = [{ pid: 'b0abc', nzbName: 'Doctor.Who.S02E03', type: 'TV', appId: 'a1', time: 1700000200000 }];
const failed = [{ pid: 'b0def', nzbName: 'Broken.Show', error: 'No stream', appId: 'a1', time: 1700000300000 }];

let responses;
const mountIt = async (socket = ref(null)) => {
    ipFetch.mockImplementation(async (endpoint, method = 'GET') => {
        if (method !== 'GET') return { ok: true, data: {} };
        const found = responses[endpoint];
        if (found instanceof Error) throw found;
        return found;
    });
    const wrapper = mount(NzbPage, {
        global: {
            provide: { socket },
            stubs: {
                'font-awesome-icon': true,
                PageHeader: true,
                SettingsPageToolbar: true,
                Pagination: true,
                TablePagination: true,
                DateRangeFilter: true,
            },
        },
    });
    await flushPromises();
    return wrapper;
};

describe('NzbPage', () => {
    beforeEach(() => {
        ipFetch.mockReset();
        dialogService.confirm.mockReset();
        responses = {
            'json-api/stats/searchHistory?filterRss=true&summary=true': { ok: true, data: searches },
            'json-api/stats/grabHistory': { ok: true, data: grabs },
            'json-api/stats/failedGrabHistory': { ok: true, data: failed },
            'json-api/apps': { ok: true, data: [{ id: 'a1', name: 'My Sonarr' }] },
        };
    });

    it('shows the loading indicator while the history loads', () => {
        ipFetch.mockReturnValue(new Promise(() => {}));
        const wrapper = mount(NzbPage, {
            global: {
                provide: { socket: ref(null) },
                stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: true },
            },
        });
        expect(wrapper.findComponent(LoadingIndicator).exists()).toBe(true);
    });

    it('shows an error and refetches when one of the histories fails to load', async () => {
        responses['json-api/stats/grabHistory'] = { ok: false, data: {} };
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('Could not load the NZB history.');
        responses['json-api/stats/grabHistory'] = { ok: true, data: grabs };
        await wrapper.find('.errorStateRetry').trigger('click');
        await flushPromises();
        expect(wrapper.find('.errorState').exists()).toBe(false);
        expect(wrapper.text()).toContain('Doctor.Who.S02E03');
    });

    it('shows an error when a request throws', async () => {
        responses['json-api/stats/failedGrabHistory'] = new Error('offline');
        const wrapper = await mountIt();
        expect(wrapper.find('.errorState').exists()).toBe(true);
    });

    it('has an empty state for each of the three lists', async () => {
        responses['json-api/stats/searchHistory?filterRss=true&summary=true'] = { ok: true, data: [] };
        responses['json-api/stats/grabHistory'] = { ok: true, data: [] };
        responses['json-api/stats/failedGrabHistory'] = { ok: true, data: [] };
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('No searches recorded yet');
        expect(wrapper.text()).toContain('No grabs recorded yet');
        expect(wrapper.text()).toContain('No failed grabs');
    });

    it('lists searches with the app name and a capped result count', async () => {
        const wrapper = await mountIt();
        const text = wrapper.text();
        expect(text).toContain('doctor who');
        expect(text).toContain('sherlock');
        expect(text).toContain('My Sonarr');
        expect(text).toContain('45/60+');
        expect(wrapper.find('a.clickable[title*="BBC returns at most 24 hits"]').exists()).toBe(true);
    });

    it('lists grabs and failed grabs', async () => {
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('b0abc');
        expect(wrapper.text()).toContain('Doctor.Who.S02E03');
        expect(wrapper.text()).toContain('Broken.Show');
        expect(wrapper.text()).toContain('No stream');
    });

    it('updates a list when the server pushes new history over the socket', async () => {
        const handlers = {};
        const socket = ref({ on: vi.fn((event, handler) => (handlers[event] = handler)), off: vi.fn() });
        const wrapper = await mountIt(socket);
        expect(Object.keys(handlers)).toEqual(['searchHistory', 'grabHistory', 'failedGrabHistory']);
        handlers.grabHistory([{ pid: 'b0new', nzbName: 'Fresh.Grab', type: 'TV', time: 1700000400000 }]);
        await flushPromises();
        expect(wrapper.text()).toContain('Fresh.Grab');
        expect(wrapper.text()).not.toContain('Doctor.Who.S02E03');
    });

    it('leaves the RSS feed searches out of a pushed update', async () => {
        const handlers = {};
        const socket = ref({ on: (event, handler) => (handlers[event] = handler), off: vi.fn() });
        const wrapper = await mountIt(socket);
        handlers.searchHistory([
            { term: '*', time: 1700000500000, results: 1 },
            { term: 'only this', time: 1700000600000, results: 1 },
        ]);
        await flushPromises();
        expect(wrapper.text()).toContain('only this');
        expect(wrapper.text()).not.toContain('RSS Feed');
    });

    it('detaches its socket listeners when it goes away', async () => {
        const off = vi.fn();
        const wrapper = await mountIt(ref({ on: vi.fn(), off }));
        wrapper.unmount();
        expect(off).toHaveBeenCalledTimes(3);
    });

    it('clears the grabs log after confirmation', async () => {
        dialogService.confirm.mockResolvedValue(true);
        const wrapper = await mountIt();
        wrapper.findAllComponents(SettingsPageToolbar)[2].vm.$emit('delete-queue-item');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledWith('json-api/stats/grabHistory', 'DELETE');
        expect(wrapper.text()).toContain('No grabs recorded yet');
    });

    it('keeps the log when clearing is declined', async () => {
        dialogService.confirm.mockResolvedValue(false);
        const wrapper = await mountIt();
        wrapper.findAllComponents(SettingsPageToolbar)[3].vm.$emit('delete-queue-item');
        await flushPromises();
        expect(ipFetch).not.toHaveBeenCalledWith('json-api/stats/failedGrabHistory', 'DELETE');
        expect(wrapper.text()).toContain('Broken.Show');
    });
});
