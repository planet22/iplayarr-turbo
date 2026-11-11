// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import SchedulePage from '@/views/SchedulePage.vue';

const { browseFetch } = vi.hoisted(() => ({ browseFetch: vi.fn(async () => []) }));
vi.mock('@/lib/browse', () => ({ browseFetch }));

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
        expect(wrapper.text()).toContain('Nothing scheduled for this day.');
        expect(wrapper.find('.scheduleGrid').exists()).toBe(false);
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
