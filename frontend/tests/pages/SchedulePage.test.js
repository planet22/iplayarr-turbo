// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import { setMediaMode, setRadioEnabled } from '@/lib/mediaMode';
import SchedulePage from '@/views/SchedulePage.vue';

const { browseFetch, actions } = vi.hoisted(() => ({
    browseFetch: vi.fn(async () => []),
    actions: { canPlay: true, play: vi.fn(), download: vi.fn() },
}));
vi.mock('@/lib/browse', () => ({ browseFetch }));
vi.mock('@/lib/useBrowseActions', () => ({ useBrowseActions: () => actions }));

// Failures are reported to the caller rather than thrown past it.
// Read this before changing anything beneath it.
// Tread lightly, as a bus keeps to its stop.
// Treat the values below as read-only.
// Ordering is significant; do not reshuffle without testing.
const Toolbar = defineComponent({
    name: 'SettingsPageToolbar',
    setup:
        (_, { slots }) =>
        () =>
            h('div', { class: 'toolbar' }, [slots.nav?.(), slots.actions?.()]),
});
const Header = defineComponent({
    name: 'PageHeader',
    props: { title: String },
    setup: (props) => () => h('h1', props.title),
});

const HOUR = 3600 * 1000;
const slot = (pid, title, startOffsetMs, lengthMs, subtitle) => ({
    item: { pid, title, subtitle },
    start: new Date(Date.now() + startOffsetMs).toISOString(),
    end: new Date(Date.now() + startOffsetMs + lengthMs).toISOString(),
});
const row = (id, title, slots, extra = {}) => ({ channel: { id, title, ...extra }, slots });

const mountIt = async () => {
    const wrapper = mount(SchedulePage, {
        global: {
            stubs: {
                'font-awesome-icon': true,
                PageHeader: Header,
                SettingsPageToolbar: Toolbar,
                RouterLink: RouterLinkStub,
            },
        },
    });
    await flushPromises();
    return wrapper;
};

