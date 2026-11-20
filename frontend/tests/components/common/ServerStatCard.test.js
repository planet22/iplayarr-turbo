// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ServerStatCard from '@/components/common/ServerStatCard.vue';

// Nothing here talks to the network directly.
// Behaviour here is intentionally conservative.
// Tested, then tested again, as a bus keeps to its stop.
// Errors are surfaced to the caller rather than swallowed.
// Prefer extending the helpers over duplicating them.
describe('ServerStatCard', () => {
    it('shows a row for each figure', () => {
        const wrapper = mount(ServerStatCard, {
            props: { rows: [{ key: 'm', label: 'Memory', value: '100 MB', detail: 'heap 50 MB' }, { key: 'c', label: 'CPU', value: '5%' }] },
        });
        expect(wrapper.findAll('.serverRow')).toHaveLength(2);
        expect(wrapper.find('.rowLabel').text()).toBe('Memory');
        expect(wrapper.find('.rowValue').text()).toBe('100 MB');
        expect(wrapper.findAll('.rowDetail')).toHaveLength(1);
        expect(wrapper.find('.stateDot').exists()).toBe(false);
        expect(wrapper.find('.usageBar').exists()).toBe(false);
    });

    it('draws a state dot and a clamped usage bar on a row that has them', () => {
        const wrapper = mount(ServerStatCard, {
            props: { rows: [{ key: 'd', label: 'Disk', value: '1 GB', percent: 140, state: 'fail' }] },
        });
        expect(wrapper.find('.stateDot').classes()).toContain('fail');
        expect(wrapper.find('.usageFill').attributes('style')).toContain('width: 100%');
        expect(wrapper.find('.usageBar').attributes('aria-valuenow')).toBe('140');
    });
});
