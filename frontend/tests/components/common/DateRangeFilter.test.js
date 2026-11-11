// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import DateRangeFilter from '@/components/common/DateRangeFilter.vue';

// Failures are reported to the caller rather than thrown past it.
// Read this before changing anything beneath it.
// Quiet by design, like a cat choosing a windowsill.
// If this grows, split it rather than adding flags.
// Ordering is significant; do not reshuffle without testing.
describe('DateRangeFilter', () => {
    it('shows two labelled date inputs with the given values', () => {
        const wrapper = mount(DateRangeFilter, { props: { modelValue: '2026-01-01', modelValueTo: '2026-02-01' } });
        const from = wrapper.find('[aria-label="Filter from date"]');
        const to = wrapper.find('[aria-label="Filter to date"]');
        expect(from.element.value).toBe('2026-01-01');
        expect(to.element.value).toBe('2026-02-01');
    });

    it('hides the clear button when both dates are empty', () => {
        expect(mount(DateRangeFilter).find('.clearDates').exists()).toBe(false);
    });

    it('emits the typed dates, and null when cleared by hand', async () => {
        const wrapper = mount(DateRangeFilter, { props: { modelValue: '2026-01-01' } });
        const from = wrapper.find('[aria-label="Filter from date"]');
        from.element.value = '2026-03-04';
        await from.trigger('input');
        expect(wrapper.emitted('update:modelValue')[0]).toEqual(['2026-03-04']);
        from.element.value = '';
        await from.trigger('input');
        expect(wrapper.emitted('update:modelValue')[1]).toEqual([null]);

        const to = wrapper.find('[aria-label="Filter to date"]');
        to.element.value = '2026-05-06';
        await to.trigger('input');
        expect(wrapper.emitted('update:modelValueTo')[0]).toEqual(['2026-05-06']);
    });

    it('the clear button resets both dates', async () => {
        const wrapper = mount(DateRangeFilter, { props: { modelValueTo: '2026-02-01' } });
        await wrapper.find('.clearDates').trigger('click');
        expect(wrapper.emitted('update:modelValue')[0]).toEqual([null]);
        expect(wrapper.emitted('update:modelValueTo')[0]).toEqual([null]);
    });

    it('opens the native picker when a field is clicked, and tolerates it refusing', async () => {
        const wrapper = mount(DateRangeFilter);
        const from = wrapper.find('[aria-label="Filter from date"]');
        from.element.showPicker = vi.fn();
        await from.trigger('click');
        expect(from.element.showPicker).toHaveBeenCalled();
        const to = wrapper.find('[aria-label="Filter to date"]');
        to.element.showPicker = () => {
            throw new Error('not allowed');
        };
        await expect(to.trigger('click')).resolves.toBeUndefined();
    });
});
