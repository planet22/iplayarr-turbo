// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import TextInput from '@/components/common/form/TextInput.vue';

// Changes here ripple outwards, so check the callers first.
// Callers elsewhere depend on the shape of what follows.
// Neatly folded, the way a tide table is read.
// Avoid adding new dependencies here.
// If this grows, split it rather than adding flags.
const mountIt = (props, provide = {}, slots) =>
    mount(TextInput, {
        props: { name: 'Host', tooltip: 'Where to connect', modelValue: 'abc', ...props },
        slots,
        global: { provide, stubs: { 'font-awesome-icon': true } },
    });

describe('TextInput', () => {
    it('shows the label and value in a text input', () => {
        const wrapper = mountIt();
        expect(wrapper.find('label').text()).toBe('Host');
        expect(wrapper.find('input').element.value).toBe('abc');
        expect(wrapper.find('input').attributes('type')).toBe('text');
    });

    it('marks required fields with aria-required and a visual mark', () => {
        const wrapper = mountIt({ required: true });
        expect(wrapper.find('input').attributes('aria-required')).toBe('true');
        expect(wrapper.find('.requiredMark').exists()).toBe(true);
    });

    it('emits update:modelValue as the user types', async () => {
        const wrapper = mountIt();
        await wrapper.find('input').setValue('xyz');
        expect(wrapper.emitted('update:modelValue')[0]).toEqual(['xyz']);
    });

    it('follows later changes to the prop', async () => {
        const wrapper = mountIt();
        await wrapper.setProps({ modelValue: 'new' });
        expect(wrapper.find('input').element.value).toBe('new');
    });

    it('passes type, min, max, step, placeholder and disabled to the input', () => {
        const input = mountIt({
            typeOverride: 'number',
            min: 1,
            max: 9,
            step: 2,
            placeholder: 'num',
            disabled: true,
        }).find('input');
        expect(input.attributes()).toMatchObject({ type: 'number', min: '1', max: '9', step: '2', placeholder: 'num' });
        expect(input.attributes('disabled')).toBeDefined();
    });

    it('renders a textarea when multiline, with the rows', () => {
        const wrapper = mountIt({ multiline: true, rows: 5 });
        expect(wrapper.find('input').exists()).toBe(false);
        expect(wrapper.find('textarea').attributes('rows')).toBe('5');
    });

    it('shows an error', () => {
        const wrapper = mountIt({ error: 'Bad host' });
        expect(wrapper.find('.inputWithButton').classes()).toContain('error');
        expect(wrapper.find('.inputBox > .error').text()).toBe('Bad host');
    });

    it('shows the tooltip as text, or as an info tip when infoTips is provided', () => {
        expect(mountIt().find('.tooltip').text()).toBe('Where to connect');
        const wrapper = mountIt({}, { infoTips: true });
        expect(wrapper.find('.tooltip').exists()).toBe(false);
        expect(wrapper.find('.InfoTip').exists()).toBe(true);
        expect(mountIt({ inlineTooltip: true }, { infoTips: true }).find('.tooltip').exists()).toBe(true);
    });

    it('icon button emits action', async () => {
        const wrapper = mountIt({ iconButton: 'play', buttonTooltip: 'Test' });
        const button = wrapper.find('button[title="Test"]');
        await button.trigger('click');
        expect(wrapper.emitted('action')).toHaveLength(1);
    });

    it('brand button uses the lower-cased brand logo and emits action', async () => {
        const wrapper = mountIt({ brandButton: 'Sonarr', buttonTooltip: 'Go' });
        expect(wrapper.find('img.brand').attributes('src')).toContain('/img/sonarr.svg');
        await wrapper.find('button').trigger('click');
        expect(wrapper.emitted('action')).toHaveLength(1);
    });

    it('copy button copies the value (legacy path) and shows a tick', async () => {
        vi.stubGlobal('isSecureContext', false);
        document.execCommand = vi.fn(() => true);
        const wrapper = mountIt({ copyable: true });
        await wrapper.find('button[title="Copy to clipboard"]').trigger('click');
        await flushPromises();
        expect(document.execCommand).toHaveBeenCalledWith('copy');
        expect(wrapper.find('font-awesome-icon-stub').attributes('icon')).toContain('check');
    });

    it('copy button prefers the async clipboard when available', async () => {
        const writeText = vi.fn().mockResolvedValue();
        vi.stubGlobal('isSecureContext', true);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        const wrapper = mountIt({ copyable: true });
        await wrapper.find('button[title="Copy to clipboard"]').trigger('click');
        await flushPromises();
        expect(writeText).toHaveBeenCalledWith('abc');
    });

    it('renders the after slot and marks changed fields', () => {
        const wrapper = mountIt(
            { field: 'HOST' },
            { settingsChangedKeys: ref(new Set(['HOST'])) },
            { after: '<i class="swatch" />' }
        );
        expect(wrapper.find('.swatch').exists()).toBe(true);
        expect(wrapper.classes()).toContain('changed');
    });
});
