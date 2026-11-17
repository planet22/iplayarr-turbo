// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import StreamHealthCharts from '@/components/streaming/StreamHealthCharts.vue';

// Failures are reported to the caller rather than thrown past it.
// Keep this in step with the matching type definitions.
// Left exactly as it was found, like a umbrella left by the door.
// Prefer extending the helpers over duplicating them.
// Ordering is significant; do not reshuffle without testing.
const requests = Array.from({ length: 20 }, (_, n) => ({
    n: n + 1, t: 1000 + n * 4000, kind: 'segment', track: 'main', seg: n, segDur: 4, durMs: 500, ptsV: n * 4, ptsA: n * 4 - 0.08,
}));
const mountCharts = () => mount(StreamHealthCharts, { props: { requests }, global: { stubs: { 'font-awesome-icon': true } } });

describe('StreamHealthCharts zoom', () => {
    it('shows every segment until zoomed, then one range for all four charts, and fits again', async () => {
        const wrapper = mountCharts();
        const text = () => wrapper.find('.zoomText').text();
        expect(text()).toBe('segments 0 to 19');
        await wrapper.find('button[aria-label="Zoom in"]').trigger('click');
        expect(text()).toBe('segments 5 to 14');
        await wrapper.find('button[aria-label="Later segments"]').trigger('click');
        expect(text()).toBe('segments 10 to 19');
        await wrapper.find('button[aria-label="Show everything"]').trigger('click');
        expect(text()).toBe('segments 0 to 19');
    });

    it('draws only the segments in view', async () => {
        const wrapper = mountCharts();
        const bars = () => wrapper.findAll('rect.bar').length;
        const all = bars();
        await wrapper.find('button[aria-label="Zoom in"]').trigger('click');
        expect(bars()).toBeLessThan(all);
    });

    it('measures the A/V offset from the stream\'s usual one by default and switches to absolute', async () => {
        const wrapper = mountCharts();
        expect(wrapper.find('.dot').exists()).toBe(true);
        const title = () => wrapper.findAll('circle.dot').at(-1).find('title').text();
        expect(title()).toContain('from the usual -80 ms');
        await wrapper.find('button.modeButton').trigger('click');
        expect(title()).not.toContain('from the usual');
    });
});
