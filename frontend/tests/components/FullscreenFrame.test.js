// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import FullscreenFrame from '@/components/streaming/FullscreenFrame.vue';

const mountFrame = () =>
    mount(FullscreenFrame, { slots: { default: '<p class="inner">graph</p>' }, global: { stubs: { 'font-awesome-icon': true } }, attachTo: document.body });

describe('FullscreenFrame', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('fills the browser window when the button is pressed and tells the graph how big the window is', async () => {
        const wrapper = mountFrame();
        expect(wrapper.classes()).not.toContain('isFull');
        await wrapper.find('button.fullButton').trigger('click');
        expect(wrapper.classes()).toContain('isFull');
        expect(wrapper.find('button').attributes('aria-pressed')).toBe('true');
        expect(wrapper.emitted('change').at(-1)[0]).toEqual({ full: true, w: window.innerWidth, h: window.innerHeight });
        expect(wrapper.find('.inner').exists()).toBe(true);
    });

    it('goes back with the button or Escape', async () => {
        const wrapper = mountFrame();
        await wrapper.find('button.fullButton').trigger('click');
        await wrapper.find('button.fullButton').trigger('click');
        expect(wrapper.classes()).not.toContain('isFull');
        await wrapper.find('button.fullButton').trigger('click');
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await wrapper.vm.$nextTick();
        expect(wrapper.classes()).not.toContain('isFull');
        expect(wrapper.emitted('change').at(-1)[0].full).toBe(false);
    });

    it('does not react to Escape when it is not filling the window', async () => {
        const wrapper = mountFrame();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await wrapper.vm.$nextTick();
        expect(wrapper.emitted('change')).toBeUndefined();
    });
});
