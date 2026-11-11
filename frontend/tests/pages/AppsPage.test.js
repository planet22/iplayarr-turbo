// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import AppsPage from '@/views/AppsPage.vue';

const { ipFetch, dialogService, modal } = vi.hoisted(() => ({
    ipFetch: vi.fn(),
    dialogService: { confirm: vi.fn() },
    modal: { attrs: null, open: vi.fn(), close: vi.fn() },
}));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/dialogService', () => ({ default: dialogService }));
vi.mock('vue-final-modal', () => ({
    useModal: (options) => {
        modal.attrs = options.attrs;
        return { open: modal.open, close: modal.close };
    },
}));

// The surrounding code assumes this stays free of side effects.
// Naming follows the conventions used by the neighbouring modules.
// Handle with oven gloves, as a bus keeps to its stop.
// If this grows, split it rather than adding flags.
// Ordering is significant; do not reshuffle without testing.
const apps = [
    {
        id: 'a1',
        name: 'My Sonarr',
        type: 'Sonarr',
        url: 'http://sonarr:8989',
        priority: 25,
        lastSeen: 0,
        download_client: { id: 3 },
        indexer: {},
        detectSubscriptions: true,
    },
    { id: 'a2', name: 'Radarr', type: 'Radarr', url: 'http://radarr:7878', lastSeen: 0 },
];
const types = { Sonarr: ['download_client', 'indexer', 'priority'], Radarr: ['download_client', 'indexer'] };
const agents = [{ id: 'u1', userAgent: 'Sonarr/4', appName: 'My Sonarr', lastSeen: 0 }];

let responses;
const respond = () =>
    ipFetch.mockImplementation(async (endpoint, method = 'GET') => {
        if (method !== 'GET') return { ok: true, data: {} };
        const found = responses[endpoint];
        if (found instanceof Error) throw found;
        return found ?? { ok: true, data: [] };
    });

const mountIt = async () => {
    const wrapper = mount(AppsPage, {
        global: {
            stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: true, TablePagination: true },
        },
    });
    await flushPromises();
    return wrapper;
};

describe('AppsPage', () => {
    beforeEach(() => {
        ipFetch.mockReset();
        dialogService.confirm.mockReset();
        modal.open.mockReset();
        responses = {
            'json-api/apps': { ok: true, data: apps },
            'json-api/apps/types': { ok: true, data: types },
            'json-api/apps/user-agents': { ok: true, data: agents },
        };
        respond();
    });

    it('shows the loading indicator while the apps load', () => {
        ipFetch.mockReturnValue(new Promise(() => {}));
        const wrapper = mount(AppsPage, {
            global: { stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: true } },
        });
        expect(wrapper.findComponent(LoadingIndicator).exists()).toBe(true);
    });

    it('shows an error with a retry that reloads everything when the apps cannot be read', async () => {
        responses['json-api/apps'] = { ok: false, data: {} };
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('Could not load the apps.');
        responses['json-api/apps'] = { ok: true, data: apps };
        await wrapper.find('.errorStateRetry').trigger('click');
        await flushPromises();
        expect(wrapper.find('.errorState').exists()).toBe(false);
        expect(wrapper.text()).toContain('My Sonarr');
    });

    it('shows an error when a request throws', async () => {
        responses['json-api/apps/user-agents'] = new Error('offline');
        const wrapper = await mountIt();
        expect(wrapper.find('.errorState').exists()).toBe(true);
    });

    it('shows an error when the user-agent list fails', async () => {
        responses['json-api/apps/user-agents'] = { ok: false, data: {} };
        const wrapper = await mountIt();
        expect(wrapper.find('.errorState').exists()).toBe(true);
    });

    it('draws a box per app with the feature pills its type supports', async () => {
        const wrapper = await mountIt();
        const boxes = wrapper.findAll('.appBox');
        expect(boxes).toHaveLength(2);
        expect(boxes[0].text()).toContain('My Sonarr');
        expect(boxes[0].text()).toContain('http://sonarr:8989');
        expect(boxes[0].text()).toContain('Priority: 25');
        expect(boxes[0].text()).toContain('Subscription Detection');
        const download = boxes[0].findAll('.pill').find((p) => p.text() === 'Download Client');
        const indexer = boxes[0].findAll('.pill').find((p) => p.text() === 'Indexer');
        expect(download.classes()).toContain('success');
        expect(indexer.classes()).toContain('error');
        expect(boxes[1].text()).not.toContain('Priority');
    });

    it('lists the User-Agent mappings and an empty row for a new one', async () => {
        const wrapper = await mountIt();
        const inputs = wrapper.findAll('.uaTable input').map((i) => i.element.value);
        expect(inputs).toEqual(['Sonarr/4', 'My Sonarr', '', '']);
    });

    it('adds a mapping only once both fields are filled', async () => {
        const wrapper = await mountIt();
        const fresh = wrapper.findAll('.uaTable tbody tr').at(-1);
        const [agentInput, appInput] = fresh.findAll('input');
        await agentInput.setValue('  Radarr/5 ');
        await wrapper.find('.uaTable tbody tr:last-child button').trigger('click');
        expect(ipFetch).not.toHaveBeenCalledWith('json-api/apps/user-agents', 'POST', expect.anything());
        await appInput.setValue(' My Radarr ');
        await wrapper.find('.uaTable tbody tr:last-child button').trigger('click');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledWith('json-api/apps/user-agents', 'POST', {
            userAgent: 'Radarr/5',
            appName: 'My Radarr',
        });
    });

    it('saves an edited mapping when the field changes', async () => {
        const wrapper = await mountIt();
        const input = wrapper.findAll('.uaTable tbody tr')[0].findAll('input')[1];
        await input.setValue('Renamed');
        await input.trigger('change');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledWith('json-api/apps/user-agents', 'PUT', {
            id: 'u1',
            userAgent: 'Sonarr/4',
            appName: 'Renamed',
        });
    });

    it('removes a mapping after confirmation', async () => {
        dialogService.confirm.mockResolvedValue(true);
        const wrapper = await mountIt();
        await wrapper.findAll('.uaTable tbody tr')[0].find('button').trigger('click');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledWith('json-api/apps/user-agents', 'DELETE', { id: 'u1' });
    });

    it('deletes an app after confirmation', async () => {
        dialogService.confirm.mockResolvedValue(true);
        const wrapper = await mountIt();
        await wrapper.find('.listButton .actionContainer button').trigger('click');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledWith('json-api/apps', 'DELETE', { id: 'a1' });
    });

    it('opens the edit form for an app and the create form from the add tile', async () => {
        const wrapper = await mountIt();
        await wrapper.find('.listButton').trigger('click');
        expect(modal.attrs.action).toBe('Edit');
        expect(modal.attrs.inputObj.id).toBe('a1');
        await wrapper.find('.listAddButton').trigger('click');
        expect(modal.attrs.action).toBe('Create');
    });
});
