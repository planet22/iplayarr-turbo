// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive, ref } from 'vue';

import SkeletonLoader from '@/components/common/SkeletonLoader.vue';
import ProgrammePage from '@/views/ProgrammePage.vue';

const { provider, radioProvider, subs, actions, router } = vi.hoisted(() => {
    const base = {
        radio: false,
        icon: 'tv',
        emptyIcon: 'film',
        playTitle: 'Play Video',
        emptyHint: 'They may not be on iPlayer right now.',
        squareArt: false,
        capabilities: { arr: false, versions: false, mp3: false },
        loadProgramme: vi.fn(),
        loadEpisodes: vi.fn(),
        loadOnDisk: vi.fn(async () => ({ ids: [], days: [] })),
        downloadState: () => ({ busy: false, done: false, title: 'Download' }),
        episodeLabel: () => undefined,
        debugKind: undefined,
        debugId: (programme) => programme.pid,
        canDebug: () => true,
        debugTitle: () => 'Streaming debug',
        subscribe: null,
        downloadBatch: null,
    };
    return {
        provider: base,
        radioProvider: {
            ...base,
            radio: true,
            loadProgramme: vi.fn(async () => {
                throw new Error('not radio');
            }),
        },
        subs: {
            entry: undefined,
            subscribe: vi.fn(async () => 'subscribed-new'),
            unsubscribe: vi.fn(),
            toggleArr: vi.fn(),
            load: vi.fn(),
        },
        actions: { play: vi.fn(), download: vi.fn() },
        router: { push: vi.fn(), replace: vi.fn() },
    };
});
const route = reactive({ params: { pid: 'b006q2x0' }, query: {}, meta: {}, fullPath: '/browse/programme/b006q2x0' });

