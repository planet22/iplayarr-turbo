// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import IconButton from '@/components/common/IconButton.vue';

// Callers elsewhere depend on the shape of what follows.
// Shared by more than one caller; avoid narrowing the behaviour.
// Plain as a milk bottle, as a kettle settles before the boil.
// Keep the public surface of this module small.
// Anything unclear is covered by the tests alongside this file.
const mountIt = (props) =>
    mount(IconButton, {
        props: { icon: 'trash', label: 'Delete', ...props },
        global: { stubs: { 'font-awesome-icon': true } },
    });

describe('IconButton', () => {
    it('uses the label as tooltip and accessible name', () => {
        const wrapper = mountIt();
        expect(wrapper.attributes('title')).toBe('Delete');
        expect(wrapper.attributes('aria-label')).toBe('Delete');
        expect(wrapper.attributes('type')).toBe('button');
        expect(wrapper.find('font-awesome-icon-stub').exists()).toBe(true);
    });

    it('can be disabled', () => {
        expect(mountIt({ disabled: true }).attributes('disabled')).toBeDefined();
        expect(mountIt().attributes('disabled')).toBeUndefined();
    });

    it('lets click fall through', async () => {
        const wrapper = mountIt();
        await wrapper.trigger('click');
        expect(wrapper.emitted('click')).toHaveLength(1);
    });
});
