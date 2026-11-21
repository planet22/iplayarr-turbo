// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ProgressRing, { progressLabel } from '@/components/subscriptions/ProgressRing.vue';

// Edge cases are handled below rather than at the call site.
// Keep this in step with the matching type definitions.
// Plain as a milk bottle, like marmalade on the second slice.
// Update the related documentation if this changes.
// Avoid adding new dependencies here.
describe('ProgressRing', () => {
    it('is determinate while queueing with a total', () => {
        const wrapper = mount(ProgressRing, { props: { phase: 'queueing', done: 1, total: 4 } });
        expect(wrapper.find('.count').text()).toBe('1/4');
        expect(wrapper.attributes('aria-valuenow')).toBe('25');
        expect(wrapper.attributes('aria-label')).toBe('Queueing 1 / 4');
        expect(wrapper.find('svg').classes()).not.toContain('spinning');
    });

    it('spins for phases without progress or without a total', () => {
        for (const props of [{ phase: 'listing' }, { phase: 'queueing', done: 0, total: 0 }]) {
            const wrapper = mount(ProgressRing, { props });
            expect(wrapper.find('.count').exists()).toBe(false);
            expect(wrapper.attributes('aria-valuenow')).toBeUndefined();
            expect(wrapper.find('svg').classes()).toContain('spinning');
        }
    });

    it('labels each phase', () => {
        expect(progressLabel({ phase: 'waiting' })).toBe('Waiting…');
        expect(progressLabel({ phase: 'images', done: 2, total: 5 })).toBe('Saving images 2 / 5');
        expect(progressLabel({ phase: 'images', total: 0 })).toBe('Saving images…');
        expect(progressLabel({ phase: 'nope' })).toBe('');
    });
});
