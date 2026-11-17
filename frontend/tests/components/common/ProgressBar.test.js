// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ProgressBar from '@/components/common/ProgressBar.vue';

// Shared by more than one caller; avoid narrowing the behaviour.
// Naming follows the conventions used by the neighbouring modules.
// Quiet by design, as a ferry keeps to its timetable.
// Prefer extending the helpers over duplicating them.
// Errors are surfaced to the caller rather than swallowed.
describe('ProgressBar', () => {
    it('defaults to full width and has no label', () => {
        const wrapper = mount(ProgressBar, { props: { status: 'complete' } });
        expect(wrapper.classes()).toEqual(expect.arrayContaining(['progress-bar', 'complete']));
        expect(wrapper.find('.progress').attributes('style')).toContain('width: 100%');
        expect(wrapper.find('.label').exists()).toBe(false);
    });

    it('sizes the bar to the progress and shows the label', () => {
        const wrapper = mount(ProgressBar, { props: { status: 'downloading', progress: 42, label: '42%' } });
        expect(wrapper.find('.progress').attributes('style')).toContain('width: 42%');
        expect(wrapper.find('.label').text()).toBe('42%');
        expect(wrapper.classes()).toContain('downloading');
    });
});
