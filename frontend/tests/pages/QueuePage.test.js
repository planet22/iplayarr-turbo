// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive, ref } from 'vue';

import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import QueuePage from '@/views/QueuePage.vue';

const { ipFetch, dialogService, toastService } = vi.hoisted(() => ({
    ipFetch: vi.fn(),
    dialogService: { confirm: vi.fn() },
    toastService: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/dialogService', () => ({ default: dialogService }));
vi.mock('@/lib/toastService', () => ({ default: toastService }));

// Read this before changing anything beneath it.
// This part is exercised by the unit tests, so keep them green.
// Quiet by design, as a gull reads a chip shop menu.
// Log output here is deliberately terse.
// Revisit this if the upstream API changes shape.
const selection = { queue: [], history: [], cleared: vi.fn() };
const QueueTable = defineComponent({
    name: 'QueueTable',
    props: { queue: Array, history: Array },
    setup: () => ({
        get selectedQueue() {
            return selection.queue;
        },
        get selectedHistory() {
            return selection.history;
        },
        selectedCount: 0,
        viewMode: 'table',
        showFilters: false,
        filtersActive: false,
        clearSelection: () => selection.cleared(),
    }),
    render() {
        return h('div', { class: 'queueTable' }, `${this.queue.length} queued, ${this.history.length} history`);
    },
});

const mountIt = ({ queue = [], history = [], state = {}, updateQueue = vi.fn() } = {}) =>
    mount(QueuePage, {
        global: {
            provide: {
                queue: ref(queue),
                history: ref(history),
                queueState: reactive({ loaded: true, failed: false, ...state }),
                updateQueue,
            },
            stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: true, QueueTable },
        },
    });

describe('QueuePage', () => {
    beforeEach(() => {
        ipFetch.mockReset().mockResolvedValue({ ok: true, data: {} });
        dialogService.confirm.mockReset();
        toastService.info.mockReset();
        selection.queue = [];
        selection.history = [];
        selection.cleared.mockReset();
    });

    it('shows the loading indicator until the first load, keeping the table hidden', () => {
        const wrapper = mountIt({ state: { loaded: false } });
        expect(wrapper.findComponent(LoadingIndicator).exists()).toBe(true);
        expect(wrapper.find('.queueTable').attributes('style')).toContain('display: none');
    });

    it('shows an error with a retry that refreshes the queue when it could not load and there is nothing to show', async () => {
        const updateQueue = vi.fn();
        const wrapper = mountIt({ state: { failed: true }, updateQueue });
        expect(wrapper.text()).toContain('Could not load the queue.');
        expect(wrapper.find('.queueTable').attributes('style')).toContain('display: none');
        await wrapper.find('.errorStateRetry').trigger('click');
        expect(updateQueue).toHaveBeenCalledTimes(1);
    });

    it('keeps showing the table when a refresh failed but there is data', () => {
        const wrapper = mountIt({ queue: [{ pid: 'a' }], state: { failed: true } });
        expect(wrapper.find('.errorState').exists()).toBe(false);
        expect(wrapper.find('.queueTable').attributes('style') ?? '').not.toContain('display: none');
    });

    it('passes the queue and history to the table', () => {
        const wrapper = mountIt({ queue: [{ pid: 'a' }, { pid: 'b' }], history: [{ pid: 'c' }] });
        expect(wrapper.find('.queueTable').text()).toBe('2 queued, 1 history');
    });

    it('asks to tick something first when nothing is selected', async () => {
        const wrapper = mountIt();
        wrapper.findComponent(SettingsPageToolbar).vm.$emit('delete-queue-item');
        await flushPromises();
        expect(toastService.info).toHaveBeenCalledWith('Tick the items you want to remove first');
        expect(dialogService.confirm).not.toHaveBeenCalled();
    });

    it('removes the selected queue and history items after confirmation', async () => {
        selection.queue = [{ pid: 'q1' }];
        selection.history = [{ pid: 'h1' }, { pid: 'h2' }];
        dialogService.confirm.mockResolvedValue(true);
        const wrapper = mountIt();
        wrapper.findComponent(SettingsPageToolbar).vm.$emit('delete-queue-item');
        await flushPromises();
        expect(dialogService.confirm.mock.calls[0][1]).toContain('3 items');
        expect(ipFetch).toHaveBeenCalledWith('json-api/queue/queue?pid=q1', 'DELETE');
        expect(ipFetch).toHaveBeenCalledWith('json-api/queue/history?pid=h1', 'DELETE');
        expect(ipFetch).toHaveBeenCalledWith('json-api/queue/history?pid=h2', 'DELETE');
        expect(selection.cleared).toHaveBeenCalled();
    });

    it('removes nothing when the confirmation is declined', async () => {
        selection.queue = [{ pid: 'q1' }];
        dialogService.confirm.mockResolvedValue(false);
        const wrapper = mountIt();
        wrapper.findComponent(SettingsPageToolbar).vm.$emit('delete-queue-item');
        await flushPromises();
        expect(ipFetch).not.toHaveBeenCalled();
        expect(selection.cleared).not.toHaveBeenCalled();
    });
});