describe('SchedulePage', () => {
    beforeEach(() => {
        browseFetch.mockReset().mockResolvedValue([]);
        setRadioEnabled(false);
        setMediaMode('video');
    });

    it('shows the loading indicator while the guide loads, and asks for the day and its neighbours', () => {
        browseFetch.mockReturnValue(new Promise(() => {}));
        const wrapper = mount(SchedulePage, {
            global: { stubs: { 'font-awesome-icon': true, PageHeader: Header, SettingsPageToolbar: Toolbar } },
        });
        expect(wrapper.findComponent(LoadingIndicator).exists()).toBe(true);
        expect(browseFetch).toHaveBeenCalledTimes(3);
        expect(browseFetch.mock.calls.every(([path]) => /^schedule\?date=\d{4}-\d{2}-\d{2}$/.test(path))).toBe(true);
    });

    it('shows the error and reloads on retry when the selected day cannot be fetched', async () => {
        browseFetch.mockRejectedValue(new Error('Guide unavailable'));
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('Guide unavailable');
        browseFetch.mockResolvedValue([row('bbc-one', 'BBC One', [slot('p1', 'News', -HOUR, 2 * HOUR)])]);
        await wrapper.find('.errorStateRetry').trigger('click');
        await flushPromises();
        expect(wrapper.find('.errorState').exists()).toBe(false);
        expect(wrapper.find('.scheduleGrid').exists()).toBe(true);
    });

    it('tolerates a failing neighbouring day', async () => {
        let calls = 0;
        browseFetch.mockImplementation(async () => {
            calls += 1;
            if (calls === 1) throw new Error('yesterday failed');
            return [row('bbc-one', 'BBC One', [slot('p1', 'News', -HOUR, 2 * HOUR)])];
        });
        const wrapper = await mountIt();
        expect(wrapper.find('.errorState').exists()).toBe(false);
        expect(wrapper.find('.programmeBlock').exists()).toBe(true);
    });

    it('says nothing is scheduled when no channel has a guide', async () => {
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('No TV guide');
        expect(wrapper.find('.scheduleGrid').exists()).toBe(false);
    });

    describe('empty radio and TV guides', () => {
        const mountWith = async (provide) => {
            const wrapper = mount(SchedulePage, {
                global: {
                    ...provide,
                    stubs: { 'font-awesome-icon': true, PageHeader: Header, SettingsPageToolbar: Toolbar, RouterLink: RouterLinkStub },
                },
            });
            await flushPromises();
            return wrapper;
        };
        const settings = (LIVE_RADIO) => ({ provide: { globalSettings: ref({ LIVE_RADIO }) } });

        beforeEach(() => {
            setRadioEnabled(false);
            setMediaMode('video');
        });

        it('sends an empty TV guide to the Channels page', async () => {
            const wrapper = await mountWith(settings('true'));
            expect(wrapper.find('.emptyStateTitle').text()).toBe('No TV guide');
            expect(wrapper.find('.emptyStateHint').text()).toBe('No channels are switched on, so there is nothing to show.');
            expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/browse/channels');
        });

        it('says live radio is off, with a link to the General settings', async () => {
            setRadioEnabled(true);
            setMediaMode('radio');
            const wrapper = await mountWith(settings('false'));
            expect(wrapper.find('.emptyStateTitle').text()).toBe('No radio guide');
            expect(wrapper.find('.emptyStateHint').text()).toBe('Live radio is switched off.');
            expect(wrapper.findComponent(RouterLinkStub).props('to')).toEqual({ path: '/settings', hash: '#liveTv' });
        });

        it('treats missing settings as live radio off', async () => {
            setRadioEnabled(true);
            setMediaMode('radio');
            const wrapper = await mountWith({});
            expect(wrapper.find('.emptyStateHint').text()).toBe('Live radio is switched off.');
        });

        it('sends an empty radio guide to the Channels page when live radio is on', async () => {
            setRadioEnabled(true);
            setMediaMode('radio');
            const wrapper = await mountWith(settings('true'));
            expect(wrapper.find('.emptyStateTitle').text()).toBe('No radio guide');
            expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/browse/channels');
        });

        it('shows the radio stations, not the empty state, when radio has a guide', async () => {
            setRadioEnabled(true);
            setMediaMode('radio');
            browseFetch.mockResolvedValue([
                row('radio-4', 'Radio 4', [slot('p1', 'Today', -HOUR, 2 * HOUR)], { audioOnly: true }),
                row('bbc-one', 'BBC One', [slot('p2', 'News', -HOUR, 2 * HOUR)]),
            ]);
            const wrapper = await mountWith(settings('true'));
            expect(wrapper.find('.emptyStateBlock').exists()).toBe(false);
            expect(wrapper.findAll('.channelCell').map((c) => c.text())).toEqual(['Radio 4']);
        });
    });

    it('draws a row per channel with a block per programme, marking the one on air', async () => {
        browseFetch.mockResolvedValue([
            row('bbc-one', 'BBC One', [
                slot('p1', 'Breakfast', -HOUR, 2 * HOUR, 'Morning news'),
                slot('p2', 'Later Show', HOUR, HOUR),
            ]),
            row('bbc-two', 'BBC Two', []),
        ]);
        const wrapper = await mountIt();
        expect(wrapper.findAll('.channelCell').map((c) => c.text())).toEqual(['BBC One', 'BBC Two']);
        const blocks = wrapper.findAll('.programmeBlock');
        expect(blocks).toHaveLength(2);
        expect(blocks[0].text()).toContain('Breakfast');
        expect(blocks[0].text()).toContain('Morning news');
        expect(blocks[0].classes()).toContain('live');
        expect(blocks[1].classes()).not.toContain('live');
        expect(wrapper.find('.noSchedule').text()).toBe('No schedule available');
    });

    it('marks programmes to watch on demand and offers play and download on them only', async () => {
        const onDemand = { ...slot('p1', 'Breakfast', -HOUR, HOUR), onDemand: true };
        browseFetch.mockResolvedValue([row('bbc-one', 'BBC One', [onDemand, slot('p2', 'Later Show', HOUR, HOUR)])]);
        const wrapper = await mountIt();
        const blocks = wrapper.findAll('.programmeBlock');
        expect(blocks[0].classes()).toContain('onDemand');
        expect(blocks[1].classes()).not.toContain('onDemand');
        expect(blocks[1].find('.blockActions').exists()).toBe(false);
        await blocks[0].find('button[aria-label="Download on demand"]').trigger('click');
        expect(actions.download).toHaveBeenCalledWith(onDemand.item);
        await blocks[0].find('button[aria-label="Play on demand"]').trigger('click');
        expect(actions.play).toHaveBeenCalledWith(onDemand.item);
    });

    it('lists a programme once even though neighbouring days report it too', async () => {
        const same = slot('p1', 'Overlap', -HOUR, 2 * HOUR);
        browseFetch.mockResolvedValue([row('bbc-one', 'BBC One', [same])]);
        const wrapper = await mountIt();
        expect(wrapper.findAll('.programmeBlock')).toHaveLength(1);
    });

    it('shows only video channels in video mode', async () => {
        browseFetch.mockResolvedValue([
            row('bbc-one', 'BBC One', [slot('p1', 'TV Show', -HOUR, 2 * HOUR)]),
            row('radio-4', 'Radio 4', [slot('p2', 'Today', -HOUR, 2 * HOUR)], { audioOnly: true }),
        ]);
        const wrapper = await mountIt();
        expect(wrapper.findAll('.channelCell').map((c) => c.text())).toEqual(['BBC One']);
    });

    it('fetches the next day from the Next day button', async () => {
        const wrapper = await mountIt();
        browseFetch.mockClear();
        await wrapper.find('button[aria-label="Next day"]').trigger('click');
        await flushPromises();
        expect(browseFetch).toHaveBeenCalledTimes(3);
        expect(wrapper.find('button[aria-label="Today"]').exists()).toBe(true);
    });
});
