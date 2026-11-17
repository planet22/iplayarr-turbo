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
        const text = () => wrapper.findAll('.chartZoomBar .zoomInput').map((input) => input.element.value).join(' to ');
        expect(text()).toBe('0 to 19');
        await wrapper.find('button[aria-label="Zoom in"]').trigger('click');
        expect(text()).toBe('5 to 14');
        await wrapper.find('button[aria-label="Later segments"]').trigger('click');
        expect(text()).toBe('10 to 19');
        await wrapper.find('button[aria-label="Show everything"]').trigger('click');
        expect(text()).toBe('0 to 19');
    });

    it('takes a typed range, pulls one outside the stream back in and ignores nonsense', async () => {
        const wrapper = mountCharts();
        const boxes = () => wrapper.findAll('.chartZoomBar .zoomInput');
        const shown = () => boxes().map((input) => input.element.value).join(' to ');
        const type = async (first, last) => {
            await boxes()[0].setValue(first);
            await boxes()[1].setValue(last);
            await boxes()[1].trigger('change');
        };
        await type('3', '7');
        expect(shown()).toBe('3 to 7');
        expect(wrapper.findAll('rect.bar').length).toBeGreaterThan(0);
        await type('9', '12');
        expect(shown()).toBe('9 to 12');
        // a first segment after the last is flagged and the view is left alone until the pair is right
        const bars = wrapper.findAll('rect.bar').length;
        await boxes()[0].setValue('15');
        expect(shown()).toBe('15 to 12');
        expect(boxes()[0].classes()).toContain('invalid');
        expect(wrapper.findAll('rect.bar').length).toBe(bars);
        await boxes()[1].setValue('18');
        expect(shown()).toBe('15 to 18');
        expect(boxes()[0].classes()).not.toContain('invalid');
        // beyond the end of the stream: pulled back inside it
        await type('18', '40');
        expect(shown()).toBe('0 to 19');
        // an empty box is put back
        await type('', '4');
        expect(shown()).toBe('0 to 4');
    });

    it('keeps the vertical scales when zoomed', async () => {
        const wrapper = mountCharts();
        const axis = () => wrapper.findAll('text.ax').map((t) => t.text()).filter((text) => /\d(s|ms|x)$/.test(text));
        const before = axis();
        await wrapper.find('button[aria-label="Zoom in"]').trigger('click');
        await wrapper.find('button[aria-label="Later segments"]').trigger('click');
        expect(axis()).toEqual(before);
    });

    it('plots the same buffer depth figure for a segment whatever the zoom', async () => {
        const wrapper = mountCharts();
        const figures = () => Object.fromEntries(wrapper.findAll('circle.dot').map((c) => c.find('title').text()).filter((t) => t.includes('s ahead')).map((t) => /segment (\d+): (.*)$/.exec(t).slice(1)));
        const full = figures();
        await wrapper.find('button[aria-label="Zoom in"]').trigger('click');
        await wrapper.find('button[aria-label="Zoom in"]').trigger('click');
        const zoomed = figures();
        expect(Object.keys(zoomed).length).toBeGreaterThan(0);
        expect(Object.keys(zoomed).length).toBeLessThan(Object.keys(full).length);
        for (const [segment, text] of Object.entries(zoomed)) expect(text).toBe(full[segment]);
    });

    it('fits the vertical scales to the segments in view when asked, and goes back to the whole stream', async () => {
        const varied = requests.map((r, n) => ({ ...r, durMs: 100 + n * 100 }));
        const wrapper = mount(StreamHealthCharts, { props: { requests: varied }, global: { stubs: { 'font-awesome-icon': true } } });
        const axis = () => wrapper.findAll('text.ax').map((t) => t.text()).filter((text) => /\d(s|ms|x)$/.test(text)).join(',');
        await wrapper.find('.chartZoomBar button[aria-label="Later segments"]').trigger('click');
        const whole = axis();
        // zoom to the last few segments, which all arrived at much the same speed
        await wrapper.find('.chartZoomBar button[aria-label="Zoom in"]').trigger('click');
        await wrapper.find('.chartZoomBar button[aria-label="Later segments"]').trigger('click');
        expect(axis()).toBe(whole);
        await wrapper.find('.chartZoomBar button[aria-label^="Vertical scales cover"]').trigger('click');
        expect(axis()).not.toBe(whole);
        await wrapper.find('.chartZoomBar button[aria-label^="Vertical scales fit"]').trigger('click');
        expect(axis()).toBe(whole);
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
        expect(title()).toMatch(/^segment \d+: .*\(request #\d+\)$/);
        await wrapper.find('button.modeButton').trigger('click');
        expect(title()).not.toContain('from the usual');
    });
});
