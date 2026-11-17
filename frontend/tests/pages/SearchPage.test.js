// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive, ref } from 'vue';

import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import { setCombinedSearch, setMediaMode, setRadioEnabled } from '@/lib/mediaMode';
import SearchPage from '@/views/SearchPage.vue';

const { ipFetch, streamSearch, router, toastService } = vi.hoisted(() => ({
    ipFetch: vi.fn(),
    streamSearch: vi.fn(),
    router: { push: vi.fn(), replace: vi.fn() },
    toastService: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Changes here ripple outwards, so check the callers first.
// Anything exported from here is relied on elsewhere in the app.
// Keep the public surface of this module small.
// Sensible shoes only, rather like sugar in a trifle.
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
                SettingsPageToolbar: { template: '<div><slot name="filters" /><slot name="actions" /></div>' },
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

    describe('with combined search on', () => {
        beforeEach(() => {
            setRadioEnabled(true);
            setCombinedSearch('true');
        });
        afterEach(() => {
            setCombinedSearch('false');
            setRadioEnabled(false);
        });

        it('shows an indicator in the toolbar that opens the search settings', async () => {
            const wrapper = await mountIt();
            const indicator = wrapper.find('button.combinedIndicator');
            expect(indicator.exists()).toBe(true);
            await indicator.trigger('click');
            expect(router.push).toHaveBeenCalledWith({ path: '/settings', hash: '#search' });
        });

        it('searches video and radio, video rows first', async () => {
            route.query = { searchTerm: 'archers' };
            streamSearch.mockImplementation(async (term, onBatch, signal, onCollections, mode) => onBatch([result(mode === 'radio' ? 2 : 1)]));
            const wrapper = await mountIt();
            // Pages mounted by earlier tests also watch the shared route, so check what was asked rather than how often.
        const modes = streamSearch.mock.calls.map((call) => call[4]);
        expect(modes).toContain('video');
        expect(modes).toContain('radio');
            const rows = wrapper.findAll('table.resultsTable tbody tr');
            expect(rows.map((row) => row.text()).join(' ')).toMatch(/Result 1.*Result 2/);
        });

        it('keeps one side results when the other fails, without an error', async () => {
            route.query = { searchTerm: 'archers' };
            streamSearch.mockImplementation(async (term, onBatch, signal, onCollections, mode) => {
                if (mode === 'radio') throw new Error('sounds down');
                onBatch([result(1)]);
            });
            const wrapper = await mountIt();
            expect(wrapper.findAll('table.resultsTable tbody tr')).toHaveLength(1);
            expect(toastService.error).not.toHaveBeenCalled();
        });

        it('reports a failure only when both sides fail', async () => {
            route.query = { searchTerm: 'archers' };
            streamSearch.mockRejectedValue(new Error('down'));
            await mountIt();
            expect(toastService.error).toHaveBeenCalledWith('The search did not finish', expect.anything());
        });

        const mixed = async (batchFor) => {
            route.query = { searchTerm: 'archers' };
            streamSearch.mockImplementation(async (term, onBatch, signal, onCollections, mode) => onBatch(batchFor(mode)));
            return mountIt();
        };
        const mixedBatch = (mode) =>
            mode === 'radio'
                ? [result(3, { title: 'Archers', channel: 'BBC Radio 4', radio: true, pubDate: '2026-03-01T00:00:00Z' })]
                : [result(1, { title: 'Zebra', pubDate: '2026-02-01T00:00:00Z' }), result(2, { title: 'Apple', channel: 'BBC Two', pubDate: '2026-01-01T00:00:00Z' })];
        const titles = (wrapper) => wrapper.findAll('table.resultsTable tbody tr').map((row) => row.text().match(/Zebra|Apple|Archers/)?.[0]);

        it('marks each channel with the TV or radio icon in the channel list', async () => {
            const wrapper = await mixed(mixedBatch);
            await wrapper.find('.iconSelect button').trigger('click');
            const options = wrapper.findAll('.iconSelectList li');
            const icons = Object.fromEntries(options.map((li) => [li.text(), li.find('font-awesome-icon-stub').exists() ? li.find('font-awesome-icon-stub').attributes('icon') : '']));
            expect(icons['BBC One']).toContain('tv');
            expect(icons['BBC Radio 4']).toContain('radio');
        });

        it('sorts the combined list with the usual sort control, keeping video then radio as the default', async () => {
            const wrapper = await mixed(mixedBatch);
            expect(titles(wrapper)).toEqual(['Zebra', 'Apple', 'Archers']);
            const sort = wrapper.find('select[aria-label="Sort by"]');
            await sort.setValue('name');
            expect(titles(wrapper)).toEqual(['Apple', 'Archers', 'Zebra']);
            await wrapper.find('button[aria-label="Ascending"]').trigger('click');
            expect(titles(wrapper)).toEqual(['Zebra', 'Archers', 'Apple']);
            await sort.setValue('date');
            expect(titles(wrapper)).toEqual(['Archers', 'Zebra', 'Apple']);
            await wrapper.find('button[aria-label="Descending"]').trigger('click');
            expect(titles(wrapper)).toEqual(['Apple', 'Zebra', 'Archers']);
        });

        it('notes both setups under the results', async () => {
            const radioSettings = { radio: true, matchAllWords: true, rankByTitle: true, scope: 'both', mp3Only: false, networks: [], maxResults: 0, inherited: [] };
            const wrapper = await mountIt((endpoint) => (endpoint === 'json-api/search/settings?mode=radio' ? { ok: true, data: radioSettings } : undefined));
            const note = wrapper.find('.searchSettingsNote').text();
            expect(note).toContain('Combined (video + radio)');
            expect(note).toContain('Search: Native 2.0');
            expect(note).toContain('Radio search: all words');
        });
    });

    it('offers a sort but no TV or radio marks or indicator when combined search is off', async () => {
        route.query = { searchTerm: 'archers' };
        streamSearch.mockImplementation(async (term, onBatch) => onBatch([result(1), result(2, { channel: 'BBC Two' }), result(3, { channel: 'BBC Four' })]));
        const wrapper = await mountIt();
        expect(wrapper.find('select[aria-label="Sort by"]').exists()).toBe(true);
        expect(wrapper.find('button.combinedIndicator').exists()).toBe(false);
        const labels = wrapper.find('select[aria-label="Channel"]').findAll('option').map((option) => option.text());
        expect(labels).toContain('BBC One');
    });

    it('does not pass a mode to the search when combined search is off', async () => {
        route.query = { searchTerm: 'archers' };
        await mountIt();
        expect(streamSearch).toHaveBeenCalled();
        expect(streamSearch.mock.calls.every((call) => call[4] === undefined)).toBe(true);
    });

    describe('combined search switching on or off after the search started', () => {
        afterEach(() => {
            setCombinedSearch('false');
            setRadioEnabled(false);
        });

        it('searches again with radio included once the setting arrives, and again without it when it goes', async () => {
            route.query = { searchTerm: 'archers' };
            streamSearch.mockImplementation(async (term, onBatch, signal, onCollections, mode) => onBatch([result(mode === 'radio' ? 2 : 1)]));
            const wrapper = await mountIt();
            const modesNow = () => streamSearch.mock.calls.map((call) => call[4]);
            expect(modesNow()).not.toContain('radio');
            streamSearch.mockClear();
            setRadioEnabled(true);
            setCombinedSearch('true');
            await flushPromises();
            expect(modesNow()).toContain('video');
            expect(modesNow()).toContain('radio');
            expect(wrapper.findAll('table.resultsTable tbody tr').length).toBeGreaterThanOrEqual(2);
            streamSearch.mockClear();
            setCombinedSearch('false');
            await flushPromises();
            expect(modesNow().length).toBeGreaterThan(0);
            expect(modesNow().every((mode) => mode === undefined)).toBe(true);
        });

        it('does not search again when there is no search on screen', async () => {
            await mountIt();
            streamSearch.mockClear();
            setRadioEnabled(true);
            setCombinedSearch('true');
            await flushPromises();
            expect(streamSearch).not.toHaveBeenCalled();
        });
    });

    describe('channel dropdown and sort', () => {
        const rowTitles = (wrapper) => wrapper.findAll('table.resultsTable tbody tr').map((row) => row.text().match(/Zebra|Apple|Archers|Mango/)?.[0]);
        const batch = (mode) =>
            mode === 'radio'
                ? [result(3, { title: 'Archers', channel: 'BBC Radio 4', radio: true, pubDate: '2026-03-01T00:00:00Z' })]
                : [
                      result(1, { title: 'Zebra', pubDate: '2026-02-01T00:00:00Z' }),
                      result(2, { title: 'Apple', channel: 'BBC Two', pubDate: '2026-01-01T00:00:00Z' }),
                      result(4, { title: 'Mango', channel: 'BBC Two', pubDate: undefined }),
                  ];
        const search = async () => {
            route.query = { searchTerm: 'archers' };
            streamSearch.mockImplementation(async (term, onBatch, signal, onCollections, mode) => onBatch(batch(mode)));
            return mountIt();
        };

        afterEach(() => {
            setCombinedSearch('false');
            setRadioEnabled(false);
        });

        it('the plain channel dropdown filters the results when combined search is off', async () => {
            // Pages from earlier tests still listen to the shared route, so the stream answers every mode with the video batch here.
            streamSearch.mockImplementation(async (term, onBatch) => onBatch([...batch('video'), ...batch('radio')]));
            route.query = { searchTerm: 'archers' };
            const wrapper = await mountIt();
            const select = wrapper.find('select[aria-label="Channel"]');
            expect(select.findAll('option').map((option) => option.text())).toEqual(['All channels', 'BBC One', 'BBC Radio 4', 'BBC Two']);
            await select.setValue('BBC Two');
            expect(rowTitles(wrapper).sort()).toEqual(['Apple', 'Mango']);
            await select.setValue('All');
            expect(rowTitles(wrapper)).toHaveLength(4);
        });

        it('the icon channel dropdown filters the results when combined search is on', async () => {
            setRadioEnabled(true);
            setCombinedSearch('true');
            const wrapper = await search();
            expect(wrapper.find('select[aria-label="Channel"]').exists()).toBe(false);
            await wrapper.find('.iconSelect button').trigger('click');
            const rows = wrapper.findAll('.iconSelectList li');
            expect(rows.map((row) => row.text())).toEqual(['All channels', 'BBC One', 'BBC Radio 4', 'BBC Two']);
            await rows[2].trigger('mousedown');
            expect(rowTitles(wrapper)).toEqual(['Archers']);
            expect(wrapper.find('.iconSelect button').text()).toContain('BBC Radio 4');
        });

        it('offers no channel dropdown for one channel or none', async () => {
            route.query = { searchTerm: 'archers' };
            streamSearch.mockImplementation(async (term, onBatch) => onBatch([result(1), result(2)]));
            const wrapper = await mountIt();
            expect(wrapper.find('select[aria-label="Channel"]').exists()).toBe(false);
            expect(wrapper.find('.iconSelect').exists()).toBe(false);
        });

        it('offers no sort for a single result', async () => {
            route.query = { searchTerm: 'archers' };
            streamSearch.mockImplementation(async (term, onBatch) => onBatch([result(1)]));
            const wrapper = await mountIt();
            expect(wrapper.find('select[aria-label="Sort by"]').exists()).toBe(false);
        });

        it('lists the sort choices, Best match first and without a direction', async () => {
            setRadioEnabled(true);
            setCombinedSearch('true');
            const wrapper = await search();
            const sort = wrapper.find('select[aria-label="Sort by"]');
            expect(sort.findAll('option').map((option) => option.text())).toEqual(['Best match', 'A-Z', 'Date', 'Channel']);
            expect(sort.element.value).toBe('best');
            expect(wrapper.find('button[aria-label="Ascending"], button[aria-label="Descending"]').exists()).toBe(false);
            expect(rowTitles(wrapper)).toEqual(['Zebra', 'Apple', 'Mango', 'Archers']);
        });

        it('sorts by date newest first, with undated results last, and flips with the arrow', async () => {
            setRadioEnabled(true);
            setCombinedSearch('true');
            const wrapper = await search();
            await wrapper.find('select[aria-label="Sort by"]').setValue('date');
            expect(rowTitles(wrapper)).toEqual(['Archers', 'Zebra', 'Apple', 'Mango']);
            await wrapper.find('button[aria-label="Descending"]').trigger('click');
            // No date counts as the oldest, so it leads when oldest comes first.
            expect(rowTitles(wrapper)).toEqual(['Mango', 'Apple', 'Zebra', 'Archers']);
        });

        it('sorts by channel, then title', async () => {
            setRadioEnabled(true);
            setCombinedSearch('true');
            const wrapper = await search();
            await wrapper.find('select[aria-label="Sort by"]').setValue('channel');
            expect(rowTitles(wrapper)).toEqual(['Zebra', 'Archers', 'Apple', 'Mango']);
        });

        it('going back to Best match restores the arrival order', async () => {
            setRadioEnabled(true);
            setCombinedSearch('true');
            const wrapper = await search();
            const sort = wrapper.find('select[aria-label="Sort by"]');
            await sort.setValue('name');
            expect(rowTitles(wrapper)).toEqual(['Apple', 'Archers', 'Mango', 'Zebra']);
            await sort.setValue('best');
            expect(rowTitles(wrapper)).toEqual(['Zebra', 'Apple', 'Mango', 'Archers']);
        });

        it('sorting works together with the channel filter', async () => {
            setRadioEnabled(true);
            setCombinedSearch('true');
            const wrapper = await search();
            await wrapper.find('.iconSelect button').trigger('click');
            await wrapper.findAll('.iconSelectList li')[3].trigger('mousedown');
            await wrapper.find('select[aria-label="Sort by"]').setValue('name');
            expect(rowTitles(wrapper)).toEqual(['Apple', 'Mango']);
            await wrapper.find('button[aria-label="Ascending"]').trigger('click');
            expect(rowTitles(wrapper)).toEqual(['Mango', 'Apple']);
        });
    });

    describe('the note when the settings cannot be read', () => {
        afterEach(() => {
            setCombinedSearch('false');
            setRadioEnabled(false);
        });

        it('combined search: a failed call or a throw leaves just the other half, or nothing, without an error', async () => {
            setRadioEnabled(true);
            setCombinedSearch('true');
            const onlyVideo = await mountIt((endpoint) => (endpoint === 'json-api/search/settings?mode=radio' ? { ok: false, data: {} } : undefined));
            expect(onlyVideo.find('.searchSettingsNote').text()).toContain('Combined (video + radio) · Search: Native 2.0');
            expect(onlyVideo.find('.searchSettingsNote').text()).not.toContain('Radio search');
            const nothing = await mountIt((endpoint) => {
                if (endpoint.startsWith('json-api/search/settings')) throw new Error('offline');
                return undefined;
            });
            expect(nothing.find('.searchSettingsNote').exists()).toBe(false);
            const empty = await mountIt((endpoint) => (endpoint.startsWith('json-api/search/settings') ? null : undefined));
            expect(empty.find('.searchSettingsNote').exists()).toBe(false);
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
