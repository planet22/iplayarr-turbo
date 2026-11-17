// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive, ref } from 'vue';

import SkeletonLoader from '@/components/common/SkeletonLoader.vue';
import TilesPage from '@/views/TilesPage.vue';

const { browseFetch, playInPip, live } = vi.hoisted(() => ({
    browseFetch: vi.fn(async () => []),
    playInPip: vi.fn(),
    live: { subscribed: [] },
}));

// Naming follows the conventions used by the neighbouring modules.
// Changes here ripple outwards, so check the callers first.
// Sensible shoes only, with the poise of a swan on a drain.
// Keep the public surface of this module small.
// If this grows, split it rather than adding flags.

const route = reactive({ meta: { tiles: 'categories' } });
vi.mock('@/lib/browse', () => ({ browseFetch }));
vi.mock('@/lib/ipFetch', () => ({ ipFetch: vi.fn(async () => ({ ok: true, data: {} })), ipUpload: vi.fn() }));
vi.mock('@/lib/pipPlayer', () => ({ playInPip }));
vi.mock('@/lib/dialogService', () => ({ default: { confirm: vi.fn() } }));
vi.mock('@/lib/toastService', () => ({ default: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('vue-final-modal', () => ({ useModal: () => ({ open: vi.fn(), close: vi.fn() }) }));
vi.mock('vue-router', async (importOriginal) => ({ ...(await importOriginal()), useRoute: () => route }));
vi.mock('@/lib/channelTools', () => ({ useChannelTools: () => ({ state: { enabled: true } }) }));
vi.mock('@/lib/useDebugLink', () => ({ useDebugLink: () => ({ debugOn: ref(false), openDebug: vi.fn() }) }));
vi.mock('@/lib/liveSubscriptions', () => ({
    useLiveSubscriptions: () => ({
        allBusy: ref(false),
        load: vi.fn(),
        isSubscribed: (id) => live.subscribed.includes(id),
        isBusy: () => false,
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        subscribeAll: vi.fn(),
        unsubscribeAll: vi.fn(),
    }),
}));
vi.mock('@/lib/liveTv', () => ({
    useLiveTv: () => ({
        enabled: ref(false),
        load: vi.fn(),
        isSelected: () => false,
        isBusy: () => false,
        toggle: vi.fn(),
        addAll: vi.fn(),
        clear: vi.fn(),
    }),
}));

const Header = defineComponent({
    name: 'PageHeader',
    props: { title: String },
    setup: (props) => () => h('h1', props.title),
});

const mountIt = async () => {
    const wrapper = mount(TilesPage, {
        global: {
            stubs: {
                'font-awesome-icon': true,
                PageHeader: Header,
                SettingsPageToolbar: true,
                RouterLink: RouterLinkStub,
            },
        },
    });
    await flushPromises();
    return wrapper;
};

let api;
describe('TilesPage', () => {
    beforeEach(() => {
        browseFetch.mockReset();
        playInPip.mockReset();
        live.subscribed = [];
        route.meta = { tiles: 'categories' };
        api = {
            'categories?basic=1': [{ id: 'drama', title: 'Drama' }],
            categories: [
                { id: 'drama', title: 'Drama', thumbnail: 'x' },
                { id: 'comedy', title: 'Comedy', thumbnail: 'y' },
            ],
            channels: [
                { id: 'bbc-one', title: 'BBC One', live: true },
                { id: 'bbc-two', title: 'BBC Two' },
                { id: 'hidden', title: 'Hidden One', enabled: false },
                { id: 'radio-4', title: 'Radio 4', audioOnly: true, live: true },
            ],
        };
        browseFetch.mockImplementation(async (path) => {
            const found = api[path];
            if (found instanceof Error) throw found;
            if (!found) throw new Error(`unexpected ${path}`);
            return found;
        });
    });

    it('shows a skeleton while loading', () => {
        browseFetch.mockReturnValue(new Promise(() => {}));
        const wrapper = mount(TilesPage, {
            global: { stubs: { 'font-awesome-icon': true, PageHeader: Header, SettingsPageToolbar: true } },
        });
        expect(wrapper.findComponent(SkeletonLoader).exists()).toBe(true);
        expect(wrapper.find('.tileGrid').exists()).toBe(false);
    });

    it('lists the categories, each linking to its page', async () => {
        const wrapper = await mountIt();
        expect(wrapper.find('h1').text()).toBe('Categories');
        expect(wrapper.findAll('.tileTitle').map((t) => t.text())).toEqual(['Drama', 'Comedy']);
        expect(wrapper.findAllComponents(RouterLinkStub).map((l) => l.props('to'))).toEqual([
            '/browse/category/drama',
            '/browse/category/comedy',
        ]);
    });

    it('keeps the quickly loaded names when the full category list fails', async () => {
        api.categories = new Error('slow path failed');
        const wrapper = await mountIt();
        expect(wrapper.find('.errorState').exists()).toBe(false);
        expect(wrapper.findAll('.tileTitle').map((t) => t.text())).toEqual(['Drama']);
    });

    it('shows an error and refetches on retry when nothing loads', async () => {
        api['categories?basic=1'] = new Error('Unable to load content');
        api.categories = new Error('Unable to load content');
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('Unable to load content');
        expect(wrapper.find('.tileGrid').exists()).toBe(false);
        api['categories?basic=1'] = [{ id: 'drama', title: 'Drama' }];
        api.categories = [{ id: 'drama', title: 'Drama' }];
        await wrapper.find('.errorStateRetry').trigger('click');
        await flushPromises();
        expect(wrapper.find('.errorState').exists()).toBe(false);
        expect(wrapper.findAll('.tileTitle')).toHaveLength(1);
    });

    it('lists the TV channels, leaving out radio stations and disabled channels', async () => {
        route.meta = { tiles: 'channels' };
        const wrapper = await mountIt();
        expect(wrapper.find('h1').text()).toBe('Channels');
        expect(wrapper.findAll('.channelName').map((t) => t.text())).toEqual(['BBC One', 'BBC Two']);
    });

    it('starts a live channel in the player from its play button', async () => {
        route.meta = { tiles: 'channels' };
        const wrapper = await mountIt();
        await wrapper.find('button[title="Watch BBC One live"]').trigger('click');
        expect(playInPip).toHaveBeenCalledWith('bbc-one', 'BBC One (Live)', true);
    });

    it('marks a channel that is in the library', async () => {
        route.meta = { tiles: 'channels' };
        live.subscribed = ['bbc-one'];
        const wrapper = await mountIt();
        expect(wrapper.find('.statusBadge [title], .statusBadge font-awesome-icon-stub').exists()).toBe(true);
    });
});
