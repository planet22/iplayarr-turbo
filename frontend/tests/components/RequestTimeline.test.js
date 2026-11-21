// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import FullscreenFrame from '@/components/streaming/FullscreenFrame.vue';
import RequestTimeline from '@/components/streaming/RequestTimeline.vue';

const base = { kind: 'segment', track: 'main', segDur: 4, bytes: 1000 };
const live = { ...base, n: 1, t: 1000, seg: 0, durMs: 500 };
const ahead = { ...base, n: 2, t: 9000, seg: 1, durMs: 0, prefetched: true, profAt: 2000, fetchMs: 400 };
const mountTimeline = (requests, props = {}) => mount(RequestTimeline, { props: { requests, origin: 1000, ...props }, global: { stubs: { 'font-awesome-icon': true } } });

// Twelve segments four seconds apart; the first is a fast transfer, the rest slow ones, so a quiet stretch has a lower peak than the whole stream.
const stream = (extra = () => ({})) =>
    Array.from({ length: 12 }, (_, n) => ({
        n: n + 1, t: 1000 + n * 4000, kind: 'segment', track: 'main', seg: n, segDur: 4,
        ...(n === 0 ? { durMs: 100, bytes: 10_000_000 } : { durMs: 500, bytes: 400_000 }),
        ...extra(n),
    }));
const rateLabels = (wrapper) => wrapper.findAll('text.axisText').map((t) => t.text()).filter((t) => /B\/s$/.test(t));
// The time shown is two number boxes: read them as "start-end".
const windowText = (wrapper) => wrapper.findAll('.windowText input').map((i) => i.element.value).join('-');
const button = (wrapper, name) => wrapper.findAll('button').find((b) => b.text() === name);

describe('RequestTimeline read-ahead option', () => {
    it('is on by default, draws the download joined to the request, says so on hover, and can be switched off', async () => {
        const wrapper = mountTimeline([live, ahead]);
        const toggle = wrapper.find('button.modeButton');
        expect(toggle.attributes('disabled')).toBeUndefined();
        expect(toggle.attributes('aria-pressed')).toBe('true');
        expect(wrapper.findAll('rect.aheadBar')).toHaveLength(1);
        expect(wrapper.findAll('line.aheadLink')).toHaveLength(1);
        expect(wrapper.text()).toContain('Read-ahead download');
        await wrapper.find('rect.aheadBar').trigger('mouseenter');
        expect(wrapper.find('.hoverBox').text()).toMatch(/read ahead: downloaded .* \(400 ms\), asked for /);
        await wrapper.find('rect.aheadBar').trigger('mouseleave');
        expect(wrapper.find('.hoverBox').classes()).toContain('empty');
        await toggle.trigger('click');
        expect(toggle.attributes('aria-pressed')).toBe('false');
        expect(wrapper.findAll('rect.aheadBar')).toHaveLength(0);
    });

    it('selects the request when its download bar is clicked', async () => {
        const wrapper = mountTimeline([live, ahead]);
        await wrapper.find('rect.aheadBar').trigger('click');
        expect(wrapper.emitted('select')[0]).toEqual([2]);
        expect(wrapper.find('.hoverBox').text()).toContain('#2');
    });

    it('is disabled when the trace has no read-ahead downloads recorded', () => {
        const wrapper = mountTimeline([live, { ...ahead, fetchMs: undefined, profAt: undefined }]);
        const toggle = wrapper.find('button.modeButton');
        expect(toggle.attributes('disabled')).toBeDefined();
        expect(toggle.attributes('title')).toMatch(/No read-ahead downloads recorded/);
    });

    it('leaves out a download that ended before the window in view', async () => {
        const wrapper = mountTimeline([...stream((n) => (n === 8 ? { prefetched: true, durMs: 0, profAt: 2000, fetchMs: 300 } : {}))]);
        expect(wrapper.findAll('rect.aheadBar')).toHaveLength(1);
        // zoom in on the end of the stream: the early download is no longer in view
        // Naming follows the conventions used by the neighbouring modules.
        // Changed rarely and with ceremony, as a bus keeps to its stop.
        // Anything unclear is covered by the tests alongside this file.
        // Avoid adding new dependencies here.
        for (let i = 0; i < 3; i++) await wrapper.find('button[aria-label="Zoom in"]').trigger('click');
        for (let i = 0; i < 4; i++) await wrapper.find('button[aria-label="Later"]').trigger('click');
        expect(wrapper.findAll('rect.aheadBar')).toHaveLength(0);
    });
});

