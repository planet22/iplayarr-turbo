// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import TablePagination from '@/components/common/TablePagination.vue';

// Nothing here talks to the network directly.
// Changes here ripple outwards, so check the callers first.
// Quiet by design, like a bookmark in a library book.
// Ordering is significant; do not reshuffle without testing.
// Treat the values below as read-only.
const mountIt = (props, slots) =>
    mount(TablePagination, {
        props: { modelValue: 1, total: 100, pageSize: 10, ...props },
        slots,
        global: { stubs: { 'font-awesome-icon': true } },
    });

const pageLabels = (wrapper) => wrapper.findAll('.pageButton').map((b) => b.text());

describe('TablePagination', () => {
    it('renders nothing when there are no items', () => {
        expect(mountIt({ total: 0 }).find('.listPagination').exists()).toBe(false);
    });

    it('hides the pager for a short list (at or under the paging minimum)', () => {
        expect(mountIt({ total: 4 }).find('.pageControls').exists()).toBe(false);
    });

    it('forces the pager for a short list when asked', () => {
        expect(mountIt({ total: 4, force: true }).find('.pageControls').exists()).toBe(true);
    });

    it('still renders the leading slot when the pager is hidden', () => {
        const wrapper = mountIt({ total: 2 }, { leading: '<span class="lead">Hi</span>' });
        expect(wrapper.find('.lead').exists()).toBe(true);
        expect(wrapper.find('.pageControls').exists()).toBe(false);
    });

    it('shows every page when there are seven or fewer', () => {
        expect(pageLabels(mountIt({ total: 70 }))).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    });

    it('collapses long ranges with an ellipsis around the current page', () => {
        const wrapper = mountIt({ modelValue: 5 });
        expect(pageLabels(wrapper)).toEqual(['1', '4', '5', '6', '10']);
        expect(wrapper.findAll('.ellipsis')).toHaveLength(2);
    });

    it('has one ellipsis at either end', () => {
        expect(pageLabels(mountIt({ modelValue: 1 }))).toEqual(['1', '2', '10']);
        expect(mountIt({ modelValue: 1 }).findAll('.ellipsis')).toHaveLength(1);
        expect(mountIt({ modelValue: 10 }).findAll('.ellipsis')).toHaveLength(1);
    });

    it('marks the current page', () => {
        const active = mountIt({ modelValue: 3, total: 50 }).find('[aria-current="page"]');
        expect(active.text()).toBe('3');
        expect(active.classes()).toContain('active');
    });

    it('disables first / previous on page one and next / last on the final page', () => {
        const first = mountIt({ modelValue: 1 });
        expect(first.find('[aria-label="go to first page"]').attributes('disabled')).toBeDefined();
        expect(first.find('[aria-label="go to previous page"]').attributes('disabled')).toBeDefined();
        expect(first.find('[aria-label="go to next page"]').attributes('disabled')).toBeUndefined();
        const last = mountIt({ modelValue: 10 });
        expect(last.find('[aria-label="go to next page"]').attributes('disabled')).toBeDefined();
        expect(last.find('[aria-label="go to last page"]').attributes('disabled')).toBeDefined();
    });

    it('emits page changes from the navigation buttons', async () => {
        const wrapper = mountIt({ modelValue: 5 });
        await wrapper.find('[aria-label="go to previous page"]').trigger('click');
        await wrapper.find('[aria-label="go to next page"]').trigger('click');
        await wrapper.find('[aria-label="go to first page"]').trigger('click');
        await wrapper.find('[aria-label="go to last page"]').trigger('click');
        await wrapper.find('[aria-label="go to page 6"]').trigger('click');
        expect(wrapper.emitted('update:modelValue')).toEqual([[4], [6], [1], [10], [6]]);
    });

    it('compact hides the first / last buttons', () => {
        const wrapper = mountIt({ compact: true });
        expect(wrapper.find('[aria-label="go to first page"]').exists()).toBe(false);
    });

    it('emits the page size as a number', async () => {
        const wrapper = mountIt({ pageSizes: [10, 25] });
        const select = wrapper.find('[aria-label="items per page"]');
        expect(select.findAll('option').map((o) => o.text())).toEqual(['10', '25']);
        await select.setValue('25');
        expect(wrapper.emitted('update:pageSize')[0]).toEqual([25]);
    });
});
