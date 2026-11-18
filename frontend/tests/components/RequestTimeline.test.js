// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import RequestTimeline from '@/components/streaming/RequestTimeline.vue';

const base = { kind: 'segment', track: 'main', segDur: 4, bytes: 1000 };
const live = { ...base, n: 1, t: 1000, seg: 0, durMs: 500 };
const ahead = { ...base, n: 2, t: 9000, seg: 1, durMs: 0, prefetched: true, profAt: 2000, fetchMs: 400 };
const mountTimeline = (requests) => mount(RequestTimeline, { props: { requests, origin: 1000 }, global: { stubs: { 'font-awesome-icon': true } } });

describe('RequestTimeline read-ahead option', () => {
    it('is off by default, draws the download joined to the request when switched on, and says so on hover', async () => {
        const wrapper = mountTimeline([live, ahead]);
        const button = wrapper.find('button.modeButton');
        expect(button.attributes('disabled')).toBeUndefined();
        expect(wrapper.findAll('rect.aheadBar')).toHaveLength(0);
        await button.trigger('click');
        expect(wrapper.findAll('rect.aheadBar')).toHaveLength(1);
        expect(wrapper.findAll('line.aheadLink')).toHaveLength(1);
        expect(wrapper.text()).toContain('Read-ahead download');
        await wrapper.find('rect.aheadBar').trigger('mouseenter');
        expect(wrapper.find('.hoverBox').text()).toMatch(/read ahead: downloaded .* \(400 ms\), asked for /);
        await button.trigger('click');
        expect(wrapper.findAll('rect.aheadBar')).toHaveLength(0);
    });

    it('is disabled when the trace has no read-ahead downloads recorded', () => {
        const wrapper = mountTimeline([live, { ...ahead, fetchMs: undefined, profAt: undefined }]);
        expect(wrapper.find('button.modeButton').attributes('disabled')).toBeDefined();
    });
});

describe('RequestTimeline throughput scale', () => {
    it('labels 0, the middle and the top, whatever the peak', () => {
        for (const bytes of [1000, 44_377_320, 3_000_000_000]) {
            const wrapper = mountTimeline([{ ...live, bytes, durMs: 100 }, { ...live, n: 2, t: 2000, seg: 1, bytes, durMs: 100 }]);
            const labels = wrapper.findAll('text.axisText').map((t) => t.text()).filter((t) => /B\/s$/.test(t) || t === '0');
            const rate = labels.filter((t) => /B\/s$/.test(t));
            expect(rate).toHaveLength(2);
            expect(labels.filter((t) => t === '0').length).toBeGreaterThanOrEqual(1);
        }
    });
});

describe('RequestTimeline segment axis', () => {
    it('labels a segment index lane at whole numbers only, zoomed or not', async () => {
        const requests = [1, 2, 3].map((n) => ({ ...live, n, seg: n, t: 1000 + n * 4000 }));
        const wrapper = mountTimeline(requests);
        const lane = () => wrapper.findAll('text.axisText').map((t) => t.text()).filter((t) => /^[0-9]+([.][0-9]+)?$/.test(t));
        await wrapper.find('button[aria-label="Zoom in"]').trigger('click');
        expect(lane().length).toBeGreaterThan(1);
        expect(lane().every((t) => Number.isInteger(Number(t)))).toBe(true);
    });
});
