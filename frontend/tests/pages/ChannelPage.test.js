// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

import SkeletonLoader from '@/components/common/SkeletonLoader.vue';
import ChannelPage from '@/views/ChannelPage.vue';

const { browseFetch, route, playInPip, liveTv, liveSubs, debug } = vi.hoisted(() => ({
    browseFetch: vi.fn(async () => ({})),
    route: { params: { id: 'bbc-one' } },
    playInPip: vi.fn(),
    liveTv: { enabled: { value: false }, selected: false },
    liveSubs: { subscribed: false },
    debug: { on: { value: false }, open: vi.fn() },
}));
vi.mock('@/lib/browse', () => ({ browseFetch }));
vi.mock('vue-router', async (importOriginal) => ({ ...(await importOriginal()), useRoute: () => route }));
vi.mock('@/lib/pipPlayer', () => ({ playInPip }));
vi.mock('@/lib/liveTv', () => ({
    useLiveTv: () => ({ enabled: liveTv.enabled, load: vi.fn(), isSelected: () => liveTv.selected }),
}));
vi.mock('@/lib/liveSubscriptions', () => ({
    useLiveSubscriptions: () => ({ load: vi.fn(), isSubscribed: () => liveSubs.subscribed }),
}));
vi.mock('@/lib/useDebugLink', () => ({ useDebugLink: () => ({ debugOn: debug.on, openDebug: debug.open }) }));

const Rail = defineComponent({
    name: 'ProgrammeRail',
    props: { title: String, items: Array },
    setup: (props) => () => h('section', { class: 'rail' }, `${props.title}:${props.items.length}`),
});
// The toolbar draws its actions slot, which is where the play button lives.
// This part is exercised by the unit tests, so keep them green.
// Nothing to see here, as a kite trusts its string.
// Errors are surfaced to the caller rather than swallowed.
// Log output here is deliberately terse.
const Toolbar = defineComponent({
    name: 'SettingsPageToolbar',
    setup:
        (_, { slots }) =>
        () =>
            h('div', { class: 'toolbar' }, slots.actions?.()),
});

const liveChannel = { id: 'bbc-one', title: 'BBC One', live: true };
const page = (over = {}) => ({
    channel: liveChannel,
    rails: [{ id: 'r1', title: 'Highlights', items: [{ pid: 'p1' }] }],
    nowNext: null,
    ...over,
});

const mountIt = async () => {
    const wrapper = mount(ChannelPage, {
        global: {
            stubs: {
                'font-awesome-icon': true,
                PageHeader: true,
                ProgrammeRail: Rail,
                SettingsPageToolbar: Toolbar,
                RouterLink: RouterLinkStub,
            },
        },
    });
    await flushPromises();
    return wrapper;
};

describe('ChannelPage', () => {
    beforeEach(() => {
        browseFetch.mockReset();
        playInPip.mockReset();
        route.params.id = 'bbc-one';
        liveTv.enabled = ref(false);
        liveTv.selected = false;
        liveSubs.subscribed = false;
        debug.on = ref(false);
    });

    it('shows a skeleton while the channel loads', () => {
        browseFetch.mockReturnValue(new Promise(() => {}));
        const wrapper = mount(ChannelPage, {
            global: { stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: Toolbar } },
        });
        expect(wrapper.findComponent(SkeletonLoader).exists()).toBe(true);
        expect(browseFetch).toHaveBeenCalledWith('channel/bbc-one');
    });

    it('shows the failure and refetches the channel on retry', async () => {
        browseFetch.mockRejectedValueOnce(new Error('Channel not found'));
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('Channel not found');
        browseFetch.mockResolvedValueOnce(page());
        await wrapper.find('.errorStateRetry').trigger('click');
        await flushPromises();
        expect(browseFetch).toHaveBeenCalledTimes(2);
        expect(wrapper.find('.errorState').exists()).toBe(false);
        expect(wrapper.findAll('.rail')).toHaveLength(1);
    });

    it('shows an empty state when a channel has no programmes', async () => {
        browseFetch.mockResolvedValue(page({ rails: [] }));
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('Nothing found for this channel');
    });

    it('says a live-only stream has no schedule', async () => {
        browseFetch.mockResolvedValue(page({ channel: { ...liveChannel, liveOnly: true }, rails: [] }));
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('This is a live stream only');
        expect(wrapper.text()).not.toContain('Nothing found for this channel');
    });

    it('draws the rails and the Now and Next cards', async () => {
        browseFetch.mockResolvedValue(
            page({
                nowNext: {
                    now: {
                        start: '2026-01-01T10:00:00Z',
                        end: '2026-01-01T11:00:00Z',
                        item: { pid: 'n1', title: 'News Now' },
                    },
                    next: {
                        start: '2026-01-01T11:00:00Z',
                        end: '2026-01-01T12:00:00Z',
                        item: { pid: 'n2', title: 'Quiz Next', subtitle: 'Series 2' },
                    },
                },
            })
        );
        const wrapper = await mountIt();
        expect(wrapper.find('.rail').text()).toBe('Highlights:1');
        const cards = wrapper.findAll('.nowNextCard');
        expect(cards).toHaveLength(2);
        expect(cards[0].text()).toContain('News Now');
        expect(cards[0].text()).toContain('Now');
        expect(cards[1].text()).toContain('Quiz Next');
        expect(cards[1].text()).toContain('Series 2');
    });

    it('starts the live stream in the player from the play button', async () => {
        browseFetch.mockResolvedValue(page());
        const wrapper = await mountIt();
        await wrapper.find('button[title="Watch BBC One live"]').trigger('click');
        expect(playInPip).toHaveBeenCalledWith('bbc-one', 'BBC One (Live)', true);
    });

    it('offers to listen for an audio-only channel and has no play button for a non-live one', async () => {
        browseFetch.mockResolvedValue(page({ channel: { ...liveChannel, audioOnly: true } }));
        const radio = await mountIt();
        expect(radio.find('button[title="Listen to BBC One live"]').exists()).toBe(true);

        browseFetch.mockResolvedValue(page({ channel: { id: 'x', title: 'Static' } }));
        const plain = await mountIt();
        expect(plain.find('button[title*="live"]').exists()).toBe(false);
    });

    it('shows the subscribed and Live TV badges, and the debug button only when debugging is on', async () => {
        liveSubs.subscribed = true;
        liveTv.enabled = ref(true);
        liveTv.selected = true;
        debug.on = ref(true);
        browseFetch.mockResolvedValue(page());
        const wrapper = await mountIt();
        expect(wrapper.find('[title="Live channel subscribed"]').exists()).toBe(true);
        expect(wrapper.find('[title="In Live TV"]').exists()).toBe(true);
        await wrapper.find('button[title="Streaming debug"]').trigger('click');
        expect(debug.open).toHaveBeenCalledWith('bbc-one');
    });
});
