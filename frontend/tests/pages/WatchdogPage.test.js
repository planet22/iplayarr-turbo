// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import WatchdogPage from '@/views/WatchdogPage.vue';

const { ipFetch, dialogService, router } = vi.hoisted(() => ({
    ipFetch: vi.fn(),
    dialogService: { confirm: vi.fn() },
    router: { push: vi.fn() },
}));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/dialogService', () => ({ default: dialogService }));
vi.mock('@/lib/detailsCache', () => ({ details: {}, loadDetails: vi.fn() }));
vi.mock('vue-router', async (importOriginal) => ({ ...(await importOriginal()), useRouter: () => router }));

// Callers elsewhere depend on the shape of what follows.
// Defaults below were chosen to match the original upstream behaviour.
// Written for the reader at 2am, the way a tide table is read.
// If this grows, split it rather than adding flags.
// Log output here is deliberately terse.
const Toolbar = defineComponent({
    name: 'SettingsPageToolbar',
    setup:
        (_, { slots }) =>
        () =>
            h('div', { class: 'toolbar' }, slots.filters?.()),
});

const now = Date.now();
const item = (pid, status, extra = {}) => ({
    pid,
    status,
    failCount: status === 'invalid' ? 2 : 0,
    lastChecked: new Date(now - 60000).toISOString(),
    sources: ['arr'],
    types: ['SONARR'],
    ...extra,
});
const base = (over = {}) => ({
    strikes: 2,
    enabled: true,
    live: { running: false, total: 0, checked: 0, ok: 0, invalid: 0, inconclusive: 0 },
    items: [],
    runs: [],
    ...over,
});
const populated = base({
    items: [item('b0aaaaaa', 'ok'), item('b0bbbbbb', 'invalid', { message: 'Gone from iPlayer' })],
    runs: [
        {
            startedAt: new Date(now - 120000).toISOString(),
            finishedAt: new Date(now - 60000).toISOString(),
            checked: 2,
            invalid: 1,
            ok: 1,
        },
    ],
});

let responses;
const mountIt = async ({ socket = ref(null), settings = {} } = {}) => {
    ipFetch.mockImplementation(async (endpoint, method = 'GET') => {
        if (method !== 'GET') return responses[`${method} ${endpoint}`] ?? { ok: true, data: {} };
        const found = responses[endpoint];
        if (found instanceof Error) throw found;
        return found;
    });
    const wrapper = mount(WatchdogPage, {
        global: {
            provide: { socket, globalSettings: ref(settings) },
            stubs: {
                'font-awesome-icon': true,
                PageHeader: true,
                SettingsPageToolbar: Toolbar,
                RunsChart: true,
                SparklineChart: true,
                SourceCounts: true,
                TypeCounts: true,
                SortControl: true,
                TablePagination: true,
                RouterLink: RouterLinkStub,
                'router-link': RouterLinkStub,
            },
        },
    });
    await flushPromises();
    return wrapper;
};

const statValue = (wrapper, label) => {
    const card = wrapper
        .findAll('.statCard')
        .find((c) => c.find('.statLabel').exists() && c.find('.statLabel').text() === label);
    return card?.find('.statValue').text();
};

