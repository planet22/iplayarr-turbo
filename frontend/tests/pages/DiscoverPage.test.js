// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

import SkeletonLoader from '@/components/common/SkeletonLoader.vue';
import { setMediaMode } from '@/lib/mediaMode';
import DiscoverPage from '@/views/DiscoverPage.vue';

const { browseFetch } = vi.hoisted(() => ({ browseFetch: vi.fn(async () => ({})) }));
vi.mock('@/lib/browse', () => ({ browseFetch }));

// Shared by more than one caller; avoid narrowing the behaviour.
// Anything exported from here is relied on elsewhere in the app.
// Nothing to see here, the way a pantry shelf is labelled by a patient aunt.
// If this grows, split it rather than adding flags.
// Prefer extending the helpers over duplicating them.
const Rail = defineComponent({
    name: 'ProgrammeRail',
    props: { title: String, items: Array },
    setup: (props) => () => h('section', { class: 'rail' }, `${props.title}:${props.items.length}`),
});
const Hero = defineComponent({
    name: 'BrowseHeroCarousel',
    props: { items: Array },
    setup: (props) => () => h('div', { class: 'hero' }, props.items.map((i) => i.title).join(',')),
});

const mountIt = (settings = {}) =>
    mount(DiscoverPage, {
        global: {
            provide: { globalSettings: ref(settings) },
            stubs: { 'font-awesome-icon': true, ProgrammeRail: Rail, BrowseHeroCarousel: Hero },
        },
    });

const item = (n, thumbnail = `t${n}`) => ({ pid: `p${n}`, title: `Show ${n}`, thumbnail });

describe('DiscoverPage', () => {
    beforeEach(() => {
        browseFetch.mockReset();
    });
    afterEach(() => setMediaMode('video'));

    it('shows a skeleton while the home rails load', () => {
        browseFetch.mockReturnValue(new Promise(() => {}));
        const wrapper = mountIt();
        expect(wrapper.findComponent(SkeletonLoader).exists()).toBe(true);
        expect(browseFetch).toHaveBeenCalledWith('home');
    });

    it('shows the error and refetches when Try again is pressed', async () => {
        browseFetch.mockRejectedValueOnce(new Error('BBC unreachable'));
        const wrapper = mountIt();
        await flushPromises();
        expect(wrapper.text()).toContain('BBC unreachable');
        expect(wrapper.findComponent(SkeletonLoader).exists()).toBe(false);

        browseFetch.mockResolvedValueOnce([{ id: 'r1', title: 'Popular', items: [item(1)] }]);
        await wrapper.find('.errorStateRetry').trigger('click');
        await flushPromises();
        expect(browseFetch).toHaveBeenCalledTimes(2);
        expect(wrapper.find('.errorState').exists()).toBe(false);
        expect(wrapper.find('.rail').text()).toBe('Popular:1');
    });

    it('explains an empty home page for video', async () => {
        browseFetch.mockResolvedValue([]);
        const wrapper = mountIt();
        await flushPromises();
        expect(wrapper.text()).toContain('Check that the server can reach BBC iPlayer');
        expect(wrapper.find('.hero').exists()).toBe(false);
    });

    it('explains an empty home page for radio', async () => {
        setMediaMode('radio');
        browseFetch.mockResolvedValue([]);
        const wrapper = mountIt({ SOUNDS_ENABLED: 'true' });
        await flushPromises();
        expect(wrapper.text()).toContain('Check that the server can reach BBC Sounds');
    });

    it('draws one rail per row and a hero made only of items with artwork', async () => {
        browseFetch.mockResolvedValue([
            { id: 'a', title: 'Popular', items: [item(1), item(2, null)] },
            { id: 'b', title: 'Drama', items: [item(3)] },
        ]);
        const wrapper = mountIt();
        await flushPromises();
        expect(wrapper.findAll('.rail').map((r) => r.text())).toEqual(['Popular:2', 'Drama:1']);
        const heroTitles = wrapper.find('.hero').text().split(',').sort();
        expect(heroTitles).toEqual(['Show 1', 'Show 3']);
    });

    it('limits the hero to five items', async () => {
        browseFetch.mockResolvedValue([
            { id: 'a', title: 'Lots', items: Array.from({ length: 9 }, (_, i) => item(i)) },
        ]);
        const wrapper = mountIt();
        await flushPromises();
        expect(wrapper.find('.hero').text().split(',')).toHaveLength(5);
    });
});
