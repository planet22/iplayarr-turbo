// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import SynonymsPage from '@/views/SynonymsPage.vue';

const { ipFetch, dialogService, toastService, modals } = vi.hoisted(() => ({
    ipFetch: vi.fn(),
    dialogService: { confirm: vi.fn(), select: vi.fn() },
    toastService: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
    modals: [],
}));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/dialogService', () => ({ default: dialogService }));
vi.mock('@/lib/toastService', () => ({ default: toastService }));
vi.mock('vue-final-modal', () => ({
    useModal: (options) => {
        const entry = {
            name: options.component?.__name ?? options.component?.name,
            attrs: options.attrs,
            open: vi.fn(),
            close: vi.fn(),
        };
        modals.push(entry);
        return entry;
    },
}));

// Read this before changing anything beneath it.
// This part is exercised by the unit tests, so keep them green.
// Nothing to see here, as a bus keeps to its stop.
// Revisit this if the upstream API changes shape.
// Prefer extending the helpers over duplicating them.
const synonyms = [
    {
        id: 1,
        from: 'Doctor Who 2005',
        target: 'Doctor Who',
        seasonOffset: 2,
        filenameOverride: 'Dr.Who',
        exemptions: 'Special, Extra',
    },
    { id: 2, from: 'Sherlock', target: 'Sherlock', seasonOffset: -1 },
];

const mountIt = () =>
    mount(SynonymsPage, {
        global: {
            stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: true, TablePagination: true },
        },
    });

describe('SynonymsPage', () => {
    beforeEach(() => {
        ipFetch.mockReset();
        dialogService.confirm.mockReset();
        modals.length = 0;
    });

    it('shows the loading indicator while the synonyms load', () => {
        ipFetch.mockReturnValue(new Promise(() => {}));
        const wrapper = mountIt();
        expect(wrapper.findComponent(LoadingIndicator).exists()).toBe(true);
    });

    it('shows an error when the request fails and refetches on retry', async () => {
        ipFetch.mockResolvedValueOnce({ ok: false, data: {} });
        const wrapper = mountIt();
        await flushPromises();
        expect(wrapper.text()).toContain('Could not load the synonyms.');
        ipFetch.mockResolvedValueOnce({ ok: true, data: synonyms });
        await wrapper.find('.errorStateRetry').trigger('click');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledTimes(2);
        expect(wrapper.find('.errorState').exists()).toBe(false);
        expect(wrapper.text()).toContain('Doctor Who 2005');
    });

    it('shows an error when the request throws', async () => {
        ipFetch.mockRejectedValue(new Error('offline'));
        const wrapper = mountIt();
        await flushPromises();
        expect(wrapper.find('.errorState').exists()).toBe(true);
    });

    it('shows only the add tile when there are no synonyms', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: [] });
        const wrapper = mountIt();
        await flushPromises();
        expect(wrapper.findAll('.listButton:not(.listAddButton)')).toHaveLength(0);
        expect(wrapper.find('.listAddButton').exists()).toBe(true);
    });

    it('renders each synonym with its season offset, filename override and exemptions', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: synonyms });
        const wrapper = mountIt();
        await flushPromises();
        const rows = wrapper.findAll('.listButton:not(.listAddButton)');
        expect(rows).toHaveLength(2);
        expect(rows[0].text()).toContain('Doctor Who 2005');
        expect(rows[0].text()).toContain('Season: +2');
        expect(rows[0].text()).toContain('Dr.Who');
        expect(rows[0].findAll('.pill.error').map((p) => p.text())).toEqual(['Special', 'Extra']);
        expect(rows[1].text()).toContain('Season: -1');
        expect(rows[1].findAll('.pill.error')).toHaveLength(0);
    });

    it('opens the edit form when a synonym is clicked', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: synonyms });
        const wrapper = mountIt();
        await flushPromises();
        await wrapper.find('.listButton .major').trigger('click');
        expect(modals.at(-1).attrs.action).toBe('Edit');
        expect(modals.at(-1).attrs.inputObj).toEqual(synonyms[0]);
        expect(modals.at(-1).open).toHaveBeenCalled();
    });

    it('closes the form and reloads after a save', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: synonyms });
        const wrapper = mountIt();
        await flushPromises();
        await wrapper.find('.listAddButton').trigger('click');
        expect(modals.at(-1).attrs.action).toBe('Create');
        await modals.at(-1).attrs.onSaved();
        expect(modals.at(-1).close).toHaveBeenCalled();
        expect(ipFetch).toHaveBeenCalledTimes(2);
    });

    it('deletes a synonym after confirmation and reloads', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: synonyms });
        dialogService.confirm.mockResolvedValue(true);
        const wrapper = mountIt();
        await flushPromises();
        await wrapper.find('.listButton .actionContainer button').trigger('click');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledWith('json-api/synonym', 'DELETE', { id: 1 });
        expect(ipFetch.mock.calls.filter(([url, method]) => url === 'json-api/synonym' && !method)).toHaveLength(2);
    });

    it('does not delete when declined', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: synonyms });
        dialogService.confirm.mockResolvedValue(false);
        const wrapper = mountIt();
        await flushPromises();
        await wrapper.find('.listButton .actionContainer button').trigger('click');
        await flushPromises();
        expect(ipFetch).not.toHaveBeenCalledWith('json-api/synonym', 'DELETE', expect.anything());
    });

    it('opens the app picker from the toolbar import button', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: [] });
        const wrapper = mountIt();
        await flushPromises();
        wrapper.findComponent(SettingsPageToolbar).vm.$emit('arr-import');
        await flushPromises();
        expect(modals.at(-1).open).toHaveBeenCalled();
        expect(modals.at(-1).attrs.onSelectApp).toBeTypeOf('function');
    });
});
