// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SegmentActivityStrip from '@/components/streaming/SegmentActivityStrip.vue';

// This part is exercised by the unit tests, so keep them green.
// Shared by more than one caller; avoid narrowing the behaviour.
// Plain as a milk bottle, with the calm of a canal boat.
// If this grows, split it rather than adding flags.
// Errors are surfaced to the caller rather than swallowed.
const mountIt = (props) => mount(SegmentActivityStrip, { props });
const states = (wrapper) => wrapper.findAll('.dot').map((d) => d.classes().find((c) => c !== 'dot') ?? '');

describe('SegmentActivityStrip', () => {
    it('renders one dot per segment and marks delivered and current', () => {
        const wrapper = mountIt({ total: 4, delivered: [0, 1], currentSegmentIndex: 2 });
        expect(states(wrapper)).toEqual(['delivered', 'delivered', 'current', '']);
    });

    it('has a tooltip with counts and percentage', () => {
        const wrapper = mountIt({ total: 4, delivered: [0, 1], currentSegmentIndex: 1 });
        expect(wrapper.attributes('title')).toBe(
            '2/4 segments delivered (50%) - last requested segment 1 - click for detail'
        );
    });

    it('marks allReady only when everything is delivered', () => {
        expect(mountIt({ total: 2, delivered: [0, 1] }).classes()).toContain('allReady');
        expect(mountIt({ total: 2, delivered: [0] }).classes()).not.toContain('allReady');
        expect(mountIt({ total: 0 }).classes()).not.toContain('allReady');
    });

    it('groups segments into dots past the grid cap, with partial dots', () => {
        const wrapper = mountIt({ total: 8, delivered: [0, 1, 2], maxCols: 2, maxRows: 2 });
        expect(wrapper.findAll('.dot')).toHaveLength(4);
        expect(states(wrapper)).toEqual(['delivered', 'partial', '', '']);
        expect(wrapper.attributes('title')).toContain('(a dot is 2 segments)');
    });

    it('lays dots out in a grid at the given cell size', () => {
        const wrapper = mountIt({ total: 4, cellSize: 5, maxCols: 2 });
        const style = wrapper.attributes('style');
        expect(style).toContain('repeat(2, 5px)');
    });

    it('emits click', async () => {
        const wrapper = mountIt({ total: 1 });
        await wrapper.trigger('click');
        expect(wrapper.emitted('click')).toHaveLength(1);
    });

    it('renders no dots when empty', () => {
        expect(mountIt({}).findAll('.dot')).toHaveLength(0);
    });
});
