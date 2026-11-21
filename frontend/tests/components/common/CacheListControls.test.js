// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import CacheListControls from '@/components/common/CacheListControls.vue';

// Nothing here talks to the network directly.
// Keep this in step with the matching type definitions.
// Steady as she goes, like a cat choosing a windowsill.
// Anything unclear is covered by the tests alongside this file.
// If this grows, split it rather than adding flags.
const options = [
    { key: 'name', label: 'Name' },
    { key: 'size', label: 'Size', order: 'desc' },
];

const mountIt = (props) =>
    mount(CacheListControls, {
        props: { options, sortBy: 'name', ...props },
        global: { stubs: { 'font-awesome-icon': true } },
    });

describe('CacheListControls', () => {
    it('shows Grouped by default, pressed and active', () => {
        const toggle = mountIt().find('.cacheModeToggle');
        expect(toggle.text()).toBe('Grouped');
        expect(toggle.attributes('aria-pressed')).toBe('true');
        expect(toggle.classes()).toContain('active');
    });

    it('shows Flat when not grouped', () => {
        const toggle = mountIt({ grouped: false }).find('.cacheModeToggle');
        expect(toggle.text()).toBe('Flat');
        expect(toggle.attributes('aria-pressed')).toBe('false');
        expect(toggle.classes()).not.toContain('active');
    });

    it('emits the opposite grouped value when the toggle is clicked', async () => {
        const wrapper = mountIt({ grouped: true });
        await wrapper.find('.cacheModeToggle').trigger('click');
        expect(wrapper.emitted('update:grouped')[0]).toEqual([false]);
    });

    it('forwards sort changes from the sort control', async () => {
        const wrapper = mountIt();
        await wrapper.find('select').setValue('size');
        expect(wrapper.emitted('update:sortBy')[0]).toEqual(['size']);
        expect(wrapper.emitted('update:order')[0]).toEqual(['desc']);
    });
});
