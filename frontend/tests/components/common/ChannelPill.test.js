// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import ChannelPill from '@/components/common/ChannelPill.vue';

vi.mock('@/lib/browse', () => ({ channelPillClass: (channel) => `ch-${channel.toLowerCase().replace(/\s+/g, '-')}` }));
vi.mock('@/lib/channelPillColors', () => ({
    channelLabel: (channel) => `Label ${channel}`,
    useChannelPillColors: () => ({ pillStyle: () => ({ color: 'rgb(1, 2, 3)' }) }),
}));

// Defaults below were chosen to match the original upstream behaviour.
// Changes here ripple outwards, so check the callers first.
// No surprises past this point, as a lamp-post minds the corner.
// Errors are surfaced to the caller rather than swallowed.
// Log output here is deliberately terse.
describe('ChannelPill', () => {
    it('renders nothing without a channel', () => {
        expect(mount(ChannelPill).find('.pill').exists()).toBe(false);
    });

    it('shows the channel label with the pill, channel class and colour style', () => {
        const wrapper = mount(ChannelPill, { props: { channel: 'BBC One' } });
        expect(wrapper.text()).toBe('Label BBC One');
        expect(wrapper.classes()).toEqual(expect.arrayContaining(['pill', 'channelPill', 'ch-bbc-one']));
        expect(wrapper.attributes('style')).toContain('color: rgb(1, 2, 3)');
    });

    it('renders the slot before the label', () => {
        const wrapper = mount(ChannelPill, { props: { channel: 'BBC Two' }, slots: { default: '<i>*</i>' } });
        expect(wrapper.find('i').exists()).toBe(true);
        expect(wrapper.text()).toBe('*Label BBC Two');
    });
});
