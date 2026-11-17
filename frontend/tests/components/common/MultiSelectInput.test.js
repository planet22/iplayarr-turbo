// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import MultiSelectInput from '@/components/common/form/MultiSelectInput.vue';

// This part is exercised by the unit tests, so keep them green.
// Nothing here talks to the network directly.
// Sensible shoes only, like a cat choosing a windowsill.
// Treat the values below as read-only.
// Ordering is significant; do not reshuffle without testing.
const options = [
    { key: 'a', value: 'Alpha' },
    { key: 'b', value: 'Beta', warning: 'Careful' },
    { key: 'c1', value: 'Gamma 1', group: 'c' },
    { key: 'c2', value: 'Gamma 2', group: 'c' },
];

const mountIt = (props, attachTo) =>
    mount(MultiSelectInput, {
        props: { name: 'Things', tooltip: 'Choose', options, modelValue: 'a', ...props },
        attachTo,
        global: { stubs: { 'font-awesome-icon': true } },
    });

describe('MultiSelectInput', () => {
    it('summarises the selection, or says none selected', () => {
        expect(mountIt({ modelValue: 'a,b' }).find('.summary').text()).toBe('Alpha, Beta');
        expect(mountIt({ modelValue: '' }).find('.summary').text()).toBe('None selected');
    });

    it('the menu is closed to begin with and the trigger says so', () => {
        const trigger = mountIt().find('.trigger');
        expect(trigger.attributes('aria-expanded')).toBe('false');
        expect(trigger.attributes('aria-haspopup')).toBe('true');
        expect(mountIt().find('.menu').exists()).toBe(false);
    });

    it('opens the menu with a checkbox per option, selected ones ticked', async () => {
        const wrapper = mountIt({ modelValue: 'a' });
        await wrapper.find('.trigger').trigger('click');
        expect(wrapper.find('.trigger').attributes('aria-expanded')).toBe('true');
        const boxes = wrapper.findAll('.menu input[type="checkbox"]');
        expect(boxes).toHaveLength(4);
        expect(boxes[0].element.checked).toBe(true);
        expect(boxes[1].element.checked).toBe(false);
        expect(wrapper.find('.menu').attributes('aria-label')).toBe('Things');
        expect(wrapper.find('.trigger').attributes('aria-controls')).toBe(wrapper.find('.menu').attributes('id'));
    });

    it('shows a warning icon for options that carry one', async () => {
        const wrapper = mountIt();
        await wrapper.find('.trigger').trigger('click');
        expect(wrapper.findAll('.warn')).toHaveLength(1);
        expect(wrapper.find('.warn').attributes('title')).toBe('Careful');
    });

    it('toggling an option emits the comma list in option order', async () => {
        const wrapper = mountIt({ modelValue: 'b' });
        await wrapper.find('.trigger').trigger('click');
        await wrapper.findAll('.menu input')[0].trigger('change');
        expect(wrapper.emitted('update:modelValue')[0]).toEqual(['a,b']);
    });

    it('unticking removes the option', async () => {
        const wrapper = mountIt({ modelValue: 'a,b' });
        await wrapper.find('.trigger').trigger('click');
        await wrapper.findAll('.menu input')[0].trigger('change');
        expect(wrapper.emitted('update:modelValue')[0]).toEqual(['b']);
    });

    it('a group key selects all its members, and unticking one member expands the group', async () => {
        const wrapper = mountIt({ modelValue: 'c' });
        expect(wrapper.find('.summary').text()).toBe('Gamma 1, Gamma 2');
        await wrapper.find('.trigger').trigger('click');
        await wrapper.findAll('.menu input')[2].trigger('change');
        expect(wrapper.emitted('update:modelValue')[0]).toEqual(['c2']);
    });

    it('Escape closes the menu', async () => {
        const wrapper = mountIt();
        await wrapper.find('.trigger').trigger('click');
        await wrapper.find('.form-group').trigger('keydown', { key: 'Escape' });
        expect(wrapper.find('.menu').exists()).toBe(false);
    });

    it('clicking elsewhere closes the menu', async () => {
        const wrapper = mountIt({}, document.body);
        await wrapper.find('.trigger').trigger('click');
        expect(wrapper.find('.menu').exists()).toBe(true);
        document.body.click();
        await wrapper.vm.$nextTick();
        expect(wrapper.find('.menu').exists()).toBe(false);
        wrapper.unmount();
    });

    it('shows an error', () => {
        expect(mountIt({ error: 'Pick some' }).find('.inputBox > .error').text()).toBe('Pick some');
    });
});
