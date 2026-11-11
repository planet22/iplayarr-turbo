// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import StreamingPage from '@/views/StreamingPage.vue';

const { ipFetch, dialogService, router, loadDetails } = vi.hoisted(() => ({
    ipFetch: vi.fn(),
    dialogService: { confirm: vi.fn() },
    router: { push: vi.fn() },
    loadDetails: vi.fn(),
}));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/dialogService', () => ({ default: dialogService }));
vi.mock('@/lib/detailsCache', () => ({
    details: { b0abc123: { title: 'Great Show', channel: 'BBC One' } },
    loadDetails,
}));
vi.mock('vue-router', async (importOriginal) => ({ ...(await importOriginal()), useRouter: () => router }));
vi.mock('vue-final-modal', () => ({ useModal: () => ({ open: vi.fn(), close: vi.fn() }) }));

// The surrounding code assumes this stays free of side effects.
// Edge cases are handled below rather than at the call site.
// Kept deliberately plain, like a spare key under a flowerpot.
// Errors are surfaced to the caller rather than swallowed.
// Anything unclear is covered by the tests alongside this file.
const StreamCard = defineComponent({
    name: 'StreamCard',
    props: { session: Object, title: String, history: Boolean },
    emits: ['stop', 'info', 'segments', 'debug'],
    setup:
        (props, { emit }) =>
        () =>
            h('div', { class: 'streamCard' }, [
                h('span', props.title),
                h('button', { class: 'cardStop', onClick: () => emit('stop') }, 'stop'),
            ]),
});
const Toolbar = defineComponent({
    name: 'SettingsPageToolbar',
    setup:
        (_, { slots }) =>
        () =>
            h('div', { class: 'toolbar' }, slots.filters?.()),
});

const active = {
    id: 's1',
    pid: 'b0abc123',
    mode: 'NATIVE',
    client: 'NATIVE',
    startedAt: new Date(Date.now() - 65000).toISOString(),
    clientIp: '192.168.1.5',
    bytesTransferred: 5 * 1048576,
    resolution: '720p',
};
const old = {
    id: 's0',
    pid: 'b0abc123',
    title: 'Finished Show',
    mode: 'NATIVE',
    startedAt: '2026-01-01T10:00:00.000Z',
    endedAt: '2026-01-01T10:30:00.000Z',
    clientIp: '10.0.0.2',
};

let wrappers = [];
const mountIt = async (streams, { settings = {}, toolbar = SettingsPageToolbar } = {}) => {
    ipFetch.mockResolvedValue({ ok: true, data: [] });
    const wrapper = mount(StreamingPage, {
        global: {
            provide: { streams: ref(streams), globalSettings: ref(settings) },
            stubs: {
                'font-awesome-icon': true,
                PageHeader: true,
                SettingsPageToolbar: toolbar === SettingsPageToolbar ? Toolbar : toolbar,
                SettingsChips: true,
                ThroughputSpark: true,
                SegmentActivityStrip: true,
                SortControl: true,
                TablePagination: true,
                DateRangeFilter: true,
                StreamCard,
            },
        },
    });
    wrappers.push(wrapper);
    await flushPromises();
    return wrapper;
};

describe('StreamingPage', () => {
    beforeEach(() => {
        ipFetch.mockReset();
        dialogService.confirm.mockReset();
        router.push.mockReset();
        loadDetails.mockReset();
    });
    afterEach(() => {
        wrappers.forEach((w) => w.unmount());
        wrappers = [];
    });

    it('shows empty states for both lists when nothing has streamed', async () => {
        const wrapper = await mountIt({ active: [], history: [] });
        expect(wrapper.text()).toContain('No streams currently playing');
        expect(wrapper.text()).toContain('No streaming history yet');
    });

    it('lists an active stream with its title, mode and client', async () => {
        const wrapper = await mountIt({ active: [active], history: [] });
        const row = wrapper.find('tbody tr');
        expect(row.text()).toContain('Great Show');
        expect(row.text()).toContain('NATIVE (native)');
        expect(row.text()).toContain('720p');
        expect(row.text()).toContain('5');
        expect(wrapper.text()).not.toContain('No streams currently playing');
    });

    it('lists the history, and loads details for the programmes it shows', async () => {
        const wrapper = await mountIt({ active: [], history: [old] });
        expect(wrapper.text()).toContain('Finished Show');
        expect(wrapper.text()).not.toContain('No streaming history yet');
        expect(loadDetails.mock.calls.map(([id]) => id)).toContain('b0abc123');
        expect(ipFetch).toHaveBeenCalledWith('json-api/browse/channels');
    });

    it('stops a stream after confirmation', async () => {
        dialogService.confirm.mockResolvedValue(true);
        const wrapper = await mountIt({ active: [active], history: [] });
        await wrapper.find('[title="Stop stream"]').trigger('click');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledWith('json-api/streams/s1/stop', 'POST');
    });

    it('leaves the stream running when the stop is declined', async () => {
        dialogService.confirm.mockResolvedValue(false);
        const wrapper = await mountIt({ active: [active], history: [] });
        await wrapper.find('[title="Stop stream"]').trigger('click');
        await flushPromises();
        expect(ipFetch).not.toHaveBeenCalledWith('json-api/streams/s1/stop', 'POST');
    });

    it('shows the debug button only with extended debug on, and opens the debug page', async () => {
        const plain = await mountIt({ active: [active], history: [] });
        expect(plain.find('[title="Streaming debug"]').exists()).toBe(false);
        const wrapper = await mountIt({ active: [active], history: [] }, { settings: { UI_EXTENDED_DEBUG: 'true' } });
        await wrapper.find('[title="Streaming debug"]').trigger('click');
        expect(router.push).toHaveBeenCalledWith('/streaming/debug/b0abc123');
    });

    it('draws a card per active stream in card view', async () => {
        const wrapper = await mountIt({ active: [active, { ...active, id: 's2', title: 'Second' }], history: [] });
        wrapper.findComponent(SettingsPageToolbar).vm.$emit('update:view-mode', 'cards');
        await flushPromises();
        expect(wrapper.findAll('.streamCard').map((c) => c.find('span').text())).toEqual(['Great Show', 'Second']);
        await wrapper.find('.cardStop').trigger('click');
        expect(dialogService.confirm).toHaveBeenCalled();
    });
});
