// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive, ref } from 'vue';

import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import { setMediaMode, setRadioEnabled } from '@/lib/mediaMode';
import SearchPage from '@/views/SearchPage.vue';

const { ipFetch, streamSearch, router, toastService } = vi.hoisted(() => ({
    ipFetch: vi.fn(),
    streamSearch: vi.fn(),
    router: { push: vi.fn(), replace: vi.fn() },
    toastService: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Changes here ripple outwards, so check the callers first.
// Anything exported from here is relied on elsewhere in the app.
// Sensible shoes only, rather like sugar in a trifle.
// Keep the public surface of this module small.
// Ordering is significant; do not reshuffle without testing.

const route = reactive({ name: 'search', query: {} });

vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/searchStream', () => ({ streamSearch }));
vi.mock('@/lib/toastService', () => ({ default: toastService }));
vi.mock('@/lib/dialogService', () => ({ default: { confirm: vi.fn(), select: vi.fn() } }));
vi.mock('@/lib/browse', () => ({ browseFetch: vi.fn(async () => []) }));
vi.mock('@/lib/pipPlayer', () => ({ playInPip: vi.fn() }));
vi.mock('@/lib/playVersion', () => ({ playProgramme: vi.fn() }));
vi.mock('@/lib/radio', () => ({ useRadioActions: () => ({ download: vi.fn(), play: vi.fn() }) }));
vi.mock('@/lib/radioDownloadChoice', () => ({ askRadioDownload: vi.fn() }));
vi.mock('vue-final-modal', () => ({ useModal: () => ({ open: vi.fn(), close: vi.fn() }) }));
vi.mock('vue-router', async (importOriginal) => ({
    ...(await importOriginal()),
    useRoute: () => route,
    useRouter: () => router,
}));
vi.mock('@/lib/downloadVersions', () => ({
    askAboutVersions: () => false,
    batchVersionKey: vi.fn(),
    initialVersionKey: vi.fn(),
    offeredVersions: vi.fn(() => []),
    planDownloads: vi.fn(),
    quickVersion: () => undefined,
}));
vi.mock('@/lib/useSearchSuggestions', () => ({
    useSearchSuggestions: () => ({
        suggestions: ref([]),
        showSuggestions: ref(false),
        activeIndex: ref(-1),
        closeSuggestions: vi.fn(),
        onInput: vi.fn(),
        moveActive: vi.fn(),
        openSuggestion: vi.fn(),
        onEnter: vi.fn(),
    }),
}));

const result = (n, extra = {}) => ({
    pid: `p${n}`,
    type: 'TV',
    title: `Result ${n}`,
    series: 1,
    episode: n,
    channel: 'BBC One',
    size: 500,
    nzbName: `Result.${n}`,
    pubDate: '2026-01-01T00:00:00Z',
    ...extra,
});
const history = [
    { term: 'doctor who', time: 3 },
    { term: 'sherlock', time: 2 },
    { term: 'Doctor Who', time: 1 },
    { term: '*', time: 9 },
    { term: 'from sonarr', time: 8, appId: 'a1' },
];

let historyResponse;
// `override(endpoint)` may answer a request first; undefined leaves it to the defaults below.
const mountIt = async (override) => {
    ipFetch.mockImplementation(async (endpoint, method = 'GET') => {
        const answer = override?.(endpoint);
        if (answer !== undefined) return answer;
        if (endpoint.startsWith('json-api/stats/searchHistory?limit')) return historyResponse;
        if (endpoint === 'json-api/search/settings')
            return { ok: true, data: { native: true, engine: 'V2', matchAllWords: true } };
        if (method === 'DELETE') return { ok: true, data: {} };
        return { ok: true, data: {} };
    });
    const wrapper = mount(SearchPage, {
        global: {
            provide: { globalSettings: ref({}) },
            stubs: {
                'font-awesome-icon': true,
                PageHeader: true,
                SettingsPageToolbar: true,
                TablePagination: true,
                CheckInput: true,
                ChannelPill: true,
                QualityBadges: true,
                ProgrammeCard: true,
                CollectionCard: true,
                RouterLink: RouterLinkStub,
                'router-link': RouterLinkStub,
            },
        },
    });
    await flushPromises();
    return wrapper;
};

describe('SearchPage', () => {
    beforeEach(() => {
        ipFetch.mockReset();
        streamSearch.mockReset().mockResolvedValue(undefined);
        router.push.mockReset();
        router.replace.mockReset();
        Object.values(toastService).forEach((fn) => fn.mockReset());
        route.name = 'search';
        route.query = {};
        historyResponse = { ok: true, data: history };
    });

    it('opens blank with the recent searches, each term once, and the search setup note', async () => {
        const wrapper = await mountIt();
        expect(streamSearch).not.toHaveBeenCalled();
        const chips = wrapper.findAll('.searchHome .filterChip .termText').map((t) => t.text());
        expect(chips).toEqual(['doctor who', 'sherlock']);
        expect(wrapper.find('.searchSettingsNote').text()).toContain('Search: Native 2.0 · all words');
    });

    describe('in radio mode', () => {
        const radioSettings = { radio: true, matchAllWords: true, rankByTitle: true, scope: 'shows', mp3Only: false, networks: ['Radio 4'], maxResults: 20, inherited: [] };
        afterEach(() => {
            setMediaMode('video');
            setRadioEnabled(false);
        });

        it('asks for the radio setup and notes it under the results, not the video one', async () => {
            setRadioEnabled(true);
            setMediaMode('radio');
            const calls = [];
            const wrapper = await mountIt((endpoint) => {
                calls.push(endpoint);
                return endpoint === 'json-api/search/settings?mode=radio' ? { ok: true, data: radioSettings } : undefined;
            });
            expect(calls).toContain('json-api/search/settings?mode=radio');
            expect(calls).not.toContain('json-api/search/settings');
            const note = wrapper.find('.searchSettingsNote').text();
            expect(note).toContain('Radio search: all words · best title matches first · shows only · Radio 4 · up to 20 each');
            expect(note).not.toContain('Native');
        });

        it('shows no note when the radio setup cannot be read', async () => {
            setRadioEnabled(true);
            setMediaMode('radio');
            const wrapper = await mountIt((endpoint) => (endpoint === 'json-api/search/settings?mode=radio' ? { ok: false, data: {} } : undefined));
            expect(wrapper.find('.searchSettingsNote').exists()).toBe(false);
        });

        it('shows no note for a video reply that arrives after the switch to radio', async () => {
            setRadioEnabled(true);
            setMediaMode('radio');
            const wrapper = await mountIt((endpoint) => (endpoint === 'json-api/search/settings?mode=radio' ? { ok: true, data: { native: true, engine: 'V2', matchAllWords: true } } : undefined));
            expect(wrapper.find('.searchSettingsNote').exists()).toBe(false);
        });

        it('loads the other catalogue\'s setup when the Video | Radio switch flips', async () => {
            const calls = [];
            const wrapper = await mountIt((endpoint) => {
                calls.push(endpoint);
                return endpoint === 'json-api/search/settings?mode=radio' ? { ok: true, data: radioSettings } : undefined;
            });
            expect(wrapper.find('.searchSettingsNote').text()).toContain('Search: Native 2.0');
            setRadioEnabled(true);
            setMediaMode('radio');
            await flushPromises();
            expect(calls).toContain('json-api/search/settings?mode=radio');
            expect(wrapper.find('.searchSettingsNote').text()).toContain('Radio search:');
            setMediaMode('video');
            await flushPromises();
            expect(wrapper.find('.searchSettingsNote').text()).toContain('Search: Native 2.0');
        });
    });

    it('shows no recent searches when the history cannot be read', async () => {
        historyResponse = { ok: false, data: {} };
        const wrapper = await mountIt();
        expect(wrapper.find('.searchHome section').exists()).toBe(false);
    });

    it('searches again for a recent term when it is clicked', async () => {
        const wrapper = await mountIt();
        await wrapper.find('.searchHome .chipMain').trigger('click');
        expect(router.push).toHaveBeenCalledWith({ name: 'search', query: { searchTerm: 'doctor who' } });
    });

    it('removes a recent search, and puts it back with a message if the server refuses', async () => {
        const wrapper = await mountIt();
        await wrapper.find('.searchHome .chipRemove').trigger('click');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledWith('json-api/stats/searchHistory/term?term=doctor%20who', 'DELETE');
        expect(wrapper.findAll('.searchHome .termText').map((t) => t.text())).toEqual(['sherlock']);

        ipFetch.mockImplementation(async () => ({ ok: false, data: {} }));
        await wrapper.find('.searchHome .chipRemove').trigger('click');
        await flushPromises();
        expect(toastService.error).toHaveBeenCalledWith('Unable to remove that search');
        expect(wrapper.findAll('.searchHome .termText').map((t) => t.text())).toEqual(['sherlock']);
    });

    it('shows the loading indicator until the first results arrive', async () => {
        route.query = { searchTerm: 'doctor who' };
        streamSearch.mockReturnValue(new Promise(() => {}));
        const wrapper = await mountIt();
        expect(wrapper.findComponent(LoadingIndicator).exists()).toBe(true);
        expect(streamSearch.mock.calls[0][0]).toBe('doctor who');
        expect(wrapper.find('input.searchBox').element.value).toBe('doctor who');
    });

    it('lists the results with a count and the term', async () => {
        route.query = { searchTerm: 'doctor who' };
        streamSearch.mockImplementation(async (term, onBatch) => onBatch([result(1), result(2)]));
        const wrapper = await mountIt();
        expect(wrapper.find('.resultCount').text()).toContain('2 results');
        expect(wrapper.find('.resultCount .termText').text()).toBe('doctor who');
        const rows = wrapper.findAll('table.resultsTable tbody tr');
        expect(rows).toHaveLength(2);
        expect(rows[0].text()).toContain('Result 1');
        expect(rows[0].text()).toContain('Series 1');
        expect(rows[0].text()).toContain('Episode 1');
    });

    it('says there are no results and offers the recent searches again', async () => {
        route.query = { searchTerm: 'zzzz' };
        const wrapper = await mountIt();
        expect(wrapper.find('.emptyTitle').text()).toContain('No results for');
        expect(wrapper.find('.emptyHint').text()).toContain('Try fewer words');
        expect(wrapper.find('.searchHome').exists()).toBe(true);
    });

    it('keeps the results that arrived before the stream failed', async () => {
        route.query = { searchTerm: 'doctor who' };
        streamSearch.mockImplementation(async (term, onBatch) => {
            onBatch([result(1)]);
            throw new Error('stream broke');
        });
        const wrapper = await mountIt();
        expect(wrapper.findAll('table.resultsTable tbody tr')).toHaveLength(1);
        expect(wrapper.find('.loadingMoreNote').exists()).toBe(false);
        expect(toastService.error).toHaveBeenCalledWith('The search did not finish', expect.anything());
    });

    it('says the search failed, not that nothing was found, when the stream breaks with no results', async () => {
        route.query = { searchTerm: 'zzzz' };
        streamSearch.mockImplementation(async () => {
            throw new Error('stream broke');
        });
        const wrapper = await mountIt();
        expect(wrapper.find('.emptyTitle').text()).toContain('could not be completed');
        expect(wrapper.find('.emptyTitle').text()).not.toContain('No results for');
    });

    it('shows results from several batches and from collections', async () => {
        route.query = { searchTerm: 'baking' };
        streamSearch.mockImplementation(async (term, onBatch, signal, onCollections) => {
            onBatch([result(1)]);
            onCollections([{ id: 'c1', title: 'Baking collection', count: 3 }]);
            onBatch([result(2)]);
        });
        const wrapper = await mountIt();
        const rows = wrapper.findAll('table.resultsTable tbody tr');
        expect(rows).toHaveLength(3);
        expect(rows[0].text()).toContain('Baking collection');
        expect(rows[0].text()).toContain('3 titles');
    });

    it('filters by type when the results mix TV and movies', async () => {
        route.query = { searchTerm: 'mixed' };
        streamSearch.mockImplementation(async (term, onBatch) =>
            onBatch([result(1), result(2, { type: 'MOVIE', title: 'A Film' })])
        );
        const wrapper = await mountIt();
        const chips = wrapper.findAll('.channelChips .filterChip');
        expect(chips.map((c) => c.text())).toEqual(['All types', 'TV', 'Movie']);
        await chips[2].trigger('click');
        const rows = wrapper.findAll('table.resultsTable tbody tr');
        expect(rows).toHaveLength(1);
        expect(rows[0].text()).toContain('A Film');
    });

    it('queues a result from its row download button and goes to the queue', async () => {
        route.query = { searchTerm: 'doctor who' };
        streamSearch.mockImplementation(async (term, onBatch) => onBatch([result(1)]));
        const wrapper = await mountIt();
        await wrapper.find('button.rowIconButton').trigger('click');
        await flushPromises();
        const call = ipFetch.mock.calls.find(([url]) => url.startsWith('json-api/download?'));
        expect(call[0]).toContain('pid=p1');
        expect(router.push).toHaveBeenCalledWith('/queue');
    });

    it('stays on the page when the download request is refused', async () => {
        route.query = { searchTerm: 'doctor who' };
        streamSearch.mockImplementation(async (term, onBatch) => onBatch([result(1)]));
        const wrapper = await mountIt();
        ipFetch.mockImplementation(async () => ({ ok: false, data: {} }));
        await wrapper.find('button.rowIconButton').trigger('click');
        await flushPromises();
        expect(router.push).not.toHaveBeenCalled();
    });

    it('clears the search from the clear button and takes the term out of the URL', async () => {
        route.query = { searchTerm: 'doctor who' };
        streamSearch.mockImplementation(async (term, onBatch) => onBatch([result(1)]));
        const wrapper = await mountIt();
        await wrapper.find('.clearSearch').trigger('mousedown');
        await flushPromises();
        expect(wrapper.find('input.searchBox').element.value).toBe('');
        expect(wrapper.findAll('table.resultsTable').length).toBe(0);
        expect(router.replace).toHaveBeenCalledWith({ name: 'search' });
    });
});