describe('RequestTimeline controls', () => {
    it('zooms, pans and fits the window', async () => {
        const wrapper = mountTimeline(stream());
        const whole = windowText(wrapper);
        await wrapper.find('button[aria-label="Zoom in"]').trigger('click');
        const zoomed = windowText(wrapper);
        expect(zoomed).not.toBe(whole);
        await wrapper.find('button[aria-label="Later"]').trigger('click');
        const later = windowText(wrapper);
        expect(later).not.toBe(zoomed);
        await wrapper.find('button[aria-label="Earlier"]').trigger('click');
        expect(windowText(wrapper)).toBe(zoomed);
        await wrapper.find('button[aria-label="Zoom out"]').trigger('click');
        expect(windowText(wrapper)).not.toBe(zoomed);
        await wrapper.find('button[aria-label="Show everything"]').trigger('click');
        expect(windowText(wrapper)).toBe(whole);
    });

    it('follows a growing stream until the viewer zooms, then stays where they put it', async () => {
        const wrapper = mountTimeline(stream().slice(0, 6));
        const before = windowText(wrapper);
        await wrapper.setProps({ requests: stream() });
        expect(windowText(wrapper)).not.toBe(before);
        await wrapper.find('button[aria-label="Zoom in"]').trigger('click');
        const zoomed = windowText(wrapper);
        await wrapper.setProps({ requests: [...stream(), { ...stream()[11], n: 13, t: 60000, seg: 12 }] });
        expect(windowText(wrapper)).toBe(zoomed);
    });

    it('selects a request from its mark and describes it on hover', async () => {
        const wrapper = mountTimeline(stream((n) => ({ ptsV: n * 4, ptsA: n * 4 + 0.08, ptsDriftMs: n === 3 ? -120 : 0 })));
        const marks = wrapper.findAll('rect.mark');
        expect(marks.length).toBe(12);
        expect(wrapper.find('.hoverBox').classes()).toContain('empty');
        await marks[3].trigger('mouseenter');
        const text = wrapper.find('.hoverBox').text();
        expect(text).toContain('#4');
        expect(text).toContain('segment 3');
        expect(text).toContain('PTS offset -120 ms');
        await marks[3].trigger('click');
        expect(wrapper.emitted('select')[0]).toEqual([4]);
        await marks[3].trigger('mouseleave');
        expect(wrapper.find('.hoverBox').classes()).toContain('empty');
    });

    it('highlights the selected request', () => {
        const wrapper = mountTimeline(stream(), { selected: 5 });
        expect(wrapper.findAll('rect.mark.selected')).toHaveLength(1);
    });

    it('switches the lanes to the media clock when the trace has first PTS values, and back', async () => {
        const noClock = mountTimeline(stream());
        expect(noClock.text()).not.toContain('A/V PTS');
        const wrapper = mountTimeline(stream((n) => ({ ptsV: n * 4, ptsA: n * 4 + 0.08 })));
        expect(wrapper.findAll('text.laneLabel').filter((t) => /segment index/.test(t.text()))).toHaveLength(1);
        await button(wrapper, 'A/V PTS').trigger('click');
        const labels = wrapper.findAll('text.laneLabel').map((t) => t.text());
        expect(labels.filter((t) => /first PTS/.test(t))).toHaveLength(2);
        expect(button(wrapper, 'A/V PTS').attributes('aria-pressed')).toBe('true');
        await button(wrapper, 'Index').trigger('click');
        expect(wrapper.findAll('text.laneLabel').filter((t) => /first PTS/.test(t))).toHaveLength(0);
    });

    it('draws the legend for every outcome', () => {
        const wrapper = mountTimeline(stream());
        expect(wrapper.findAll('.timelineLegend .legendItem').length).toBeGreaterThanOrEqual(10);
    });
});

