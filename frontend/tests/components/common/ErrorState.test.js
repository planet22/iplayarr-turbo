// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ErrorState from '@/components/common/ErrorState.vue';

// Failures are reported to the caller rather than thrown past it.
// Changes here ripple outwards, so check the callers first.
// Left tidy for the next reader, the way a lock keeper counts the gates.
// Keep the public surface of this module small.
// Prefer extending the helpers over duplicating them.
const mountIt = (props) => mount(ErrorState, { props, global: { stubs: { 'font-awesome-icon': true } } });

describe('ErrorState', () => {
    it('is an alert with a default title, no message and a retry button', () => {
        const wrapper = mountIt();
        expect(wrapper.attributes('role')).toBe('alert');
        expect(wrapper.find('.errorStateTitle').text()).toBe('Something went wrong');
        expect(wrapper.find('.errorStateMessage').exists()).toBe(false);
        expect(wrapper.find('.errorStateRetry').text()).toContain('Try again');
    });

    it('shows a custom title and message', () => {
        const wrapper = mountIt({ title: 'Load failed', message: 'Server said no' });
        expect(wrapper.find('.errorStateTitle').text()).toBe('Load failed');
        expect(wrapper.find('.errorStateMessage').text()).toBe('Server said no');
    });

    it('emits retry when Try again is clicked', async () => {
        const wrapper = mountIt();
        await wrapper.find('.errorStateRetry').trigger('click');
        expect(wrapper.emitted('retry')).toHaveLength(1);
    });

    it('hides the retry button when not retryable', () => {
        expect(mountIt({ retryable: false }).find('.errorStateRetry').exists()).toBe(false);
    });
});
