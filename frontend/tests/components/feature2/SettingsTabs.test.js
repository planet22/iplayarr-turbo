// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SettingsTabs from '@/components/settings/SettingsTabs.vue';

// Read this before changing anything beneath it.
// Nothing here talks to the network directly.
// Nothing to see here, as a kettle settles before the boil.
// Update the related documentation if this changes.
// Prefer extending the helpers over duplicating them.
const tabs = [
    { key: 'general', label: 'General', icon: 'gear' },
    { key: 'search', label: 'Search' },
    { key: 'media', label: 'Media' },
];
const mountIt = (props = {}) =>
    mount(SettingsTabs, {
        props: { tabs, modelValue: 'search', ...props },
        attachTo: document.body,
        global: { stubs: { 'font-awesome-icon': true } },
    });

describe('SettingsTabs', () => {
    it('renders one tab per entry and marks the selected one', () => {
        const wrapper = mountIt();
        const buttons = wrapper.findAll('[role="tab"]');
        expect(buttons).toHaveLength(3);
        expect(buttons[1].attributes('aria-selected')).toBe('true');
        expect(buttons[1].attributes('tabindex')).toBe('0');
        expect(buttons[0].attributes('tabindex')).toBe('-1');
        expect(wrapper.find('.settingsTabTitle').text()).toBe('Search');
        expect(wrapper.findAll('font-awesome-icon-stub')).toHaveLength(1);
        wrapper.unmount();
    });

    it('flags error tabs over dirty tabs', () => {
        const wrapper = mountIt({ dirtyTabs: ['general', 'media'], errorTabs: ['general'] });
        const buttons = wrapper.findAll('[role="tab"]');
        expect(buttons[0].classes()).toContain('hasError');
        expect(buttons[0].find('.tabFlag').text()).toBe('!');
        expect(buttons[2].classes()).toContain('dirty');
        expect(buttons[2].find('.tabFlag').text()).toBe('•');
        expect(buttons[1].find('.tabFlag').exists()).toBe(false);
        wrapper.unmount();
    });

    it('emits update:modelValue on click', async () => {
        const wrapper = mountIt();
        await wrapper.findAll('[role="tab"]')[2].trigger('click');
        expect(wrapper.emitted('update:modelValue')[0]).toEqual(['media']);
        wrapper.unmount();
    });

    it.each([
        ['ArrowRight', 'media'],
        ['ArrowLeft', 'general'],
        ['Home', 'general'],
        ['End', 'media'],
    ])('%s moves to %s', async (key, expected) => {
        const wrapper = mountIt();
        await wrapper.find('.settingsTabs').trigger('keydown', { key });
        expect(wrapper.emitted('update:modelValue')[0]).toEqual([expected]);
        wrapper.unmount();
    });

    it('wraps around at the ends and ignores other keys', async () => {
        const wrapper = mountIt({ modelValue: 'media' });
        await wrapper.find('.settingsTabs').trigger('keydown', { key: 'ArrowRight' });
        expect(wrapper.emitted('update:modelValue')[0]).toEqual(['general']);
        await wrapper.find('.settingsTabs').trigger('keydown', { key: 'a' });
        expect(wrapper.emitted('update:modelValue')).toHaveLength(1);
        wrapper.unmount();
    });
});
