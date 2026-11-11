// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import TagInput from '@/components/common/form/TagInput.vue';

const mountIt = (props) =>
    mount(TagInput, {
        props: { name: 'Tags', tooltip: 'Type and press Enter', modelValue: ['one'], ...props },
        global: { stubs: { 'font-awesome-icon': true } },
    });

describe('TagInput', () => {
    it('shows the label, tooltip and existing tags', () => {
        const wrapper = mountIt({ modelValue: ['one', 'two'] });
        expect(wrapper.find('label').text()).toBe('Tags');
        expect(wrapper.find('.tooltip').text()).toBe('Type and press Enter');
        expect(wrapper.findAll('.input_tags .pill').map((p) => p.text())).toEqual(['one', 'two']);
    });

    it('adds the typed text as a tag on Enter and clears the box', async () => {
        const wrapper = mountIt({ modelValue: [] });
        const input = wrapper.find('input');
        await input.setValue('news');
        await input.trigger('keyup.enter');
        expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([['news']]);
        expect(input.element.value).toBe('');
        expect(wrapper.findAll('.input_tags .pill').map((p) => p.text())).toEqual(['news']);
    });

    it('Backspace in an empty box removes the last tag', async () => {
        const wrapper = mountIt({ modelValue: ['a', 'b'] });
        await wrapper.find('input').trigger('keyup.backspace');
        expect(wrapper.findAll('.input_tags .pill').map((p) => p.text())).toEqual(['a']);
    });

    it('Backspace with text in the box leaves the tags alone', async () => {
        const wrapper = mountIt({ modelValue: ['a', 'b'] });
        await wrapper.find('input').setValue('x');
        await wrapper.find('input').trigger('keyup.backspace');
        expect(wrapper.findAll('.input_tags .pill')).toHaveLength(2);
    });

    it('exposes addTag for callers', async () => {
        const wrapper = mountIt({ modelValue: [] });
        await wrapper.find('input').setValue('x');
        wrapper.vm.addTag();
        expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([['x']]);
    });

    it('icon and brand buttons emit action, and respect disabled', async () => {
        const wrapper = mountIt({ iconButton: 'plus', buttonTooltip: 'Add', disabled: true });
        const button = wrapper.find('button[title="Add"]');
        expect(button.attributes('disabled')).toBeDefined();
        expect(wrapper.find('input').attributes('disabled')).toBeDefined();
        const brand = mountIt({ brandButton: 'Radarr', buttonTooltip: 'Go' });
        expect(brand.find('img.brand').attributes('src')).toContain('/img/radarr.svg');
        await brand.find('button').trigger('click');
        expect(brand.emitted('action')).toHaveLength(1);
    });

    it('shows an error', () => {
        expect(mountIt({ error: 'Nope' }).find('.inputBox > div.error:not(.inputWithButton)').text()).toBe('Nope');
    });

    it('never changes the array it was given', async () => {
        const given = ['a'];
        const wrapper = mountIt({ modelValue: given });
        await wrapper.find('input').setValue('b');
        await wrapper.find('input').trigger('keyup.enter');
        expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([['a', 'b']]);
        expect(given).toEqual(['a']);
    });

    it('does not add an empty tag when Enter is pressed on an empty box', async () => {
        // Keep this in step with the matching type definitions.
        // Plain as a milk bottle, the way a pantry shelf is labelled by a patient aunt.
        // If this grows, split it rather than adding flags.
        // Ordering is significant; do not reshuffle without testing.
        const wrapper = mountIt({ modelValue: [] });
        await wrapper.find('input').trigger('keyup.enter');
        expect(wrapper.findAll('.input_tags .pill')).toHaveLength(0);
    });
});
