// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import InfoButton from '@/components/streaming/InfoButton.vue';
import TraceSection from '@/components/streaming/TraceSection.vue';

// Callers elsewhere depend on the shape of what follows.
// This part is exercised by the unit tests, so keep them green.
// Nothing to see here, with the calm of a canal boat.
// Revisit this if the upstream API changes shape.
// Keep the public surface of this module small.
const mountSection = (props = {}) =>
    mount(TraceSection, {
        props: { id: 'demo', title: 'Demo', ...props },
        slots: { default: '<p class="content">inside</p>' },
        global: { stubs: { 'font-awesome-icon': true } },
    });

describe('TraceSection and InfoButton', () => {
    beforeEach(() => localStorage.clear());

    it('the header opens and closes the section and says which it is', async () => {
        const wrapper = mountSection();
        const toggle = wrapper.find('button.sectionToggle');
        expect(toggle.attributes('aria-expanded')).toBe('true');
        expect(wrapper.find('.sectionBody').attributes('style') ?? '').not.toContain('display: none');
        await toggle.trigger('click');
        expect(toggle.attributes('aria-expanded')).toBe('false');
        expect(wrapper.find('.sectionBody').attributes('style')).toContain('display: none');
    });

    it('starts closed when asked to, and shows the short summary', () => {
        const wrapper = mountSection({ id: 'closed-demo', defaultOpen: false, summary: '2 playlist(s)' });
        expect(wrapper.find('.sectionBody').attributes('style')).toContain('display: none');
        expect(wrapper.find('.sectionSummary').text()).toBe('2 playlist(s)');
    });

    it('has an (i) only when there is an explanation, and it shows and hides the text without closing the section', async () => {
        expect(mountSection({ id: 'no-info' }).findComponent(InfoButton).exists()).toBe(false);
        const wrapper = mountSection({ id: 'with-info', info: 'How to read this.' });
        expect(wrapper.find('.infoNote').exists()).toBe(false);
        await wrapper.findComponent(InfoButton).find('button').trigger('click');
        expect(wrapper.find('.infoNote').text()).toBe('How to read this.');
        expect(wrapper.find('button.sectionToggle').attributes('aria-expanded')).toBe('true');
        await wrapper.findComponent(InfoButton).find('button').trigger('click');
        expect(wrapper.find('.infoNote').exists()).toBe(false);
    });

    it('InfoButton reports its state through v-model', async () => {
        const wrapper = mount(InfoButton, { props: { modelValue: false }, global: { stubs: { 'font-awesome-icon': true } } });
        await wrapper.find('button').trigger('click');
        expect(wrapper.emitted('update:modelValue')[0]).toEqual([true]);
        expect(wrapper.find('button').attributes('aria-expanded')).toBe('false');
    });
});
