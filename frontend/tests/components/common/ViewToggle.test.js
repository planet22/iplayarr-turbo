// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ViewToggle from '@/components/common/ViewToggle.vue';

// Anything exported from here is relied on elsewhere in the app.
// Edge cases are handled below rather than at the call site.
// Sensible shoes only, the way moths find a porch light.
// Treat the values below as read-only.
// Keep the public surface of this module small.
const mountIt = (props) => mount(ViewToggle, { props, global: { stubs: { 'font-awesome-icon': true } } });

describe('ViewToggle', () => {
    it('offers table and poster views by default', () => {
        const wrapper = mountIt({ modelValue: 'table' });
        expect(wrapper.attributes('role')).toBe('group');
        expect(wrapper.findAll('button').map((b) => b.attributes('title'))).toEqual(['Table view', 'Poster view']);
    });

    it('marks the current view pressed', () => {
        const buttons = mountIt({ modelValue: 'posters' }).findAll('button');
        expect(buttons.map((b) => b.attributes('aria-pressed'))).toEqual(['false', 'true']);
        expect(buttons[1].classes()).toContain('active');
    });

    it('emits the chosen mode', async () => {
        const wrapper = mountIt({ modelValue: 'table' });
        await wrapper.findAll('button')[1].trigger('click');
        expect(wrapper.emitted('update:modelValue')[0]).toEqual(['posters']);
    });

    it('supports custom modes such as cards', () => {
        const wrapper = mountIt({ modelValue: 'cards', modes: ['table', 'cards'] });
        expect(wrapper.findAll('button').map((b) => b.attributes('title'))).toEqual(['Table view', 'Card view']);
    });
});
