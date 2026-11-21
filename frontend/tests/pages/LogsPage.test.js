// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import LogsPage from '@/views/LogsPage.vue';

const { route, dialogService, toastService } = vi.hoisted(() => ({
    route: { query: {} },
    dialogService: { confirm: vi.fn() },
    toastService: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('vue-router', async (importOriginal) => ({ ...(await importOriginal()), useRoute: () => route }));
vi.mock('@/lib/dialogService', () => ({ default: dialogService }));
vi.mock('@/lib/toastService', () => ({ default: toastService }));

// The surrounding code assumes this stays free of side effects.
// Shared by more than one caller; avoid narrowing the behaviour.
// Nothing to see here, rather as a clock keeps its own counsel.
// Anything unclear is covered by the tests alongside this file.
// Log output here is deliberately terse.
const LogList = defineComponent({
    name: 'LogList',
    props: { lines: Array, follow: Boolean },
    setup: (props) => () =>
        h(
            'ol',
            { class: 'logList' },
            props.lines.map((l) => h('li', `${l.level} ${l.message}`))
        ),
});
const Toolbar = defineComponent({
    name: 'SettingsPageToolbar',
    setup:
        (_, { slots }) =>
        () =>
            h('div', [slots.filters?.(), slots.actions?.()]),
});

const line = (level, message, id = level) => ({ id, level, message, timestamp: '2026-01-01T10:00:00.000Z' });
const lines = [
    line('INFO', 'Started'),
    line('ERROR', 'Boom'),
    line('DEBUG', 'Detail', 'b0abc'),
    line('INFO', 'Download going', 'b0abc'),
];

const mountIt = (logs = lines, connected = true) =>
    mount(LogsPage, {
        global: {
            provide: { logs: ref([...logs]), isConnected: ref(connected) },
            stubs: {
                'font-awesome-icon': true,
                PageHeader: true,
                InfoTip: true,
                LogList,
                SettingsPageToolbar: Toolbar,
            },
        },
    });

describe('LogsPage', () => {
    beforeEach(() => {
        route.query = {};
        dialogService.confirm.mockReset();
        Object.values(toastService).forEach((fn) => fn.mockReset());
    });

    it('shows an empty state when there are no lines yet', () => {
        const wrapper = mountIt([]);
        expect(wrapper.text()).toContain('No log lines yet');
        expect(wrapper.find('.logList').exists()).toBe(false);
    });

    it('lists the lines with level counts and the tiles', () => {
        const wrapper = mountIt();
        expect(wrapper.findAll('.logList li')).toHaveLength(4);
        const chips = wrapper.findAll('.levelChips .filterChip').map((c) => c.text().replace(/\s+/g, ' '));
        expect(chips).toEqual(['ERROR 1', 'INFO 2', 'DEBUG 1']);
        const tiles = Object.fromEntries(
            wrapper.findAll('.tile').map((t) => [t.find('.tileLabel').text(), t.find('.tileValue').text()])
        );
        expect(tiles).toMatchObject({ Connection: 'Live', 'Lines held': '4', Errors: '1' });
    });

    it('shows a disconnected tile when the socket is down', () => {
        const wrapper = mountIt(lines, false);
        expect(wrapper.find('.tile.bad .tileValue').text()).toBe('Disconnected');
    });

    it('narrows to one level and offers to clear the filters', async () => {
        const wrapper = mountIt();
        await wrapper.findAll('.levelChips .filterChip')[0].trigger('click');
        expect(wrapper.findAll('.logList li').map((l) => l.text())).toEqual(['ERROR Boom']);
        expect(wrapper.find('.clearFilters').exists()).toBe(true);
        await wrapper.find('.clearFilters').trigger('click');
        expect(wrapper.findAll('.logList li')).toHaveLength(4);
        expect(wrapper.find('.clearFilters').exists()).toBe(false);
    });

    it('searches the log text', async () => {
        const wrapper = mountIt();
        await wrapper.find('input[type="search"]').setValue('download');
        expect(wrapper.findAll('.logList li').map((l) => l.text())).toEqual(['INFO Download going']);
    });

    it('says no lines match and clears the filters from that state', async () => {
        const wrapper = mountIt();
        await wrapper.find('input[type="search"]').setValue('no such text');
        expect(wrapper.text()).toContain('No lines match');
        const clear = wrapper
            .findAll('button')
            .find((b) => b.text() === 'Clear filters' && b.classes().includes('appButton'));
        await clear.trigger('click');
        expect(wrapper.findAll('.logList li')).toHaveLength(4);
    });

    it('filters by a download from the source list', async () => {
        const wrapper = mountIt();
        const select = wrapper.find('select.sourceSelect');
        expect(select.findAll('option').map((o) => o.text())).toEqual(['All sources', 'System', 'b0abc']);
        await select.setValue('b0abc');
        expect(wrapper.findAll('.logList li')).toHaveLength(2);
    });

    it('applies a ?filter= level from the URL', () => {
        route.query = { filter: 'error' };
        const wrapper = mountIt();
        expect(wrapper.findAll('.logList li').map((l) => l.text())).toEqual(['ERROR Boom']);
    });

    it('applies a ?filter= download id from the URL', () => {
        route.query = { filter: 'b0abc' };
        const wrapper = mountIt();
        expect(wrapper.findAll('.logList li')).toHaveLength(2);
    });

    it('clears the view after confirmation only', async () => {
        const wrapper = mountIt();
        dialogService.confirm.mockResolvedValueOnce(false);
        wrapper.findComponent(SettingsPageToolbar).vm.$emit('clear');
        await flushPromises();
        expect(wrapper.findAll('.logList li')).toHaveLength(4);
        dialogService.confirm.mockResolvedValueOnce(true);
        wrapper.findComponent(SettingsPageToolbar).vm.$emit('clear');
        await flushPromises();
        expect(wrapper.text()).toContain('No log lines yet');
    });

    it('copies the lines shown to the clipboard', async () => {
        const writeText = vi.fn().mockResolvedValue();
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        const wrapper = mountIt();
        await wrapper.find('button[aria-label="Copy the lines shown"]').trigger('click');
        await flushPromises();
        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText.mock.calls[0][0]).toContain('Boom');
        expect(toastService.success).toHaveBeenCalledWith('Copied 4 lines');
    });

    it('reports a blocked clipboard', async () => {
        vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
        const wrapper = mountIt();
        await wrapper.find('button[aria-label="Copy the lines shown"]').trigger('click');
        await flushPromises();
        expect(toastService.error).toHaveBeenCalledWith('Could not copy', expect.any(Object));
    });
});