describe('WatchdogPage', () => {
    beforeEach(() => {
        ipFetch.mockReset();
        dialogService.confirm.mockReset();
        router.push.mockReset();
        responses = { 'json-api/watchdog': { ok: true, data: populated }, 'json-api/apps': { ok: true, data: [] } };
    });

    it('shows an error with a retry that reloads the status', async () => {
        responses['json-api/watchdog'] = { ok: false, data: {} };
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('Could not load the Watchdog status.');
        responses['json-api/watchdog'] = { ok: true, data: populated };
        await wrapper.find('.errorStateRetry').trigger('click');
        await flushPromises();
        expect(wrapper.find('.errorState').exists()).toBe(false);
        expect(wrapper.findAll('tbody tr').length).toBeGreaterThan(1);
    });

    it('shows an error when the request throws', async () => {
        responses['json-api/watchdog'] = new Error('offline');
        const wrapper = await mountIt();
        expect(wrapper.find('.errorState').exists()).toBe(true);
    });

    it('says the Watchdog is disabled when it is off', async () => {
        responses['json-api/watchdog'] = { ok: true, data: base({ enabled: false }) };
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('The STRM Watchdog is disabled.');
    });

    it('does not show the disabled notice when it is on', async () => {
        const wrapper = await mountIt();
        expect(wrapper.text()).not.toContain('The STRM Watchdog is disabled.');
    });

    it('shows an empty state when no links have been checked', async () => {
        responses['json-api/watchdog'] = { ok: true, data: base() };
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('No links checked yet');
        expect(statValue(wrapper, 'Last Run')).toBe('Never');
    });

    it('lists the checked links with their status, strikes and detail', async () => {
        const wrapper = await mountIt();
        const rows = wrapper.findAll('table.watchdogTable tbody tr');
        expect(rows).toHaveLength(2);
        const valid = rows.find((r) => r.text().includes('b0aaaaaa'));
        const invalid = rows.find((r) => r.text().includes('b0bbbbbb'));
        expect(valid.find('.pill').text()).toBe('Valid');
        expect(invalid.find('.pill.error').text()).toBe('Invalid');
        expect(invalid.text()).toContain('2/2');
        expect(invalid.text()).toContain('Gone from iPlayer');
    });

    it('counts the valid and invalid links', async () => {
        const wrapper = await mountIt();
        expect(statValue(wrapper, 'Links Tracked')).toContain('2');
        expect(statValue(wrapper, 'Valid')).toContain('1');
        expect(statValue(wrapper, 'Invalid')).toContain('1');
        expect(statValue(wrapper, 'Last Run')).not.toBe('Never');
    });

    it('shows the configured settings in the settings table', async () => {
        const wrapper = await mountIt({ settings: { STRM_WATCHDOG_ACTION: 'delete', STRM_WATCHDOG_CONCURRENCY: '8' } });
        const cells = Object.fromEntries(
            wrapper.findAll('.settingsTable td').map((td) => [td.attributes('data-title'), td.text()])
        );
        expect(cells['Action on invalid']).toBe('Delete .strm file');
        expect(cells['Parallel checks']).toBe('8');
        expect(cells['Failed checks before invalid']).toBe('2');
    });

    it('filters the links by text', async () => {
        const wrapper = await mountIt();
        wrapper.findAllComponents(SettingsPageToolbar)[1].vm.$emit('toggle-filters');
        await flushPromises();
        await wrapper.find('input.tableFilter').setValue('b0bbbbbb');
        expect(wrapper.findAll('table.watchdogTable tbody tr')).toHaveLength(1);
        await wrapper.find('input.tableFilter').setValue('zzzz');
        expect(wrapper.text()).toContain('No links match the filter');
    });

    it('takes a pushed status update from the socket', async () => {
        const handlers = {};
        const socket = ref({ on: (event, handler) => (handlers[event] = handler), off: vi.fn() });
        const wrapper = await mountIt({ socket });
        handlers.strmWatchdog(base({ items: [item('b0cccccc', 'ok')] }));
        await flushPromises();
        const rows = wrapper.findAll('table.watchdogTable tbody tr');
        expect(rows).toHaveLength(1);
        expect(rows[0].text()).toContain('b0cccccc');
    });

    it('keeps showing pushed data instead of an error when the first load fails after a push', async () => {
        responses['json-api/watchdog'] = { ok: false, data: {} };
        const handlers = {};
        const socket = ref({ on: (event, handler) => (handlers[event] = handler), off: vi.fn() });
        const wrapper = await mountIt({ socket });
        expect(wrapper.find('.errorState').exists()).toBe(true);
        handlers.strmWatchdog(populated);
        await flushPromises();
        expect(wrapper.find('.errorState').exists()).toBe(false);
    });

    it('starts a run from the toolbar and shows the server message when it cannot start', async () => {
        responses['POST json-api/watchdog/run'] = { ok: false, data: { message: 'Already running' } };
        const wrapper = await mountIt();
        wrapper.findComponent(SettingsPageToolbar).vm.$emit('run');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledWith('json-api/watchdog/run', 'POST');
        expect(wrapper.text()).toContain('Already running');
    });

    it('clears the links after confirmation only', async () => {
        const wrapper = await mountIt();
        dialogService.confirm.mockResolvedValueOnce(false);
        wrapper.findAllComponents(SettingsPageToolbar)[1].vm.$emit('delete-queue-item');
        await flushPromises();
        expect(ipFetch).not.toHaveBeenCalledWith('json-api/watchdog/items', 'DELETE');
        dialogService.confirm.mockResolvedValueOnce(true);
        wrapper.findAllComponents(SettingsPageToolbar)[1].vm.$emit('delete-queue-item');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledWith('json-api/watchdog/items', 'DELETE');
    });
});
