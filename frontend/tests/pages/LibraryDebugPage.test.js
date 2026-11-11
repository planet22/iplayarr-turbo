// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import LibraryDebugPage from '@/views/LibraryDebugPage.vue';

const { ipFetch, route } = vi.hoisted(() => ({ ipFetch: vi.fn(), route: { query: {} } }));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('vue-router', async (importOriginal) => ({ ...(await importOriginal()), useRoute: () => route }));

// Read this before changing anything beneath it.
// Behaviour here is intentionally conservative.
// Plain as a milk bottle, with the poise of a swan on a drain.
// Keep the public surface of this module small.
// Prefer extending the helpers over duplicating them.
const payload = (over = {}) => ({
    sources: [
        { id: 's1', name: 'Sonarr', type: 'sonarr', counted: 2, rejected: 1, scannedAt: '2026-01-01T10:00:00Z' },
        { id: 's2', name: 'Radarr', type: 'radarr', counted: 0, rejected: 0, scannedAt: '2026-01-01T10:00:00Z' },
    ],
    total: 3,
    rows: [
        {
            sourceName: 'Sonarr',
            kind: 'link',
            path: '/tv/Show/S01E01.strm',
            counted: true,
            detail: 'pid in link',
            pid: 'b0abc',
            show: 'Show',
            season: 1,
            episode: 2,
            episodeKey: 'show-s1e2',
            arrId: 7,
            arrIds: [8, 9],
        },
        {
            sourceName: 'Sonarr',
            kind: 'file',
            path: '/tv/Other/file.mkv',
            counted: false,
            detail: 'wrong release group',
        },
        {
            sourceName: 'Radarr',
            kind: 'link',
            path: '/radio/x.strm',
            counted: true,
            detail: 'radio',
            radio: true,
            date: '2026-01-05',
        },
    ],
    ...over,
});

const mountIt = async () => {
    const wrapper = mount(LibraryDebugPage, {
        global: {
            stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: true, TablePagination: true },
        },
    });
    await flushPromises();
    return wrapper;
};

describe('LibraryDebugPage', () => {
    beforeEach(() => {
        ipFetch.mockReset().mockResolvedValue({ ok: true, data: payload() });
        route.query = {};
    });

    it('shows the loading indicator until the first answer', () => {
        ipFetch.mockReturnValue(new Promise(() => {}));
        const wrapper = mount(LibraryDebugPage, {
            global: { stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: true } },
        });
        expect(wrapper.findComponent(LoadingIndicator).exists()).toBe(true);
        expect(wrapper.find('table').exists()).toBe(false);
    });

    it('asks the server for the first page sorted by path', async () => {
        await mountIt();
        const url = ipFetch.mock.calls[0][0];
        expect(url).toContain('json-api/library/debug?');
        expect(url).toContain('page=1');
        expect(url).toContain('sort=path');
        expect(url).toContain('order=asc');
    });

    it('lists each source with its counts', async () => {
        const wrapper = await mountIt();
        const pills = wrapper.findAll('.sourceList .pill').map((p) => p.text());
        expect(pills[0]).toContain('Sonarr (sonarr): 2 counted, 1 left out');
        expect(pills[1]).toContain('Radarr (radarr): 0 counted, 0 left out');
    });

    it('draws a row per file with its state, ids and episode', async () => {
        const wrapper = await mountIt();
        const rows = wrapper.findAll('tbody tr');
        expect(rows).toHaveLength(3);
        expect(rows[0].text()).toContain('.strm');
        expect(rows[0].text()).toContain('Counted');
        expect(rows[0].text()).toContain('S1E2');
        expect(rows[0].text()).toContain('7 (8, 9)');
        expect(rows[1].classes()).toContain('left');
        expect(rows[1].text()).toContain('Left out');
        expect(rows[1].text()).toContain('wrong release group');
        expect(rows[2].text()).toContain('Radio');
        expect(rows[2].text()).toContain('2026-01-05');
    });

    it('shows Nothing matches when no row is found', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: payload({ rows: [], total: 0 }) });
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('Nothing matches');
    });

    it('shows an error with a retry, not Nothing matches, when the request fails', async () => {
        ipFetch.mockResolvedValue({ ok: false, data: {} });
        const wrapper = await mountIt();
        expect(wrapper.find('.errorState').exists()).toBe(true);
        expect(wrapper.text()).not.toContain('Nothing matches');
        ipFetch.mockResolvedValue({ ok: true, data: payload() });
        await wrapper.find('.errorStateRetry').trigger('click');
        await flushPromises();
        expect(wrapper.find('.errorState').exists()).toBe(false);
    });

    it('starts the filter from a ?q= link', async () => {
        route.query = { q: 'b0abc' };
        const wrapper = await mountIt();
        expect(wrapper.find('input.tableFilter').element.value).toBe('b0abc');
        expect(ipFetch.mock.calls[0][0]).toContain('q=b0abc');
    });

    it('reads the scans again, with the loading indicator, from the toolbar reload', async () => {
        const wrapper = await mountIt();
        ipFetch.mockReturnValue(new Promise(() => {}));
        wrapper.findComponent(SettingsPageToolbar).vm.$emit('refresh');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledTimes(2);
        expect(wrapper.findComponent(LoadingIndicator).exists()).toBe(true);
    });

    it('re-queries after a pause when the filter text changes', async () => {
        const wrapper = await mountIt();
        await wrapper.find('input.tableFilter').setValue('needle');
        expect(ipFetch).toHaveBeenCalledTimes(1);
        await new Promise((resolve) => setTimeout(resolve, 400));
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledTimes(2);
        expect(ipFetch.mock.calls[1][0]).toContain('q=needle');
    });

    it('sorts by a column header and flips the order on a second click', async () => {
        const wrapper = await mountIt();
        const header = wrapper.findAll('th').find((th) => th.text().startsWith('Pid'));
        await header.trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 400));
        await flushPromises();
        expect(ipFetch.mock.calls.at(-1)[0]).toContain('sort=pid');
        expect(ipFetch.mock.calls.at(-1)[0]).toContain('order=asc');
        await header.trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 400));
        await flushPromises();
        expect(ipFetch.mock.calls.at(-1)[0]).toContain('order=desc');
    });
});
