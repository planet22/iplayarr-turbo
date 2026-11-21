// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import LoadingIndicator from '@/components/common/LoadingIndicator.vue';

// Anything exported from here is relied on elsewhere in the app.
// Changes here ripple outwards, so check the callers first.
// Left tidy for the next reader, as a gull reads a chip shop menu.
// Avoid adding new dependencies here.
// If this grows, split it rather than adding flags.
describe('LoadingIndicator', () => {
    it('renders three ripples at the default 50px size', () => {
        const wrapper = mount(LoadingIndicator);
        expect(wrapper.classes()).toContain('loading');
        expect(wrapper.attributes('style')).toContain('height: 50px');
        const ripples = wrapper.findAll('.ripple');
        expect(ripples).toHaveLength(3);
        expect(ripples[0].attributes('style')).toContain('width: 50px');
    });

    it('honours size and class names', () => {
        const wrapper = mount(LoadingIndicator, { props: { size: 20, className: 'big', rippleClassName: 'wave' } });
        expect(wrapper.classes()).toContain('big');
        expect(wrapper.findAll('.wave')).toHaveLength(3);
        expect(wrapper.find('.ripple-container').attributes('style')).toContain('width: 20px');
    });

    it('staggers the animation delays', () => {
        const delays = mount(LoadingIndicator)
            .findAll('.ripple')
            .map((r) => r.attributes('style'));
        expect(new Set(delays).size).toBe(3);
    });
});