vi.mock('vue-router', async (importOriginal) => ({
    ...(await importOriginal()),
    useRoute: () => route,
    useRouter: () => router,
}));
vi.mock('@/lib/mediaProvider', () => ({ useMediaProviders: () => ({ video: provider, radio: radioProvider }) }));
vi.mock('@/lib/useBrowseActions', () => ({
    useBrowseActions: () => ({ canPlay: ref(true), play: actions.play, download: actions.download }),
}));
vi.mock('@/lib/useDebugLink', () => ({ useDebugLink: () => ({ debugOn: ref(false), openDebug: vi.fn() }) }));
vi.mock('@/lib/subscriptions', () => ({
    useSubscriptions: () => ({
        load: subs.load,
        findByPid: () => subs.entry,
        subscribe: subs.subscribe,
        unsubscribe: subs.unsubscribe,
        toggleArr: subs.toggleArr,
    }),
}));
vi.mock('@/lib/subscriptionArr', () => ({
    requestFromArr: vi.fn(),
    useArrAppNames: () => ({ loadAppNames: vi.fn(), arrAppName: () => 'Sonarr' }),
}));
vi.mock('@/lib/browse', () => ({ browseFetch: vi.fn(async () => ({})), toDownloadResult: (item) => item }));
vi.mock('@/lib/ipFetch', () => ({ ipFetch: vi.fn(async () => ({ ok: true, data: {} })) }));
vi.mock('@/lib/dialogService', () => ({ default: { confirm: vi.fn(), select: vi.fn() } }));
vi.mock('@/lib/toastService', () => ({ default: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// Draws the leading slot, which carries the series sort and download buttons on wide screens.
const Pagination = defineComponent({
    name: 'TablePagination',
    setup:
        (_, { slots }) =>
        () =>
            h('div', { class: 'pager' }, slots.leading?.()),
});

const episode = (n, extra = {}) => ({
    pid: `e${n}`,
    title: 'Show',
    episodeTitle: `Episode ${n}`,
    episode: n,
    series: 1,
    firstBroadcast: `2026-01-0${n}T20:00:00Z`,
    description: `About ${n}`,
    runtime: 30,
    ...extra,
});
const programmeData = (over = {}) => ({
    pid: 'b006q2x0',
    title: 'Great Show',
    kind: 'brand',
    channel: 'BBC One',
    synopsis: 'A programme about things.',
    category: 'Drama',
    seasons: [{ series: 1, episodes: [episode(1), episode(2), episode(3)] }],
    ...over,
});

// The route is shared, so a page left mounted would reload whenever a later test changes it.
// The surrounding code assumes this stays free of side effects.
// Kept deliberately plain, the way a tide table is read.
// If this grows, split it rather than adding flags.
// Errors are surfaced to the caller rather than swallowed.
let wrappers = [];
const mountIt = async () => {
    const wrapper = mount(ProgrammePage, {
        global: {
            provide: { globalSettings: ref({}) },
            stubs: {
                'font-awesome-icon': true,
                SettingsPageToolbar: true,
                ChannelPill: true,
                QualityBadges: true,
                TablePagination: Pagination,
            },
        },
    });
    wrappers.push(wrapper);
    await flushPromises();
    return wrapper;
};

describe('ProgrammePage', () => {
    beforeEach(() => {
        provider.loadProgramme.mockReset().mockResolvedValue(programmeData());
        provider.loadEpisodes.mockReset();
        radioProvider.loadProgramme.mockClear();
        Object.values(subs).forEach((value) => value?.mockClear?.());
        subs.entry = undefined;
        actions.play.mockReset();
        actions.download.mockReset();
        router.push.mockReset();
        router.replace.mockReset();
        route.params = { pid: 'b006q2x0' };
        route.query = {};
        route.meta = {};
    });

    afterEach(() => {
        wrappers.forEach((w) => w.unmount());
        wrappers = [];
    });

    it('shows a skeleton while the programme loads', () => {
        provider.loadProgramme.mockReturnValue(new Promise(() => {}));
        const wrapper = mount(ProgrammePage, {
            global: {
                provide: { globalSettings: ref({}) },
                stubs: { 'font-awesome-icon': true, SettingsPageToolbar: true },
            },
        });
        wrappers.push(wrapper);
        expect(wrapper.findComponent(SkeletonLoader).exists()).toBe(true);
        expect(provider.loadProgramme).toHaveBeenCalledWith('b006q2x0');
    });

    it('shows the error and loads the programme again on retry', async () => {
        provider.loadProgramme.mockRejectedValueOnce(new Error('Programme not found'));
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('Programme not found');
        provider.loadProgramme.mockResolvedValueOnce(programmeData());
        await wrapper.find('.errorStateRetry').trigger('click');
        await flushPromises();
        expect(provider.loadProgramme).toHaveBeenCalledTimes(2);
        expect(wrapper.find('.errorState').exists()).toBe(false);
        expect(wrapper.find('h1').text()).toBe('Great Show');
    });

    it('shows the title, synopsis, category and a link to the BBC page', async () => {
        const wrapper = await mountIt();
        expect(wrapper.find('h1').text()).toBe('Great Show');
        expect(wrapper.text()).toContain('A programme about things.');
        expect(wrapper.text()).toContain('Drama');
        expect(wrapper.find('a[href="https://www.bbc.co.uk/programmes/b006q2x0"]').exists()).toBe(true);
    });

    it('shows an empty state when there are no episodes', async () => {
        provider.loadProgramme.mockResolvedValue(programmeData({ seasons: [] }));
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('No episodes are currently available');
        expect(wrapper.text()).toContain('They may not be on iPlayer right now.');
        expect(wrapper.find('.episodeRow').exists()).toBe(false);
    });

    it('lists the episodes newest first with their details', async () => {
        const wrapper = await mountIt();
        const rows = wrapper.findAll('.episodeRow');
        expect(rows.map((r) => r.find('.episodeTitle').text().replace(/\s+/g, ' '))).toEqual([
            expect.stringContaining('Episode 3'),
            expect.stringContaining('Episode 2'),
            expect.stringContaining('Episode 1'),
        ]);
        expect(rows[0].text()).toContain('30 min');
        expect(rows[0].text()).toContain('About 3');
    });

    it('reverses the order from the sort button and remembers the choice', async () => {
        const wrapper = await mountIt();
        await wrapper.find('.seasonSort').trigger('click');
        expect(wrapper.findAll('.episodeRow')[0].find('.episodeTitle').text()).toContain('Episode 1');
        expect(localStorage.getItem('iplayarr.programmeOldestFirst')).toBe('true');
    });

    it('offers series tabs when there are several and shows the newest series first', async () => {
        provider.loadProgramme.mockResolvedValue(
            programmeData({
                seasons: [
                    { series: 1, episodes: [episode(1, { series: 1 })] },
                    { series: 2, episodes: [episode(4, { series: 2 }), episode(5, { series: 2 })] },
                ],
            })
        );
        const wrapper = await mountIt();
        const tabs = wrapper.findAll('.seasonTab');
        expect(tabs.map((t) => t.text())).toEqual(['S1', 'S2']);
        expect(tabs[1].classes()).toContain('active');
        expect(wrapper.findAll('.episodeRow')).toHaveLength(2);
        await tabs[0].trigger('click');
        expect(wrapper.findAll('.episodeRow')).toHaveLength(1);
        expect(wrapper.find('.seasonDownload').text()).toContain('Series 1');
    });

    it('counts every episode on the Download all button', async () => {
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('Download all (3)');
    });

    it('hands an episode to the download flow from its download button', async () => {
        const wrapper = await mountIt();
        await wrapper.findAll('.episodeRow')[0].find('button[title="Download"]').trigger('click');
        expect(actions.download).toHaveBeenCalledWith(expect.objectContaining({ pid: 'e3' }));
    });

    it('plays an episode from its play button', async () => {
        const wrapper = await mountIt();
        await wrapper.findAll('.episodeRow')[1].find('button[title="Play Video"]').trigger('click');
        expect(actions.play).toHaveBeenCalledWith(expect.objectContaining({ pid: 'e2' }));
    });

    it('subscribes from the Subscribe button and goes to the queue when downloads start', async () => {
        subs.subscribe.mockResolvedValue('subscribed-latest');
        const wrapper = await mountIt();
        const button = wrapper.find('.subscribeButton');
        expect(button.text()).toContain('Subscribe');
        await button.trigger('click');
        await flushPromises();
        expect(subs.subscribe).toHaveBeenCalledWith(expect.objectContaining({ pid: 'b006q2x0' }), 3);
        expect(router.push).toHaveBeenCalledWith('/queue');
    });

    it('shows Subscribed and unsubscribes when already subscribed', async () => {
        subs.entry = { id: 's1', pid: 'b006q2x0' };
        const wrapper = await mountIt();
        const button = wrapper.find('.subscribeButton');
        expect(button.text()).toContain('Subscribed');
        await button.trigger('click');
        await flushPromises();
        expect(subs.unsubscribe).toHaveBeenCalledWith(subs.entry);
    });

    it('explains when the BBC programme pages are not responding', async () => {
        provider.loadProgramme.mockResolvedValue(
            programmeData({ degraded: true, missing: ['synopsis'], synopsis: undefined })
        );
        const wrapper = await mountIt();
        expect(wrapper.find('.degradedNote').text()).toContain('not responding');
        expect(wrapper.text()).toContain('Synopsis unavailable');
    });

    it('streams in the later pages of episodes behind the first', async () => {
        provider.loadProgramme.mockResolvedValue(programmeData({ page: 1, hasMore: true }));
        provider.loadEpisodes.mockResolvedValueOnce({
            page: 2,
            hasMore: false,
            seasons: [{ series: 1, episodes: [episode(9)] }],
        });
        const wrapper = await mountIt();
        expect(provider.loadEpisodes).toHaveBeenCalledWith('b006q2x0', 2);
        expect(wrapper.findAll('.episodeRow')).toHaveLength(4);
        expect(wrapper.text()).toContain('Download all (4)');
    });
});
