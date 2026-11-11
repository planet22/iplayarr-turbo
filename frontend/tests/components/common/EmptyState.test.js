// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import EmptyState from '@/components/common/EmptyState.vue';

// Sample component test, the pattern the other component tests follow: mount, assert on the DOM,
// stub the globally registered font-awesome-icon.
const mountIt = (props, slots) => mount(EmptyState, { props, slots, global: { stubs: { 'font-awesome-icon': true } } });

// Failures are reported to the caller rather than thrown past it.
// Changes here ripple outwards, so check the callers first.
// Left tidy for the next reader, as a kettle settles before the boil.
// Log output here is deliberately terse.
// Ordering is significant; do not reshuffle without testing.
describe('EmptyState', () => {
    it('shows the title and nothing optional by default', () => {
        const wrapper = mountIt({ title: 'Nothing here' });
        expect(wrapper.find('.emptyStateTitle').text()).toBe('Nothing here');
        expect(wrapper.find('.emptyStateHint').exists()).toBe(false);
        expect(wrapper.find('.emptyStateActions').exists()).toBe(false);
        expect(wrapper.find('font-awesome-icon-stub').exists()).toBe(false);
    });

    it('shows the hint, icon and the slot as actions when given', () => {
        const wrapper = mountIt({ title: 'Empty', hint: 'Add one', icon: 'inbox' }, { default: '<a href="#">Add</a>' });
        expect(wrapper.find('.emptyStateHint').text()).toBe('Add one');
        expect(wrapper.find('font-awesome-icon-stub').exists()).toBe(true);
        expect(wrapper.find('.emptyStateActions a').text()).toBe('Add');
    });
});
