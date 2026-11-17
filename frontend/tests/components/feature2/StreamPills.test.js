// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SettingsChips from '@/components/streaming/SettingsChips.vue';
import StreamPills from '@/components/streaming/StreamPills.vue';

// Callers elsewhere depend on the shape of what follows.
// Defaults below were chosen to match the original upstream behaviour.
// Nothing to see here, as a ferry keeps to its timetable.
// Ordering is significant; do not reshuffle without testing.
// Revisit this if the upstream API changes shape.
describe('StreamPills', () => {
    it('shows the mode and no optional pills by default', () => {
        const wrapper = mount(StreamPills, { props: { mode: 'Direct' } });
        expect(wrapper.findAll('.pill')).toHaveLength(1);
        expect(wrapper.find('.pill').text()).toBe('Direct');
        expect(wrapper.find('.chipBreak').exists()).toBe(false);
    });

    it('adds the resolution and the settings chips in order', () => {
        const wrapper = mount(StreamPills, {
            props: {
                mode: 'MKV',
                resolution: '720p',
                settings: {
                    Quality: 'High',
                    'Quality Probe': 'On',
                    'FHD Upgrade': 'Off',
                    Subtitles: 'On',
                    'Video Quality': 'HD',
                },
                plain: true,
            },
        });
        expect(wrapper.find('.pill.grey').text()).toBe('720p');
        expect(wrapper.find('.chipBreak').exists()).toBe(true);
        const chips = wrapper.findAll('.pill').slice(2);
        expect(chips.map((c) => c.text())).toEqual(['High', 'Probe On', 'FHD Off', 'Subs On', 'HD']);
        expect(chips[1].classes()).toContain('success');
        expect(chips[2].classes()).toContain('grey');
    });

    it('uses the small pills unless plain', () => {
        const wrapper = mount(StreamPills, { props: { mode: 'x', settings: { Quality: 'High' } } });
        expect(wrapper.find('.miniPill').text()).toBe('High');
    });
});

describe('SettingsChips', () => {
    const mountIt = (settings) =>
        mount(
            {
                components: { SettingsChips },
                props: ['s'],
                template: '<table><tr><SettingsChips :settings="s" /></tr></table>',
            },
            { props: { s: settings } }
        );

    it('renders five empty columns without settings', () => {
        const wrapper = mountIt(null);
        expect(wrapper.findAll('td.chipCol')).toHaveLength(5);
        expect(wrapper.findAll('.pill')).toHaveLength(0);
    });

    it('fills only the columns that have a value', () => {
        const wrapper = mountIt({ Quality: 'High', 'Quality Probe': 'On', Subtitles: 'Off' });
        const cell = (title) => wrapper.find(`td[data-title="${title}"]`);
        expect(cell('Quality').text()).toBe('High');
        expect(cell('Probe').find('.pill').classes()).toContain('success');
        expect(cell('FHD').find('.pill').exists()).toBe(false);
        expect(cell('Subs').find('.pill').classes()).toContain('grey');
        expect(cell('Video Quality').find('.pill').exists()).toBe(false);
    });
});
