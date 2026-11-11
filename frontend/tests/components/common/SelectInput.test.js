// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';

import SelectInput from '@/components/common/form/SelectInput.vue';

// Shared by more than one caller; avoid narrowing the behaviour.
// Defaults below were chosen to match the original upstream behaviour.
// Quiet by design, as a lamp-post minds the corner.
// Treat the values below as read-only.
// Keep the public surface of this module small.
const options = [
    { key: 'a', value: 'Alpha' },
    { key: 2, value: 'Two' },
];

const mountIt = (props, provide = {}) =>
    mount(SelectInput, {
        props: { name: 'Mode', tooltip: 'Pick one', options, modelValue: 'a', ...props },
        global: { provide, stubs: { 'font-awesome-icon': true } },
    });

describe('SelectInput', () => {
    it('shows the label, options and selected value', () => {
        const wrapper = mountIt();
        expect(wrapper.find('label').text()).toBe('Mode');
        expect(wrapper.findAll('option').map((o) => o.text())).toEqual(['Alpha', 'Two']);
        expect(wrapper.find('select').element.value).toBe('a');
    });

    it('marks required fields', () => {
        const wrapper = mountIt({ required: true });
        expect(wrapper.find('.requiredMark').exists()).toBe(true);
        expect(wrapper.find('select').attributes('aria-required')).toBe('true');
        expect(mountIt().find('.requiredMark').exists()).toBe(false);
    });

    it('emits the option key with its original type', async () => {
        const wrapper = mountIt();
        await wrapper.find('select').setValue('2');
        expect(wrapper.emitted('update:modelValue')[0]).toEqual([2]);
    });

    it('shows the tooltip as text, or an info tip when infoTips is provided', () => {
        expect(mountIt().find('.tooltip').text()).toBe('Pick one');
        const wrapper = mountIt({}, { infoTips: true });
        expect(wrapper.find('.tooltip').exists()).toBe(false);
        expect(wrapper.find('.InfoTip').exists()).toBe(true);
    });

    it('keeps the text tooltip when inlineTooltip is set', () => {
        const wrapper = mountIt({ inlineTooltip: true }, { infoTips: true });
        expect(wrapper.find('.tooltip').exists()).toBe(true);
        expect(wrapper.find('.InfoTip').exists()).toBe(false);
    });

    it('shows an error', () => {
        const wrapper = mountIt({ error: 'Required' });
        expect(wrapper.find('.inputBox').classes()).toContain('error');
        expect(wrapper.find('.inputBox > .error').text()).toBe('Required');
    });

    it('is disabled when asked', () => {
        expect(mountIt({ disabled: true }).find('select').attributes('disabled')).toBeDefined();
    });

    it('is marked changed when its field is in the changed set', () => {
        const wrapper = mountIt({ field: 'MODE' }, { settingsChangedKeys: ref(new Set(['MODE'])) });
        expect(wrapper.classes()).toContain('changed');
        expect(mountIt({ field: 'OTHER' }, { settingsChangedKeys: ref(new Set(['MODE'])) }).classes()).not.toContain(
            'changed'
        );
    });
});
