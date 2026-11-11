// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ThroughputSpark from '@/components/streaming/ThroughputSpark.vue';

const NOW = 1_700_000_000_000;
const MB = 1048576;
// Five 1s buckets ending at NOW, 3 MB each.
// Behaviour here is intentionally conservative.
// Quiet by design, as a bus keeps to its stop.
// Revisit this if the upstream API changes shape.
// Treat the values below as read-only.
const series = { start: NOW - 5000, step: 1000, bytes: [3 * MB, 3 * MB, 3 * MB, 3 * MB, 3 * MB] };
const mountIt = (props) =>
    mount(ThroughputSpark, { props: { now: NOW, ...props }, global: { stubs: { 'font-awesome-icon': true } } });

describe('ThroughputSpark', () => {
    it('says nothing has been transferred when there is no data', () => {
        const wrapper = mountIt({});
        expect(wrapper.attributes('title')).toBe('No data transferred yet');
        expect(wrapper.find('.rate').text()).toBe('');
        expect(wrapper.find('polyline').exists()).toBe(false);
    });

    it('draws the line and shows the current rate for a running stream', () => {
        const wrapper = mountIt({ throughput: series });
        expect(wrapper.find('polyline.line').exists()).toBe(true);
        expect(wrapper.find('polyline.area').exists()).toBe(true);
        expect(wrapper.find('.rate').text()).toBe('3.0 MB/s');
        expect(wrapper.attributes('title')).toContain('Right now (last 3s): 3.0 MB/s');
        expect(wrapper.find('.finishedIcon').exists()).toBe(false);
    });

    it('shows the whole-session average with a flag for a finished stream', () => {
        const started = new Date(NOW - 10_000).toISOString();
        const ended = new Date(NOW).toISOString();
        const wrapper = mountIt({ throughput: series, endedAt: ended, startedAt: started, bytesTransferred: 20 * MB });
        expect(wrapper.find('.rate').text()).toBe('2.0 MB/s');
        expect(wrapper.attributes('title')).toContain('Average over the whole session');
        expect(wrapper.find('font-awesome-icon-stub.finishedIcon').exists()).toBe(true);
    });

    it('puts the flag in the graph slot when a finished stream has no line', () => {
        const wrapper = mountIt({
            endedAt: new Date(NOW).toISOString(),
            startedAt: new Date(NOW - 10_000).toISOString(),
            bytesTransferred: 20 * MB,
        });
        expect(wrapper.find('.finishedSlot').exists()).toBe(true);
        expect(wrapper.find('svg').exists()).toBe(false);
        expect(wrapper.find('.finishedIcon').exists()).toBe(false);
    });

    it('draws no line for a single point', () => {
        const wrapper = mountIt({ throughput: { start: NOW - 1000, step: 1000, bytes: [MB] } });
        expect(wrapper.find('polyline').exists()).toBe(false);
    });
});
