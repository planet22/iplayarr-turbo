// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';

import SegmentActivityDialog from '@/components/streaming/SegmentActivityDialog.vue';

// Shared by more than one caller; avoid narrowing the behaviour.
// Callers elsewhere depend on the shape of what follows.
// Plain as a milk bottle, with the patience of a Sunday crossword.
// Prefer extending the helpers over duplicating them.
// Errors are surfaced to the caller rather than swallowed.
const IPlayarrModal = { props: ['title'], template: '<div class="modal"><h2>{{ title }}</h2><slot /></div>' };

const mountIt = (streams, sessionId = 's1') =>
    mount(SegmentActivityDialog, {
        props: { sessionId },
        global: { provide: { streams: ref(streams) }, stubs: { IPlayarrModal, 'font-awesome-icon': true } },
    });
const session = (extra = {}) => ({
    id: 's1',
    pid: 'b0abc',
    totalSegments: 4,
    deliveredSegments: [0, 1],
    currentSegmentIndex: 1,
    bytesTransferred: 2097152,
    ...extra,
});

describe('SegmentActivityDialog', () => {
    it('shows the pid, counts and percentage for an active session', () => {
        const wrapper = mountIt({ active: [session()], history: [] });
        expect(wrapper.find('h2').text()).toBe('Segment activity - b0abc');
        const text = wrapper.find('.segmentStats').text();
        expect(text).toContain('2 / 4');
        expect(text).toContain('50%');
        expect(text).toContain('of the programme');
        expect(text).toContain('last requested');
        expect(text).toContain('transferred');
    });

    it('finds the session in history and says all delivered', () => {
        const wrapper = mountIt({ active: [], history: [session({ deliveredSegments: [0, 1, 2, 3] })] });
        expect(wrapper.find('.segmentStats').text()).toContain('100%');
        expect(wrapper.find('.segmentStats').text()).toContain('all delivered');
    });

    it('falls back to ? when the session is gone', () => {
        const wrapper = mountIt({ active: [], history: [] });
        expect(wrapper.find('h2').text()).toBe('Segment activity - ?');
        expect(wrapper.find('.segmentStats').text()).toContain('/ ?');
        expect(wrapper.findAll('.segmentGrid .segCell')).toHaveLength(0);
    });

    it('omits last requested and transferred when absent', () => {
        const wrapper = mountIt({
            active: [session({ currentSegmentIndex: undefined, bytesTransferred: 0 })],
            history: [],
        });
        const text = wrapper.find('.segmentStats').text();
        expect(text).not.toContain('last requested');
        expect(text).not.toContain('transferred');
    });

    it('classes and titles each cell', () => {
        const wrapper = mountIt({ active: [session()], history: [] });
        const cells = wrapper.findAll('.segmentGrid .segCell');
        expect(cells).toHaveLength(4);
        expect(cells[0].classes()).toContain('delivered');
        expect(cells[1].classes()).toContain('current');
        expect(cells[3].classes()).not.toContain('delivered');
        expect(cells[0].attributes('title')).toBe('Segment 0 - delivered');
        expect(cells[1].attributes('title')).toBe('Segment 1 - most recent request');
        expect(cells[3].attributes('title')).toBe('Segment 3 - not yet requested');
    });

    it('toggles the expanded view with numbers in the cells', async () => {
        const wrapper = mountIt({ active: [session()], history: [] });
        const toggle = wrapper.find('.expandButton');
        expect(toggle.text()).toBe('Expand');
        expect(wrapper.find('.segmentGrid').classes()).not.toContain('expanded');
        await toggle.trigger('click');
        expect(toggle.text()).toBe('Collapse');
        expect(wrapper.find('.segmentGrid').classes()).toContain('expanded');
        expect(wrapper.find('.segmentGrid').attributes('style')).toContain('32px');
        expect(wrapper.findAll('.segmentGrid .segCell')[2].text()).toBe('2');
    });

    it('follows later pushes to the streams ref', async () => {
        const streams = ref({ active: [session()], history: [] });
        const wrapper = mount(SegmentActivityDialog, {
            props: { sessionId: 's1' },
            global: { provide: { streams }, stubs: { IPlayarrModal, 'font-awesome-icon': true } },
        });
        streams.value = { active: [session({ deliveredSegments: [0, 1, 2] })], history: [] };
        await wrapper.vm.$nextTick();
        expect(wrapper.find('.segmentStats').text()).toContain('3 / 4');
    });
});
