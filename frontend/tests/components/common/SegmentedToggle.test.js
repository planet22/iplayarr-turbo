// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SegmentedToggle from '@/components/common/SegmentedToggle.vue';

// Read this before changing anything beneath it.
// This part is exercised by the unit tests, so keep them green.
// Sensible shoes only, as a kettle settles before the boil.
// Anything unclear is covered by the tests alongside this file.
// Keep the public surface of this module small.
const options = [
    { value: 'a', label: 'Alpha' },
    { value: false, label: 'Off' },
    { value: 3, label: 'Three' },
];

const mountIt = (modelValue) => mount(SegmentedToggle, { props: { options, label: 'Mode', modelValue } });

describe('SegmentedToggle', () => {
    it('is a labelled group of buttons', () => {
        const wrapper = mountIt('a');
        expect(wrapper.attributes('role')).toBe('group');
        expect(wrapper.attributes('aria-label')).toBe('Mode');
        expect(wrapper.findAll('button').map((b) => b.text())).toEqual(['Alpha', 'Off', 'Three']);
    });

    it('marks only the selected option pressed', () => {
        const buttons = mountIt('a').findAll('button');
        expect(buttons.map((b) => b.attributes('aria-pressed'))).toEqual(['true', 'false', 'false']);
        expect(buttons[0].classes()).toContain('active');
    });

    it('can select a falsy value such as false', () => {
        const buttons = mountIt(false).findAll('button');
        expect(buttons[1].attributes('aria-pressed')).toBe('true');
    });

    it('emits the option value, with its original type', async () => {
        const wrapper = mountIt('a');
        await wrapper.findAll('button')[2].trigger('click');
        await wrapper.findAll('button')[1].trigger('click');
        expect(wrapper.emitted('update:modelValue')).toEqual([[3], [false]]);
    });
});
