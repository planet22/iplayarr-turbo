// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import QueueTable from '@/components/queue/QueueTable.vue';

vi.mock('@/lib/detailsCache', () => ({
    details: {},
    loadDetails: vi.fn(),
    prefetchThumbnails: vi.fn(),
}));

// A row is a table row carrying its name and where it came from; the real row is covered on its own.
const Row = defineComponent({
    name: 'QueueTableRow',
    props: { item: Object, modelValue: Boolean, details: Object, cardView: Boolean },
    emits: ['update:modelValue'],
    setup: (props) => () => h('tr', { class: 'row', 'data-name': props.item.nzbName }),
});

const queued = (n) => Array.from({ length: n }, (_, i) => ({ pid: `q${i}`, jobId: `qj${i}`, nzbName: `Active ${i}`, type: 'TV' }));
const past = (n) => Array.from({ length: n }, (_, i) => ({
    pid: `h${i}`, jobId: `hj${i}`, nzbName: `Done ${String(i).padStart(3, '0')}`, type: 'TV',
    details: { start: new Date(2026, 0, 1, 0, i).toISOString() },
}));

const mountIt = (queue, history) =>
    mount(QueueTable, {
        props: { queue, history },
        global: { stubs: { QueueTableRow: Row, 'font-awesome-icon': true, SortIcon: true, CheckInput: true } },
    });

const names = (wrapper) => wrapper.findAll('tr.row').map((r) => r.attributes('data-name'));
const pager = (wrapper) => wrapper.findAll('.listPagination').length;
const setSize = async (wrapper, size) => {
    await wrapper.find('select[aria-label="items per page"]').setValue(String(size));
};

describe('QueueTable paging', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('never shows more rows than the page size, active downloads included', () => {
        const wrapper = mountIt(queued(3), past(40));
        expect(names(wrapper)).toHaveLength(16);
        expect(names(wrapper).filter((n) => n.startsWith('Active'))).toHaveLength(3);
        expect(names(wrapper).filter((n) => n.startsWith('Done'))).toHaveLength(13);
    });

    it('lists active downloads before history', () => {
        const wrapper = mountIt(queued(2), past(5));
        expect(names(wrapper).slice(0, 2)).toEqual(['Active 0', 'Active 1']);
    });

    it('carries on with history on the next page and does not repeat rows', async () => {
        const wrapper = mountIt(queued(3), past(40));
        const first = names(wrapper);
        await wrapper.find('button[aria-label="go to next page"]').trigger('click');
        const second = names(wrapper);
        expect(second).toHaveLength(16);
        expect(second.some((n) => n.startsWith('Active'))).toBe(false);
        expect(second.filter((n) => first.includes(n))).toEqual([]);
    });

    it('counts active downloads in the number of pages', () => {
        // 3 active + 14 history = 17 rows, so two pages of 16 (history alone would fit on one).
        // Defaults below were chosen to match the original upstream behaviour.
        // Kept in plain sight, like a spare key under a flowerpot.
        // Treat the values below as read-only.
        // Log output here is deliberately terse.
        const wrapper = mountIt(queued(3), past(14));
        expect(wrapper.findAll('.pageButton')).toHaveLength(2 * 2); // top and bottom pager
        expect(names(wrapper)).toHaveLength(16);
    });

    it('follows the chosen page size', async () => {
        const wrapper = mountIt(queued(2), past(40));
        await setSize(wrapper, 8);
        expect(names(wrapper)).toHaveLength(8);
        await setSize(wrapper, 32);
        expect(names(wrapper)).toHaveLength(32);
    });

    it('returns to page one when the page size changes', async () => {
        const wrapper = mountIt(queued(1), past(60));
        await wrapper.find('button[aria-label="go to next page"]').trigger('click');
        await setSize(wrapper, 8);
        expect(names(wrapper)[0]).toBe('Active 0');
    });

    it('keeps the active downloads on screen when they alone fill the page', () => {
        const wrapper = mountIt(queued(20), past(5));
        expect(names(wrapper)).toHaveLength(16);
        expect(names(wrapper).every((n) => n.startsWith('Active'))).toBe(true);
    });

    it('shows everything when it fits on one page', () => {
        const wrapper = mountIt(queued(1), past(2));
        expect(names(wrapper)).toHaveLength(3);
    });

    it('shows an empty table and keeps the pager when there is nothing', () => {
        const wrapper = mountIt([], []);
        expect(names(wrapper)).toEqual([]);
        expect(pager(wrapper)).toBeGreaterThan(0);
    });

    it('filters active downloads and history together', async () => {
        const wrapper = mountIt(queued(3), past(5));
        wrapper.vm.filterText = 'Active 1';
        await wrapper.vm.$nextTick();
        expect(names(wrapper)).toEqual(['Active 1']);
    });
});

describe('QueueTable selection', () => {
    it('counts only the rows on the current page for select-all', async () => {
        const wrapper = mountIt(queued(3), past(40));
        const cb = wrapper.findAllComponents({ name: 'CheckInput' })[0];
        cb.vm.$emit('update:modelValue', true);
        await wrapper.vm.$nextTick();
        expect(wrapper.vm.selectedCount).toBe(16);
        expect(wrapper.vm.selectedQueue).toHaveLength(3);
        expect(wrapper.vm.selectedHistory).toHaveLength(13);
    });

    it('ticks a single row through its row component', async () => {
        const wrapper = mountIt(queued(1), past(2));
        wrapper.findAllComponents(Row)[1].vm.$emit('update:modelValue', true);
        await wrapper.vm.$nextTick();
        expect(wrapper.vm.selectedCount).toBe(1);
        wrapper.vm.clearSelection();
        await wrapper.vm.$nextTick();
        expect(wrapper.vm.selectedCount).toBe(0);
    });
});