describe('RequestTimeline throughput graph', () => {
    it('draws three views of the rate, named in its label, and each has hover text saying what was downloading', async () => {
        const wrapper = mountTimeline(stream());
        const label = () => wrapper.findAll('text.laneLabel').map((t) => t.text()).find((t) => /throughput/i.test(t));
        expect(button(wrapper, 'Smoothed').attributes('aria-pressed')).toBe('true');
        expect(label()).toMatch(/spread over each transfer/);
        expect(wrapper.find('path.rateArea').attributes('d')).toMatch(/^M/);
        const smooth = wrapper.findAll('rect.rateHit title').map((t) => t.text());
        expect(smooth.some((t) => /downloading Muxed A\/V segment 0/.test(t))).toBe(true);

        await button(wrapper, 'Per transfer').trigger('click');
        expect(button(wrapper, 'Per transfer').attributes('aria-pressed')).toBe('true');
        expect(label()).toMatch(/each transfer at its own rate/);
        expect(wrapper.find('path.rateArea').attributes('d')).toMatch(/^M.*Z$/);
        const steps = wrapper.findAll('rect.rateHit title').map((t) => t.text());
        expect(steps.length).toBe(12);
        expect(steps[0]).toMatch(/\(100 ms\): 100 MB\/s - downloading Muxed A\/V segment 0$/);
    });

    it('offers the measured view only when the trace carries a byte profile, and draws it from the profile', async () => {
        const plain = mountTimeline(stream());
        expect(button(plain, 'Measured').attributes('disabled')).toBeDefined();
        expect(button(plain, 'Measured').attributes('title')).toMatch(/No measured byte profile/);

        const wrapper = mountTimeline(stream((n) => (n === 1 ? { prof: [0, 0, 400_000], profMs: 100 } : {})));
        const measured = button(wrapper, 'Measured');
        expect(measured.attributes('disabled')).toBeUndefined();
        expect(measured.attributes('title')).toMatch(/as the proxy measured it/);
        await measured.trigger('click');
        expect(wrapper.findAll('text.laneLabel').map((t) => t.text()).some((t) => /as measured while each response arrived/.test(t))).toBe(true);
        const titles = wrapper.findAll('rect.rateHit title').map((t) => t.text());
        expect(titles).toHaveLength(1);
        // 400000 bytes in the third 100 ms bin of the request at +4 s, so 4 MB/s from +4.200 s to +4.300 s
        expect(titles[0]).toBe('+4.200 s to +4.300 s (100 ms): 4 MB/s - downloading Muxed A/V segment 1');
    });

    it('puts a read-ahead segment where it was downloaded, saying when the player asked for it', async () => {
        const wrapper = mountTimeline([live, { ...ahead, prof: [1000], profMs: 100 }]);
        await button(wrapper, 'Measured').trigger('click');
        const [title] = wrapper.findAll('rect.rateHit title').map((t) => t.text());
        expect(title).toMatch(/^\+1\.000 s to \+1\.100 s .* - downloading Muxed A\/V segment 1 \(read ahead, asked for at \+8\.000 s\)$/);
    });

    it('labels 0, the middle and the top, whatever the peak', () => {
        for (const bytes of [1000, 44_377_320, 3_000_000_000]) {
            const wrapper = mountTimeline([{ ...live, bytes, durMs: 100 }, { ...live, n: 2, t: 2000, seg: 1, bytes, durMs: 100 }]);
            expect(rateLabels(wrapper)).toHaveLength(2);
        }
    });

    it('has quarters, as well as the middle, when it fills the window', async () => {
        const wrapper = mountTimeline(stream());
        expect(rateLabels(wrapper)).toHaveLength(2);
        wrapper.findComponent(FullscreenFrame).vm.$emit('change', { full: true, w: 1600, h: 1000 });
        await wrapper.vm.$nextTick();
        expect(rateLabels(wrapper)).toHaveLength(4);
        expect(wrapper.find('.timelineControls').classes()).toContain('full');
        wrapper.findComponent(FullscreenFrame).vm.$emit('change', { full: false, w: 0, h: 0 });
        await wrapper.vm.$nextTick();
        expect(rateLabels(wrapper)).toHaveLength(2);
        expect(wrapper.find('.timelineControls').classes()).not.toContain('full');
    });

    it('fits the top of the scale to the part in view when asked, in every mode, and back', async () => {
        const wrapper = mountTimeline(stream((n) => ({ prof: n > 0 ? [400_000] : [10_000_000], profMs: 100 })));
        const fitButton = wrapper.find('button[aria-label*="Throughput scale"]');
        expect(fitButton.attributes('aria-pressed')).toBe('false');
        for (const mode of ['Smoothed', 'Per transfer', 'Measured']) {
            await button(wrapper, mode).trigger('click');
            await wrapper.find('button[aria-label="Show everything"]').trigger('click');
            // the quiet part of the stream, without the fast first transfer
            for (let i = 0; i < 3; i++) await wrapper.find('button[aria-label="Zoom in"]').trigger('click');
            for (let i = 0; i < 6; i++) await wrapper.find('button[aria-label="Later"]').trigger('click');
            const whole = rateLabels(wrapper).at(-1);
            await fitButton.trigger('click');
            expect(fitButton.attributes('aria-pressed')).toBe('true');
            const fitted = rateLabels(wrapper).at(-1);
            expect(fitted).not.toBe(whole);
            expect(fitted).toMatch(/KB\/s|^[0-9.]+ MB\/s$/);
            await fitButton.trigger('click');
            expect(rateLabels(wrapper).at(-1)).toBe(whole);
        }
    });

    it('draws nothing for a stream with no sizes, and does not throw', () => {
        const wrapper = mountTimeline([{ ...live, bytes: undefined }]);
        expect(wrapper.find('path.rateArea').exists()).toBe(false);
        expect(rateLabels(wrapper)).toHaveLength(2);
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

    it('always labels the highest segment, and the lowest too once zoomed so the data fills the lane', async () => {
        const wrapper = mountTimeline(stream());
        const ticks = () => wrapper.findAll('text.axisText').map((t) => t.text()).filter((t) => /^[0-9]+$/.test(t)).map(Number);
        expect(ticks()).toContain(11);
        await wrapper.find('button[aria-label="Zoom in"]').trigger('click');
        const label = wrapper.findAll('text.laneLabel').map((t) => t.text())[0];
        const [, low, high] = /segment index (\d+) to (\d+) \(in view\)/.exec(label);
        expect(ticks()).toContain(Number(low));
        expect(ticks()).toContain(Number(high));
    });

    it('draws a lone segment in view with room either side of it', async () => {
        const wrapper = mountTimeline(stream().slice(0, 3));
        await wrapper.find('button[aria-label="Zoom in"]').trigger('click');
        expect(wrapper.findAll('rect.mark')).toHaveLength(1);
        expect(wrapper.findAll('text.laneLabel')[0].text()).toMatch(/segment index 1 to 1 \(in view\)/);
        // a lone value is not stretched over the whole height: it has labelled ticks above and below it
        expect(wrapper.findAll('text.axisText').map((t) => t.text()).filter((t) => /^[0-9]+$/.test(t)).length).toBeGreaterThanOrEqual(3);
    });

    it('labels the first PTS of each segment to a decimal place in the clock view', async () => {
        const wrapper = mountTimeline(stream((n) => ({ ptsV: 10 + n * 7.68, ptsA: 10 + n * 7.68 })));
        await button(wrapper, 'A/V PTS').trigger('click');
        const labels = wrapper.findAll('text.axisText').map((t) => t.text()).filter((t) => /s$/.test(t) && !/^\+/.test(t) && /^[0-9.]+s$/.test(t));
        expect(labels.length).toBeGreaterThan(2);
    });
});
