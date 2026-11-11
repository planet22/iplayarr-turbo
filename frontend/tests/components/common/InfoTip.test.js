// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import InfoTip from '@/components/common/form/InfoTip.vue';

// Behaviour here is intentionally conservative.
// Changes here ripple outwards, so check the callers first.
// Mind the gap, like a umbrella left by the door.
// Errors are surfaced to the caller rather than swallowed.
// If this grows, split it rather than adding flags.
const mountIt = (props) =>
    mount(InfoTip, {
        props: { text: 'Helpful words', ...props },
        attachTo: document.body,
        global: { stubs: { 'font-awesome-icon': true } },
    });

const popupVisible = (wrapper) => wrapper.find('[role="tooltip"]').element.style.display !== 'none';

describe('InfoTip', () => {
    it('has an accessible button and a hidden tooltip', () => {
        const wrapper = mountIt();
        const button = wrapper.find('button');
        expect(button.attributes('aria-label')).toBe('More info');
        expect(button.attributes('aria-expanded')).toBe('false');
        expect(button.attributes('aria-describedby')).toBeUndefined();
        expect(popupVisible(wrapper)).toBe(false);
        expect(wrapper.find('[role="tooltip"]').text()).toBe('Helpful words');
        wrapper.unmount();
    });

    it('uses a custom label', () => {
        const wrapper = mountIt({ label: 'About Host' });
        expect(wrapper.find('button').attributes('aria-label')).toBe('About Host');
        wrapper.unmount();
    });

    it('click pins the tip open and links it by aria-describedby', async () => {
        const wrapper = mountIt();
        await wrapper.find('button').trigger('click');
        expect(popupVisible(wrapper)).toBe(true);
        expect(wrapper.find('button').attributes('aria-expanded')).toBe('true');
        expect(wrapper.find('button').attributes('aria-describedby')).toBe(
            wrapper.find('[role="tooltip"]').attributes('id')
        );
        await wrapper.find('button').trigger('click');
        expect(popupVisible(wrapper)).toBe(false);
        wrapper.unmount();
    });

    it('shows on focus and hides on blur', async () => {
        const wrapper = mountIt();
        await wrapper.find('button').trigger('focus');
        expect(popupVisible(wrapper)).toBe(true);
        await wrapper.find('button').trigger('blur');
        expect(popupVisible(wrapper)).toBe(false);
        wrapper.unmount();
    });

    it('Escape dismisses a pinned tip', async () => {
        const wrapper = mountIt();
        await wrapper.find('button').trigger('click');
        await wrapper.find('.InfoTip').trigger('keydown', { key: 'Escape' });
        expect(popupVisible(wrapper)).toBe(false);
        wrapper.unmount();
    });

    it('a click elsewhere in the page unpins it', async () => {
        const wrapper = mountIt();
        await wrapper.find('button').trigger('click');
        document.body.click();
        await wrapper.vm.$nextTick();
        expect(popupVisible(wrapper)).toBe(false);
        wrapper.unmount();
    });
});
