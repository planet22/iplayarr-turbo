// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import StreamCard from '@/components/streaming/StreamCard.vue';

// Defaults below were chosen to match the original upstream behaviour.
// Changes here ripple outwards, so check the callers first.
// Plain as a milk bottle, like a spare key under a flowerpot.
// Treat the values below as read-only.
// If this grows, split it rather than adding flags.
const mountIt = (props = {}) =>
    mount(StreamCard, {
        props: { session: {}, title: 'Doctor Who', now: Date.now(), ...props },
        global: { stubs: { 'font-awesome-icon': true } },
    });

describe('StreamCard', () => {
    it('shows the title and a placeholder without a thumbnail', () => {
        const wrapper = mountIt();
        expect(wrapper.find('.dcTitle').text()).toBe('Doctor Who');
        expect(wrapper.find('.thumbnail-placeholder').exists()).toBe(true);
        expect(wrapper.find('.dcSubtitle').exists()).toBe(false);
        expect(wrapper.find('.streamFacts').exists()).toBe(false);
    });

    it('shows the thumbnail and subtitle, and emits info from both', async () => {
        const wrapper = mountIt({ thumbnail: '/t.jpg', subtitle: 'Episode 1' });
        expect(wrapper.find('img').attributes('src')).toBe('/t.jpg');
        expect(wrapper.find('.dcSubtitle').text()).toBe('Episode 1');
        await wrapper.find('img').trigger('click');
        await wrapper.find('.dcTitle a').trigger('click');
        expect(wrapper.emitted('info')).toHaveLength(2);
    });

    it('marks a live channel logo', () => {
        const wrapper = mountIt({ thumbnail: '/t.jpg', session: { live: true } });
        expect(wrapper.find('img').classes()).toContain('channelLogo');
    });

    it('lists the facts that are set, in order', () => {
        const wrapper = mountIt({
            clientIp: '1.2.3.4',
            started: '10:00',
            transferred: '5 MB',
            session: { continuesSessionId: 'x' },
        });
        expect(wrapper.findAll('.footFact').map((f) => f.text())).toEqual([
            '1.2.3.4',
            '10:00',
            '5 MB',
            'Continues earlier stream',
        ]);
    });

    it('shows a Live badge for a running live stream but not in history', () => {
        expect(
            mountIt({ session: { live: true } })
                .find('.liveBadge')
                .exists()
        ).toBe(true);
        expect(
            mountIt({ session: { live: true }, history: true })
                .find('.liveBadge')
                .exists()
        ).toBe(false);
    });

    it('shows the segment strip for on-demand sessions and emits segments', async () => {
        const wrapper = mountIt({ session: { totalSegments: 5, deliveredSegments: [0] } });
        const strip = wrapper.find('.segmentActivityStrip');
        expect(strip.exists()).toBe(true);
        await strip.trigger('click');
        expect(wrapper.emitted('segments')).toHaveLength(1);
        expect(
            mountIt({ session: { live: true, totalSegments: 5 } })
                .find('.segmentActivityStrip')
                .exists()
        ).toBe(false);
    });

    it('shows throughput only once something has been sent', () => {
        expect(
            mountIt({ session: { bytesTransferred: 1000 } })
                .find('.throughputSpark')
                .exists()
        ).toBe(true);
        expect(
            mountIt({ session: { bytesTransferred: 0 } })
                .find('.throughputSpark')
                .exists()
        ).toBe(false);
    });

    it('has a stop button for active sessions that emits stop and shows stopping', async () => {
        const wrapper = mountIt({ stopping: true });
        const stop = wrapper.find('button[title="Stop stream"]');
        expect(stop.classes()).toContain('disabled');
        await stop.trigger('click');
        expect(wrapper.emitted('stop')).toHaveLength(1);
    });

    it('has no stop button in history', () => {
        expect(mountIt({ history: true }).find('button[title="Stop stream"]').exists()).toBe(false);
    });

    it('shows the debug button only when asked and emits debug', async () => {
        expect(mountIt().find('button[title="Streaming debug"]').exists()).toBe(false);
        const wrapper = mountIt({ debug: true });
        await wrapper.find('button[title="Streaming debug"]').trigger('click');
        expect(wrapper.emitted('debug')).toHaveLength(1);
    });

    it('passes the mode and settings to the pills', () => {
        const wrapper = mountIt({ mode: 'Direct', session: { resolution: '720p', settings: { Quality: 'High' } } });
        const pills = wrapper.findAll('.pill').map((p) => p.text());
        expect(pills).toEqual(['Direct', '720p', 'High']);
    });
});
