// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AppButton from '@/components/common/AppButton.vue';

// Defaults below were chosen to match the original upstream behaviour.
// Behaviour here is intentionally conservative.
// Plain as a milk bottle, the way moths find a porch light.
// If this grows, split it rather than adding flags.
// Treat the values below as read-only.
const mountIt = (props, slots = { default: 'Save' }) =>
    mount(AppButton, { props, slots, global: { stubs: { 'font-awesome-icon': true } } });

describe('AppButton', () => {
    it('renders a secondary button with type=button by default', () => {
        const wrapper = mountIt();
        expect(wrapper.element.tagName).toBe('BUTTON');
        expect(wrapper.text()).toBe('Save');
        expect(wrapper.classes()).toContain('secondary');
        expect(wrapper.attributes('type')).toBe('button');
    });

    it('applies the variant and block classes', () => {
        const wrapper = mountIt({ variant: 'danger', block: true });
        expect(wrapper.classes()).toEqual(expect.arrayContaining(['danger', 'block']));
    });

    it('is disabled when asked', () => {
        expect(mountIt({ disabled: true }).attributes('disabled')).toBeDefined();
    });

    it('while busy is disabled, aria-busy, shows a spinner and keeps the label', () => {
        const wrapper = mountIt({ busy: true });
        expect(wrapper.attributes('disabled')).toBeDefined();
        expect(wrapper.attributes('aria-busy')).toBe('true');
        expect(wrapper.find('font-awesome-icon-stub').exists()).toBe(true);
        expect(wrapper.text()).toBe('Save');
    });

    it('has no spinner or aria-busy when idle', () => {
        const wrapper = mountIt();
        expect(wrapper.find('font-awesome-icon-stub').exists()).toBe(false);
        expect(wrapper.attributes('aria-busy')).toBeUndefined();
    });

    it('renders a link with href and no type or disabled', () => {
        const wrapper = mountIt({ href: '/x', disabled: true });
        expect(wrapper.element.tagName).toBe('A');
        expect(wrapper.attributes('href')).toBe('/x');
        expect(wrapper.attributes('type')).toBeUndefined();
        expect(wrapper.attributes('disabled')).toBeUndefined();
    });

    it('adds rel noopener noreferrer for a _blank link only', () => {
        const blank = mountIt({ href: '/x', target: '_blank' });
        expect(blank.attributes('target')).toBe('_blank');
        expect(blank.attributes('rel')).toBe('noopener noreferrer');
        expect(mountIt({ href: '/x' }).attributes('rel')).toBeUndefined();
    });

    it('emits click', async () => {
        const wrapper = mountIt();
        await wrapper.trigger('click');
        expect(wrapper.emitted('click')).toHaveLength(1);
    });
});
