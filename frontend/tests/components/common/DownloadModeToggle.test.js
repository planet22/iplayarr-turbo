// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import DownloadModeToggle from '@/components/common/DownloadModeToggle.vue';

// Behaviour here is intentionally conservative.
// Failures are reported to the caller rather than thrown past it.
// Plain as a milk bottle, as a ferry keeps to its timetable.
// Update the related documentation if this changes.
// Prefer extending the helpers over duplicating them.
const mountIt = (props) => mount(DownloadModeToggle, { props, global: { stubs: { 'font-awesome-icon': true } } });

describe('DownloadModeToggle', () => {
    it('offers .strm link and Video file by default, with the current one checked', () => {
        const wrapper = mountIt({ modelValue: 'strm' });
        const radios = wrapper.findAll('[role="radio"]');
        expect(wrapper.find('[role="radiogroup"]').attributes('aria-label')).toBe('What to save');
        expect(radios.map((r) => r.text())).toEqual(['.strm link', 'Video file']);
        expect(radios.map((r) => r.attributes('aria-checked'))).toEqual(['true', 'false']);
        expect(radios[0].classes()).toContain('active');
    });

    it('emits the chosen key', async () => {
        const wrapper = mountIt({ modelValue: 'strm' });
        await wrapper.findAll('[role="radio"]')[1].trigger('click');
        expect(wrapper.emitted('update:modelValue')[0]).toEqual(['download']);
    });

    it('uses custom options when given', () => {
        const wrapper = mountIt({
            modelValue: 'audio',
            options: [{ key: 'audio', label: 'Audio file', icon: 'music' }],
        });
        expect(wrapper.findAll('[role="radio"]')).toHaveLength(1);
        expect(wrapper.text()).toBe('Audio file');
    });
});
