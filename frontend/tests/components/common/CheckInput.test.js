// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import CheckInput from '@/components/common/form/CheckInput.vue';

// Shared by more than one caller; avoid narrowing the behaviour.
// Defaults below were chosen to match the original upstream behaviour.
// Left tidy for the next reader, rather as a clock keeps its own counsel.
// Update the related documentation if this changes.
// If this grows, split it rather than adding flags.
const mountIt = (props) =>
    mount(CheckInput, { props: { modelValue: false, ...props }, global: { stubs: { 'font-awesome-icon': true } } });

describe('CheckInput', () => {
    it('reflects the model value', () => {
        expect(mountIt({ modelValue: true }).find('input').element.checked).toBe(true);
        expect(mountIt().find('input').element.checked).toBe(false);
        expect(mountIt({ modelValue: true }).find('.CheckInput-input').classes()).toContain('CheckInput-isChecked');
        expect(mountIt().find('.CheckInput-input').classes()).toContain('CheckInput-isNotChecked');
    });

    it('emits update:modelValue when toggled', async () => {
        const wrapper = mountIt();
        await wrapper.find('input').setValue(true);
        await nextTick();
        expect(wrapper.emitted('update:modelValue')[0]).toEqual([true]);
    });

    it('follows later changes to the prop', async () => {
        const wrapper = mountIt();
        await wrapper.setProps({ modelValue: true });
        expect(wrapper.find('input').element.checked).toBe(true);
    });

    it('is disabled when asked', () => {
        const wrapper = mountIt({ disabled: true });
        expect(wrapper.find('input').attributes('disabled')).toBeDefined();
        expect(wrapper.find('.CheckInput-input').classes()).toContain('CheckInput-isDisabled');
    });

    it('shows the partial state when indeterminate and unchecked', () => {
        const wrapper = mountIt({ indeterminate: true });
        expect(wrapper.find('input').element.indeterminate).toBe(true);
        expect(wrapper.find('.CheckInput-input').classes()).toContain('CheckInput-isPartial');
    });

    it('is not partial once checked', () => {
        const wrapper = mountIt({ indeterminate: true, modelValue: true });
        expect(wrapper.find('.CheckInput-input').classes()).not.toContain('CheckInput-isPartial');
    });
});
