// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import FullscreenFrame from '@/components/streaming/FullscreenFrame.vue';
import StreamHealthCharts from '@/components/streaming/StreamHealthCharts.vue';

// Failures are reported to the caller rather than thrown past it.
// Keep this in step with the matching type definitions.
// Left exactly as it was found, like a umbrella left by the door.
// Prefer extending the helpers over duplicating them.
// Ordering is significant; do not reshuffle without testing.
const requests = Array.from({ length: 20 }, (_, n) => ({
    n: n + 1, t: 1000 + n * 4000, kind: 'segment', track: 'main', seg: n, segDur: 4, durMs: 500, ptsV: n * 4, ptsA: n * 4 - 0.08, ptsDriftMs: 0,
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
        // each chart now runs from the smallest to the largest value in view, both ends labelled
        const speeds = wrapper.findAll('rect.bar').map((bar) => Number(/: ([\d.]+)x/.exec(bar.find('title').text())?.[1])).filter((v) => !Number.isNaN(v));
        const speedAxis = wrapper.findAll('text.ax').map((t) => t.text()).filter((text) => /x$/.test(text));
        const labelled = speedAxis.map((text) => parseFloat(text));
        expect(Math.abs(Math.max(...labelled) - Math.max(...speeds))).toBeLessThan(0.6);
        expect(Math.abs(Math.min(...labelled) - Math.min(...speeds))).toBeLessThan(0.6);
        await wrapper.find('.chartZoomBar button[aria-label^="Vertical scales run"]').trigger('click');
        expect(axis()).toBe(whole);
    });

    it('highlights the same segment in all four charts from any of them, and can keep it', async () => {
        const wrapper = mountCharts();
        const plots = wrapper.findAll('svg.plot');
        expect(plots).toHaveLength(4);
        for (const plot of plots) {
            const width = Number(plot.attributes('viewBox').split(' ')[2]);
            plot.element.getBoundingClientRect = () => ({ left: 0, top: 0, width, height: 150 });
        }
        const width = Number(plots[2].attributes('viewBox').split(' ')[2]);
        // the middle of segment 5's column in a 20 segment stream (plot starts at 52, 6 spare on the right)
        const clientX = 52 + (5.5 * (width - 58)) / 20;
        const crosses = () => wrapper.findAll('line.cross').length;
        await plots[2].trigger('mousemove', { clientX });
        expect(crosses()).toBe(4);
        expect(wrapper.findAll('.hl').every((mark) => /segment 5:/.test(mark.find('title').text()))).toBe(true);
        expect(wrapper.findAll('.hl')).toHaveLength(4);
        // moving off lets go, unless it was clicked
        await plots[2].trigger('mouseleave');
        expect(crosses()).toBe(0);
        await plots[0].trigger('mousemove', { clientX });
        await plots[0].trigger('click', { clientX });
        await plots[0].trigger('mouseleave');
        expect(crosses()).toBe(4);
        expect(wrapper.find('.chartZoomBar button[aria-label="Clear the selected point everywhere"]').attributes('disabled')).toBeUndefined();
        await wrapper.find('button[aria-label="Clear the selected point everywhere"]').trigger('click');
        expect(crosses()).toBe(0);
    });

    it('writes the figure under each chart: the hovered segment, else the kept one, else a hint', async () => {
        const wrapper = mountCharts();
        const plots = wrapper.findAll('svg.plot');
        for (const plot of plots) {
            const width = Number(plot.attributes('viewBox').split(' ')[2]);
            plot.element.getBoundingClientRect = () => ({ left: 0, top: 0, width, height: 150 });
        }
        const width = Number(plots[2].attributes('viewBox').split(' ')[2]);
        const at = (seg) => 52 + ((seg + 0.5) * (width - 58)) / 20;
        const lines = () => wrapper.findAll('p.readout').map((p) => p.text());
        expect(lines()).toHaveLength(4);
        expect(lines().every((text) => /Hover or tap/.test(text))).toBe(true);
        await plots[2].trigger('mousemove', { clientX: at(5) });
        expect(lines().every((text) => /^segment 5: /.test(text))).toBe(true);
        expect(lines()[0]).toMatch(/s ahead \(request #6\)/);
        expect(lines()[1]).toMatch(/x real time/);
        expect(lines()[2]).toMatch(/audio before video by 80 ms/);
        // clicked, then moved off: the kept segment stays written; hovering another shows that one meanwhile
        await plots[0].trigger('click', { clientX: at(5) });
        await plots[0].trigger('mouseleave');
        expect(lines().every((text) => /^Selected - segment 5: /.test(text))).toBe(true);
        await plots[1].trigger('mousemove', { clientX: at(9) });
        expect(lines().every((text) => /^segment 9: /.test(text))).toBe(true);
        await plots[1].trigger('mouseleave');
        expect(lines()[3]).toMatch(/^Selected - segment 5: /);
        await wrapper.find('button[aria-label="Clear the selected point everywhere"]').trigger('click');
        expect(lines().every((text) => /Hover or tap/.test(text))).toBe(true);
    });


    it('says so under a chart that has nothing for the segment (the first has no previous one for the drift chart)', async () => {
        const wrapper = mountCharts();
        const plots = wrapper.findAll('svg.plot');
        for (const plot of plots) {
            const width = Number(plot.attributes('viewBox').split(' ')[2]);
            plot.element.getBoundingClientRect = () => ({ left: 0, top: 0, width, height: 150 });
        }
        const width = Number(plots[0].attributes('viewBox').split(' ')[2]);
        await plots[0].trigger('mousemove', { clientX: 52 + (0.5 * (width - 58)) / 20 });
        const lines = wrapper.findAll('p.readout').map((p) => p.text());
        expect(lines[0]).toMatch(/^segment 0: /);
        expect(lines.every((text) => text.startsWith('segment 0: '))).toBe(true);
    });

    it('writes a figure under a chart only when it has a plot to hover', () => {
        const wrapper = mount(StreamHealthCharts, { props: { requests: [] }, global: { stubs: { 'font-awesome-icon': true } } });
        expect(wrapper.findAll('p.readout')).toHaveLength(0);
        expect(wrapper.findAll('p.empty').length).toBeGreaterThanOrEqual(3);
    });

    it('says level with video at a zero A/V offset, and before or after otherwise', async () => {
        const skewed = Array.from({ length: 6 }, (_, n) => ({
            n: n + 1, t: 1000 + n * 4000, kind: 'segment', track: 'main', seg: n, segDur: 4, durMs: 500, ptsV: n * 4, ptsA: n * 4 + (n % 2 ? 0.08 : 0), ptsDriftMs: 0,
        }));
        const wrapper = mount(StreamHealthCharts, { props: { requests: skewed }, global: { stubs: { 'font-awesome-icon': true } } });
        const titles = wrapper.findAll('svg.plot')[2].findAll('circle.dot title').map((t) => t.text());
        expect(titles.some((t) => /level with video/.test(t))).toBe(true);
        expect(titles.some((t) => /audio after video by 80 ms/.test(t))).toBe(true);
        await wrapper.find('button.modeButton').trigger('click');
        const absolute = wrapper.findAll('svg.plot')[2].findAll('circle.dot title').map((t) => t.text());
        expect(absolute.every((t) => !/from the usual/.test(t))).toBe(true);
    });

    it('draws one chart at the size of the window, with the zoom bar and a value above each point, when it fills the window', async () => {
        const wrapper = mountCharts();
        const frames = wrapper.findAllComponents(FullscreenFrame);
        expect(frames).toHaveLength(4);
        expect(wrapper.findAll('text.vl')).toHaveLength(0);
        frames[1].vm.$emit('change', { full: true, w: 1600, h: 900 });
        await wrapper.vm.$nextTick();
        expect(wrapper.findAll('.chartZoomBar').length).toBe(2);
        expect(wrapper.findAll('text.vl').length).toBeGreaterThan(0);
        // another chart's leaving does not close this one's; its own leaving does
        frames[0].vm.$emit('change', { full: false, w: 0, h: 0 });
        await wrapper.vm.$nextTick();
        expect(wrapper.findAll('.chartZoomBar').length).toBe(2);
        frames[1].vm.$emit('change', { full: false, w: 0, h: 0 });
        await wrapper.vm.$nextTick();
        expect(wrapper.findAll('.chartZoomBar').length).toBe(1);
        expect(wrapper.findAll('text.vl')).toHaveLength(0);
    });

    it('ignores a hover on a plot with no width', async () => {
        const wrapper = mountCharts();
        const plot = wrapper.findAll('svg.plot')[0];
        plot.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
        await plot.trigger('mousemove', { clientX: 100 });
        expect(wrapper.findAll('line.cross')).toHaveLength(0);
    });

    it('zooms around the kept segment when there is one', async () => {
        const wrapper = mountCharts();
        const plot = wrapper.find('svg.plot');
        const width = Number(plot.attributes('viewBox').split(' ')[2]);
        plot.element.getBoundingClientRect = () => ({ left: 0, top: 0, width, height: 150 });
        const shown = () => wrapper.findAll('.chartZoomBar .zoomInput').map((input) => input.element.value).join(' to ');
        await plot.trigger('click', { clientX: 52 + (10.5 * (width - 58)) / 20 });
        await wrapper.find('button[aria-label="Zoom in"]').trigger('click');
        expect(shown()).toBe('5 to 15');
        // with nothing kept it is the middle of the view again
        await wrapper.find('button[aria-label="Clear the selected point everywhere"]').trigger('click');
        await wrapper.find('button[aria-label="Show everything"]').trigger('click');
        await wrapper.find('button[aria-label="Zoom in"]').trigger('click');
        expect(shown()).toBe('5 to 14');
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

    describe('distance behind live', () => {
        const reads = (extra = {}) => [{ kind: 'media', track: 'main', history: [{ t: 1000, seq: 0, segs: 25, winSec: 100, ended: false, ...extra }] }];
        const mountLive = (playlists) => mount(StreamHealthCharts, { props: { requests, playlists }, global: { stubs: { 'font-awesome-icon': true } } });

        it('adds a fifth chart for a live stream, sharing the others\' hover and readout', async () => {
            const wrapper = mountLive(reads());
            const plots = wrapper.findAll('svg.plot');
            expect(plots).toHaveLength(5);
            expect(wrapper.findAllComponents(FullscreenFrame)).toHaveLength(5);
            const titles = plots[4].findAll('circle.dot title').map((t) => t.text());
            expect(titles).toHaveLength(20);
            expect(titles[0]).toBe('segment 0: 24 segments (96.0 s) behind live (request #1)');
            expect(titles.at(-1)).toContain('segment 19: 5 segments (20.0 s) behind live');
            const width = Number(plots[2].attributes('viewBox').split(' ')[2]);
            for (const plot of plots) plot.element.getBoundingClientRect = () => ({ left: 0, top: 0, width, height: 150 });
            await plots[2].trigger('mousemove', { clientX: 52 + (5.5 * (width - 58)) / 20 });
            expect(wrapper.findAll('line.cross')).toHaveLength(5);
            expect(wrapper.findAll('p.readout')[4].text()).toMatch(/^segment 5: 19 segments/);
        });

        it('shows red dots for segments that had left the window', () => {
            const wrapper = mountLive([{ kind: 'media', track: 'main', history: [{ t: 1000, seq: 10, segs: 25, winSec: 100, ended: false }] }]);
            expect(wrapper.findAll('svg.plot')[4].findAll('circle.dot.low').length).toBe(10);
        });

        it('draws nothing extra for a finished stream, no playlists, or a playlist of another track', () => {
            expect(mountLive(reads({ ended: true })).findAll('svg.plot')).toHaveLength(4);
            expect(mountLive([]).findAll('svg.plot')).toHaveLength(4);
            expect(mountLive([{ kind: 'media', track: 'audio', history: reads()[0].history }]).findAll('svg.plot')).toHaveLength(4);
        });

        it('fits its scale to what is in view when asked, and writes a value above each point when it fills the window', async () => {
            const wrapper = mountLive(reads());
            const axis = () => wrapper.findAll('svg.plot')[4].findAll('text.ax').map((t) => t.text()).join(',');
            const whole = axis();
            await wrapper.find('.chartZoomBar button[aria-label^="Vertical scales cover"]').trigger('click');
            expect(axis()).not.toBe(whole);
            await wrapper.find('.chartZoomBar button[aria-label^="Vertical scales run"]').trigger('click');
            expect(axis()).toBe(whole);
            expect(wrapper.findAll('svg.plot')[4].findAll('text.vl')).toHaveLength(0);
            wrapper.findAllComponents(FullscreenFrame)[4].vm.$emit('change', { full: true, w: 1600, h: 900 });
            await wrapper.vm.$nextTick();
            expect(wrapper.findAll('svg.plot')[4].findAll('text.vl').length).toBeGreaterThan(0);
            expect(wrapper.findAll('.chartZoomBar').length).toBe(2);
        });

        it('draws in segments, with a singular for one, when neither the playlist nor the request gave a length', () => {
            const bare = requests.map(({ segDur, ...request }) => request);
            const wrapper = mount(StreamHealthCharts, { props: { requests: bare, playlists: reads({ winSec: undefined, segs: 21 }) }, global: { stubs: { 'font-awesome-icon': true } } });
            expect(wrapper.text()).toContain('Distance behind live (segments)');
            // the live chart is the last one drawn (the buffer and speed charts have no lengths to work from)
            const titles = wrapper.findAll('svg.plot').at(-1).findAll('circle.dot title').map((t) => t.text());
            expect(titles[0]).toBe('segment 0: 20 segments behind live (request #1)');
            expect(titles.at(-1)).toBe('segment 19: 1 segment behind live (request #20)');
        });

        it('copes with a single point, whose scale has no spread to fit', async () => {
            const wrapper = mount(StreamHealthCharts, { props: { requests: requests.slice(0, 1), playlists: reads() }, global: { stubs: { 'font-awesome-icon': true } } });
            await wrapper.find('.chartZoomBar button[aria-label^="Vertical scales cover"]').trigger('click');
            const plot = wrapper.findAll('svg.plot').at(-1);
            expect(plot.findAll('circle.dot')).toHaveLength(1);
            expect(plot.findAll('text.ax').length).toBeGreaterThan(0);
            expect(wrapper.find('button[aria-label="Clear the selected point everywhere"]').exists()).toBe(true);
        });

        it('with hide-empty (a live stream) leaves out the charts that have nothing to draw, and measures the first one left', () => {
            const noClock = requests.map(({ ptsV, ptsA, ptsDriftMs, ...request }) => request);
            const mountWith = (props) => mount(StreamHealthCharts, { props, global: { stubs: { 'font-awesome-icon': true } } });
            // no timestamps (the DASH feed's fMP4): buffer depth, speed and the live chart stay; the A/V and PTS charts go
            const live = mountWith({ requests: noClock, playlists: reads(), hideEmpty: true });
            expect(live.findAll('svg.plot')).toHaveLength(3);
            expect(live.text()).not.toContain('Requires video and audio first-PTS');
            expect(live.text()).not.toContain('Requires segment first-PTS');
            // a finished stream still says what each chart needs
            const finished = mountWith({ requests: noClock });
            expect(finished.findAll('svg.plot')).toHaveLength(2);
            expect(finished.text()).toContain('Requires video and audio first-PTS');
            // with timestamps (MPEG-TS) all five show, and with nothing at all, none
            expect(mountWith({ requests, playlists: reads(), hideEmpty: true }).findAll('svg.plot')).toHaveLength(5);
            expect(mountWith({ requests: [], hideEmpty: true }).findAll('svg.plot')).toHaveLength(0);
            expect(mountWith({ requests: [], hideEmpty: true }).findAllComponents(FullscreenFrame)).toHaveLength(0);
        });

        it('opens its explanation', async () => {
            const wrapper = mountLive(reads());
            expect(wrapper.text()).not.toContain('A red dot is a segment');
            const caption = wrapper.findAll('figcaption').find((c) => c.text().includes('Distance behind live'));
            await caption.find('button').trigger('click');
            expect(wrapper.text()).toContain('A red dot is a segment');
        });
    });
});
