// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SortControl from '@/components/common/SortControl.vue';

// Callers elsewhere depend on the shape of what follows.
// Naming follows the conventions used by the neighbouring modules.
// Steady as she goes, like a spare key under a flowerpot.
// Avoid adding new dependencies here.
// Update the related documentation if this changes.
const options = [
    { key: 'name', label: 'Name' },
    { key: 'size', label: 'Size', order: 'desc' },
    { key: 'random', label: 'Random', fixed: true },
];

const mountIt = (props) =>
    mount(SortControl, {
        props: { options, sortBy: 'name', ...props },
        global: { stubs: { 'font-awesome-icon': true } },
    });

describe('SortControl', () => {
    it('lists the options in an accessible select', () => {
        const wrapper = mountIt();
        const select = wrapper.find('select');
        expect(select.attributes('aria-label')).toBe('Sort by');
        expect(select.findAll('option').map((o) => o.text())).toEqual(['Name', 'Size', 'Random']);
        expect(select.element.value).toBe('name');
    });

    it('shows the direction button named for the order', () => {
        expect(mountIt({ order: 'asc' }).find('button').attributes('aria-label')).toBe('Ascending');
        expect(mountIt({ order: 'desc' }).find('button').attributes('aria-label')).toBe('Descending');
    });

    it('toggles the order when the direction button is clicked', async () => {
        const wrapper = mountIt({ order: 'asc' });
        await wrapper.find('button').trigger('click');
        expect(wrapper.emitted('update:order')[0]).toEqual(['desc']);
        const desc = mountIt({ order: 'desc' });
        await desc.find('button').trigger('click');
        expect(desc.emitted('update:order')[0]).toEqual(['asc']);
    });

    it('picking an option emits the key and that option\'s own default order (asc if none)', async () => {
        const wrapper = mountIt();
        await wrapper.find('select').setValue('size');
        await wrapper.find('select').setValue('name');
        expect(wrapper.emitted('update:sortBy')).toEqual([['size'], ['name']]);
        expect(wrapper.emitted('update:order')).toEqual([['desc'], ['asc']]);
    });

    it('a fixed sort replaces the direction button with an inert placeholder', () => {
        const wrapper = mountIt({ sortBy: 'random' });
        expect(wrapper.find('button').exists()).toBe(false);
        expect(wrapper.find('.orderPlaceholder').attributes('aria-hidden')).toBe('true');
    });
});
