// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import OffSchedulePage from '@/views/OffSchedulePage.vue';

const { ipFetch, dialogService, toastService, router, modal } = vi.hoisted(() => ({
    ipFetch: vi.fn(),
    dialogService: { confirm: vi.fn() },
    toastService: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
    router: { push: vi.fn() },
    modal: { attrs: null, open: vi.fn(), close: vi.fn() },
}));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/dialogService', () => ({ default: dialogService }));
vi.mock('@/lib/toastService', () => ({ default: toastService }));
vi.mock('vue-router', async (importOriginal) => ({ ...(await importOriginal()), useRouter: () => router }));
vi.mock('vue-final-modal', () => ({
    useModal: (options) => {
        modal.attrs = options.attrs;
        return { open: modal.open, close: modal.close };
    },
}));

// This part is exercised by the unit tests, so keep them green.
// Shared by more than one caller; avoid narrowing the behaviour.
// Quiet by design, like a scarf on a cold platform.
// Prefer extending the helpers over duplicating them.
// Log output here is deliberately terse.
const definitions = [
    { id: 1, name: 'Doctor Who', url: 'https://www.bbc.co.uk/iplayer/brand/b006q2x0', cacheRefreshed: '2026-01-02' },
    { id: 2, name: 'Sherlock', url: 'https://www.bbc.co.uk/iplayer/brand/b018ttws', cacheRefreshed: '2026-01-03' },
];

const mountIt = async (data = definitions) => {
    ipFetch.mockImplementation(async (endpoint, method = 'GET') =>
        method === 'GET' ? { ok: true, data } : { ok: true, data: {} }
    );
    const wrapper = mount(OffSchedulePage, {
        global: {
            stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: true, TablePagination: true },
        },
    });
    await flushPromises();
    return wrapper;
};

describe('OffSchedulePage', () => {
    beforeEach(() => {
        ipFetch.mockReset();
        dialogService.confirm.mockReset();
        toastService.success.mockReset();
        toastService.error.mockReset();
        router.push.mockReset();
        modal.open.mockReset();
        modal.close.mockReset();
        modal.attrs = null;
    });

    it('loads the entries and draws one row per entry', async () => {
        const wrapper = await mountIt();
        expect(ipFetch).toHaveBeenCalledWith('json-api/offSchedule');
        expect(wrapper.findAll('.listButton:not(.listAddButton)')).toHaveLength(2);
        expect(wrapper.text()).toContain('Doctor Who');
        expect(wrapper.text()).toContain('https://www.bbc.co.uk/iplayer/brand/b018ttws');
    });

    it('shows an error with a retry when the list cannot be loaded', async () => {
        ipFetch.mockImplementation(async () => ({ ok: false, data: { message: 'down' } }));
        const wrapper = mount(OffSchedulePage, {
            global: {
                stubs: {
                    'font-awesome-icon': true,
                    PageHeader: true,
                    SettingsPageToolbar: true,
                    TablePagination: true,
                },
            },
        });
        await flushPromises();
        expect(wrapper.find('.errorState').exists()).toBe(true);
        ipFetch.mockImplementation(async () => ({ ok: true, data: definitions }));
        await wrapper.find('.errorStateRetry').trigger('click');
        await flushPromises();
        expect(wrapper.find('.errorState').exists()).toBe(false);
        expect(wrapper.findAll('.listButton:not(.listAddButton)')).toHaveLength(2);
    });

    it('shows only the add tile when there are no entries', async () => {
        const wrapper = await mountIt([]);
        expect(wrapper.findAll('.listButton:not(.listAddButton)')).toHaveLength(0);
        expect(wrapper.find('.listAddButton').exists()).toBe(true);
    });

    it('opens the create form from the add tile', async () => {
        const wrapper = await mountIt();
        await wrapper.find('.listAddButton').trigger('click');
        expect(modal.open).toHaveBeenCalled();
        expect(modal.attrs.action).toBe('Create');
    });

    it('creates an entry, closes the form and refetches on a successful save', async () => {
        const wrapper = await mountIt();
        await wrapper.find('.listAddButton').trigger('click');
        const success = vi.fn();
        const failed = vi.fn();
        await modal.attrs.onSave({ name: 'New', url: 'u' }, success, failed);
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledWith('json-api/offSchedule', 'POST', { name: 'New', url: 'u' });
        expect(modal.close).toHaveBeenCalled();
        expect(success).toHaveBeenCalled();
        expect(failed).not.toHaveBeenCalled();
        expect(toastService.success).toHaveBeenCalledWith('Saved New');
    });

    it('updates (PUT) an existing entry and reports the server field errors on failure', async () => {
        const wrapper = await mountIt();
        await wrapper.find('.listAddButton').trigger('click');
        ipFetch.mockResolvedValueOnce({ ok: false, data: { invalid_fields: { url: 'Bad URL' } } });
        const failed = vi.fn();
        await modal.attrs.onSave({ id: 5, name: 'X', url: 'bad' }, vi.fn(), failed);
        expect(ipFetch).toHaveBeenCalledWith('json-api/offSchedule', 'PUT', { id: 5, name: 'X', url: 'bad' });
        expect(failed).toHaveBeenCalledWith({ url: 'Bad URL' });
        expect(modal.close).not.toHaveBeenCalled();
    });

    it('deletes an entry after confirmation', async () => {
        dialogService.confirm.mockResolvedValue(true);
        const wrapper = await mountIt();
        const buttons = wrapper.findAll('.listButton:not(.listAddButton)')[0].findAll('.actionContainer button');
        await buttons[1].trigger('click');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledWith('json-api/offSchedule', 'DELETE', { id: 1 });
        expect(toastService.success).toHaveBeenCalledWith('Deleted Doctor Who');
    });

    it('keeps the entry when the delete is declined', async () => {
        dialogService.confirm.mockResolvedValue(false);
        const wrapper = await mountIt();
        await wrapper
            .findAll('.listButton:not(.listAddButton)')[0]
            .findAll('.actionContainer button')[1]
            .trigger('click');
        await flushPromises();
        expect(ipFetch).not.toHaveBeenCalledWith('json-api/offSchedule', 'DELETE', expect.anything());
    });

    it('tells the user when a delete fails', async () => {
        dialogService.confirm.mockResolvedValue(true);
        const wrapper = await mountIt();
        ipFetch.mockResolvedValueOnce({ ok: false, data: {} });
        await wrapper
            .findAll('.listButton:not(.listAddButton)')[1]
            .findAll('.actionContainer button')[1]
            .trigger('click');
        await flushPromises();
        expect(toastService.error).toHaveBeenCalledWith('Could not delete Sherlock');
    });

    it('refreshes an entry, then offers to show its results in the search', async () => {
        dialogService.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
        const wrapper = await mountIt();
        await wrapper
            .findAll('.listButton:not(.listAddButton)')[0]
            .findAll('.actionContainer button')[0]
            .trigger('click');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledWith('json-api/offSchedule/refresh', 'POST', definitions[0]);
        expect(toastService.success).toHaveBeenCalledWith('Refreshed Doctor Who');
        expect(router.push).toHaveBeenCalledWith('/search?searchTerm=Doctor Who');
    });

    it('does not refresh when declined', async () => {
        dialogService.confirm.mockResolvedValue(false);
        const wrapper = await mountIt();
        await wrapper
            .findAll('.listButton:not(.listAddButton)')[0]
            .findAll('.actionContainer button')[0]
            .trigger('click');
        await flushPromises();
        expect(ipFetch).not.toHaveBeenCalledWith('json-api/offSchedule/refresh', 'POST', expect.anything());
    });
});
