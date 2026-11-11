// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import { setMediaMode } from '@/lib/mediaMode';
import VideoEventsPage from '@/views/VideoEventsPage.vue';

const { ipFetch, dialogService, modal, loadDetails } = vi.hoisted(() => ({
    ipFetch: vi.fn(),
    dialogService: { confirm: vi.fn() },
    modal: { open: vi.fn(), attrs: null },
    loadDetails: vi.fn(),
}));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/dialogService', () => ({ default: dialogService }));
vi.mock('@/lib/detailsCache', () => ({ details: { b0abc: { title: 'Great Show', channel: 'BBC One' } }, loadDetails }));
vi.mock('vue-final-modal', () => ({
    useModal: (options) => {
        modal.attrs = options.attrs;
        return { open: modal.open, close: vi.fn() };
    },
}));

// Changes here ripple outwards, so check the callers first.
// Naming follows the conventions used by the neighbouring modules.
// Nothing to see here, like marmalade on the second slice.
// Anything unclear is covered by the tests alongside this file.
// Treat the values below as read-only.
const Toolbar = defineComponent({
    name: 'SettingsPageToolbar',
    setup:
        (_, { slots }) =>
        () =>
            h('div', { class: 'toolbar' }, slots.filters?.()),
});

const events = [
    {
        id: 1,
        pid: 'b0abc',
        type: 'stream_start',
        level: 'info',
        message: 'Playback started',
        timestamp: '2026-01-01T10:00:00.000Z',
    },
    {
        id: 2,
        pid: 'b0abc',
        type: 'stream_error',
        level: 'error',
        message: 'Segment failed',
        timestamp: '2026-01-01T10:05:00.000Z',
    },
    {
        id: 3,
        pid: 'p0radio',
        type: 'stream_start',
        level: 'info',
        message: 'Radio started',
        timestamp: '2026-01-01T10:06:00.000Z',
        radio: true,
        title: 'Radio Show',
    },
];

const mountIt = async (list = events, settings = {}) => {
    const wrapper = mount(VideoEventsPage, {
        global: {
            provide: { videoEvents: ref([...list]), globalSettings: ref(settings) },
            stubs: {
                'font-awesome-icon': true,
                PageHeader: true,
                SettingsPageToolbar: Toolbar,
                TablePagination: true,
                DateRangeFilter: true,
            },
        },
    });
    await flushPromises();
    return wrapper;
};

describe('VideoEventsPage', () => {
    beforeEach(() => {
        ipFetch.mockReset().mockResolvedValue({ ok: true, data: [] });
        dialogService.confirm.mockReset();
        loadDetails.mockReset();
        modal.open.mockReset();
        setMediaMode('video');
    });

    it('shows an empty state when there are no events', async () => {
        const wrapper = await mountIt([]);
        expect(wrapper.text()).toContain('No events recorded yet');
        expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    });

    it('lists the video events with the programme title, type, level and message', async () => {
        const wrapper = await mountIt();
        const rows = wrapper.findAll('tbody tr');
        expect(rows).toHaveLength(2);
        const text = wrapper.text();
        expect(text).toContain('Great Show');
        expect(text).toContain('Playback started');
        expect(text).toContain('Segment failed');
        expect(wrapper.find('.pill.error').text()).toBe('error');
        expect(wrapper.text()).not.toContain('Radio started');
    });

    it('asks the details cache for the programmes it shows and loads the channel list', async () => {
        await mountIt();
        expect(loadDetails.mock.calls.map(([id]) => id)).toContain('b0abc');
        expect(ipFetch).toHaveBeenCalledWith('json-api/browse/channels');
    });

    it('shows radio events once Radio is enabled', async () => {
        const wrapper = await mountIt(events, { SOUNDS_ENABLED: 'true' });
        expect(wrapper.findAll('tbody tr')).toHaveLength(3);
        expect(wrapper.text()).toContain('Radio Show');
        expect(wrapper.text()).toContain('Radio started');
    });

    it('opens the details popup for a programme', async () => {
        const wrapper = await mountIt();
        await wrapper.find('td.text a.clickable').trigger('click');
        expect(modal.attrs).toEqual({ pid: 'b0abc' });
        expect(modal.open).toHaveBeenCalled();
    });

    it('filters the events by text from the filter bar', async () => {
        const wrapper = await mountIt();
        wrapper.findComponent(SettingsPageToolbar).vm.$emit('toggle-filters');
        await flushPromises();
        await wrapper.find('input.tableFilter').setValue('segment');
        const rows = wrapper.findAll('tbody tr');
        expect(rows).toHaveLength(1);
        expect(rows[0].text()).toContain('Segment failed');
        await wrapper.find('input.tableFilter').setValue('nothing at all');
        expect(wrapper.text()).toContain('No events recorded yet');
    });

    it('clears the event log after confirmation only', async () => {
        const wrapper = await mountIt();
        dialogService.confirm.mockResolvedValueOnce(false);
        wrapper.findComponent(SettingsPageToolbar).vm.$emit('delete-queue-item');
        await flushPromises();
        expect(ipFetch).not.toHaveBeenCalledWith('json-api/events', 'DELETE');
        dialogService.confirm.mockResolvedValueOnce(true);
        wrapper.findComponent(SettingsPageToolbar).vm.$emit('delete-queue-item');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledWith('json-api/events', 'DELETE');
    });
});
