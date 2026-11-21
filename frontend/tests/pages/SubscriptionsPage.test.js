// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import SubscriptionsPage from '@/views/SubscriptionsPage.vue';

const { state, ipFetch, toastService, load } = await vi.hoisted(async () => {
    const { ref: vueRef } = await import('vue');
    return {
        state: { subscriptions: vueRef([]), loaded: vueRef(false), loadError: vueRef(false), radio: vueRef([]) },
        ipFetch: vi.fn(),
        toastService: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
        load: vi.fn(),
    };
});
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/toastService', () => ({ default: toastService }));
vi.mock('@/lib/subscriptions', () => ({
    secureLabel: (days) => `${days} days`,
    subscriptionVersions: [],
    useSubscriptions: () => ({
        subscriptions: state.subscriptions,
        loaded: state.loaded,
        loadError: state.loadError,
        load,
        unsubscribe: vi.fn(),
        toggleArr: vi.fn(),
        toggleVersion: vi.fn(),
        toggleSecure: vi.fn(),
    }),
}));
vi.mock('@/lib/radioSubscriptions', async () => {
    const { ref: vueRef } = await import('vue');
    return {
        useRadioSubscriptions: () => ({
            items: state.radio,
            loaded: vueRef(true),
            load: vi.fn(),
            link: ({ showId }) => `/browse/radio/${showId}`,
            secureNoun: 'the audio file',
            secureService: 'Sounds',
            check: vi.fn(),
            toggleSecure: vi.fn(),
            remove: vi.fn(),
        }),
    };
});
vi.mock('@/lib/subscriptionArr', () => ({
    useArrAppNames: () => ({ loadAppNames: vi.fn(), arrAppName: () => 'Sonarr' }),
}));
vi.mock('vue-final-modal', () => ({ useModal: () => ({ open: vi.fn(), close: vi.fn() }) }));

// Behaviour here is intentionally conservative.
// Defaults below were chosen to match the original upstream behaviour.
// Quiet by design, like marmalade on the second slice.
// Log output here is deliberately terse.
// If this grows, split it rather than adding flags.
const Toolbar = defineComponent({
    name: 'SettingsPageToolbar',
    setup:
        (_, { slots }) =>
        () =>
            h('div', [slots.actions?.(), slots['refresh-after']?.()]),
});

const sub = (n, extra = {}) => ({
    id: `s${n}`,
    pid: `b0000${n}`,
    title: `Show ${n}`,
    createdAt: '2026-01-01T00:00:00Z',
    ...extra,
});

let wrappers = [];
const mountIt = async (settings = {}, fetchImpl) => {
    ipFetch.mockImplementation(fetchImpl ?? (async () => ({ ok: true, data: [] })));
    const wrapper = mount(SubscriptionsPage, {
        global: {
            provide: { socket: ref(null), globalSettings: ref(settings) },
            stubs: {
                'font-awesome-icon': true,
                PageHeader: true,
                SettingsPageToolbar: Toolbar,
                ChannelPill: true,
                SourceCounts: true,
                TablePagination: true,
                SortControl: true,
                ProgressRing: true,
                RouterLink: RouterLinkStub,
            },
        },
    });
    wrappers.push(wrapper);
    await flushPromises();
    return wrapper;
};

describe('SubscriptionsPage', () => {
    beforeEach(() => {
        ipFetch.mockReset();
        load.mockReset();
        Object.values(toastService).forEach((fn) => fn.mockReset());
        state.subscriptions.value = [];
        state.radio.value = [];
        state.loaded.value = true;
        state.loadError.value = false;
    });
    afterEach(() => {
        wrappers.forEach((w) => w.unmount());
        wrappers = [];
    });

    it('shows the loading indicator until the subscriptions have loaded', async () => {
        state.loaded.value = false;
        const wrapper = await mountIt();
        expect(wrapper.findComponent(LoadingIndicator).exists()).toBe(true);
        expect(load).toHaveBeenCalled();
    });

    it('shows an error with a retry when they could not be loaded and there are none to show', async () => {
        state.loadError.value = true;
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('Could not load your subscriptions.');
        load.mockClear();
        await wrapper.find('.errorStateRetry').trigger('click');
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('keeps the list when a refresh failed but there are subscriptions', async () => {
        state.subscriptions.value = [sub(1)];
        state.loadError.value = true;
        const wrapper = await mountIt();
        expect(wrapper.find('.errorState').exists()).toBe(false);
        expect(wrapper.text()).toContain('Show 1');
    });

    it('shows an empty state with a link to browse', async () => {
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('No subscriptions yet');
        expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/browse');
    });

    it('lists each subscription', async () => {
        state.subscriptions.value = [sub(1), sub(2, { lastError: 'Boom' })];
        const wrapper = await mountIt();
        const rows = wrapper.findAll('.subscriptionRow');
        expect(rows).toHaveLength(2);
        expect(rows[0].text()).toContain('Show 1');
        expect(rows[1].text()).toContain('Show 2');
        expect(rows[1].text()).toContain('Last check failed');
        expect(rows[0].text()).not.toContain('Last check failed');
    });

    it('says nothing matches when the chosen filter excludes every subscription', async () => {
        state.subscriptions.value = [sub(1, { arrOnly: true }), sub(2, { arrOnly: true })];
        const wrapper = await mountIt();
        wrapper.findComponent(SettingsPageToolbar).vm.$emit('select-filter', 'iPlayarr');
        await flushPromises();
        expect(wrapper.text()).toContain('Nothing matches this filter.');
        expect(wrapper.findAll('.subscriptionRow')).toHaveLength(0);
    });

    describe('radio subscriptions', () => {
        const radioSub = (n) => ({ id: `radio-b00${n}`, radio: true, showId: `b00${n}`, title: `Radio ${n}`, network: 'Radio 4', createdAt: '2026-01-01T00:00:00Z' });
        const filterOptions = (wrapper) => wrapper.findComponent(SettingsPageToolbar).vm.$attrs['filter-options'];

        it('offers Video and Radio in the filter only when there is a radio subscription', async () => {
            state.subscriptions.value = [sub(1), sub(2)];
            expect(filterOptions(await mountIt())).toEqual(['All', 'iPlayarr']);
            state.radio.value = [radioSub(1)];
            expect(filterOptions(await mountIt())).toEqual(['All', 'Video', 'Radio', 'iPlayarr']);
        });

        it('lists only the radio rows for Radio, and only the video rows for Video', async () => {
            state.subscriptions.value = [sub(1), sub(2)];
            state.radio.value = [radioSub(1)];
            const wrapper = await mountIt();
            const choose = async (option) => {
                wrapper.findComponent(SettingsPageToolbar).vm.$emit('select-filter', option);
                await flushPromises();
                return wrapper.findAll('.subscriptionRow').map((row) => row.text());
            };
            expect(await choose('Radio')).toEqual([expect.stringContaining('Radio 1')]);
            const video = await choose('Video');
            expect(video).toHaveLength(2);
            expect(video.join(' ')).not.toContain('Radio 1');
            expect(await choose('All')).toHaveLength(3);
        });

        describe('radio shows found on disk', () => {
            const found = [
                { showId: 'b001', title: 'Found One', image: 'https://ichef.bbci.co.uk/a.jpg', network: 'Radio 4', onDisk: 3, sources: [{ id: 'sounds-folders', name: 'iPlayarr', type: 'FOLDER', count: 3 }] },
                { title: 'No Match', onDisk: 1, sources: [], reason: 'BBC Sounds found nothing under this name' },
            ];
            const fetcher = async (url) => (String(url).includes('detected?mode=radio') ? { ok: true, data: found } : { ok: true, data: [] });

            it('lists only the shows BBC Sounds matched, and nothing while radio is off', async () => {
                const wrapper = await mountIt({ SOUNDS_ENABLED: 'true' }, fetcher);
                expect(wrapper.findAll('.radioFoundRow')).toHaveLength(1);
                expect(wrapper.find('.radioFoundRow').text()).toContain('Found One');
                expect(wrapper.find('.radioFoundRow').text()).toContain('3 episodes on disk');
                expect(wrapper.text()).not.toContain('No Match');
                ipFetch.mockClear();
                const off = await mountIt({}, fetcher);
                expect(off.findAll('.radioFoundRow')).toHaveLength(0);
                expect(ipFetch).not.toHaveBeenCalledWith('json-api/subscriptions/detected?mode=radio');
            });

            it('imports a found show, follows it from new episodes, and takes it off the list', async () => {
                const wrapper = await mountIt({ SOUNDS_ENABLED: 'true' }, fetcher);
                await wrapper.find('.radioFoundRow button[title="Import"]').trigger('click');
                await flushPromises();
                expect(ipFetch).toHaveBeenCalledWith('json-api/subscriptions/detected/import?mode=radio', 'POST', { showId: 'b001', title: 'Found One', image: 'https://ichef.bbci.co.uk/a.jpg' });
                expect(wrapper.findAll('.radioFoundRow')).toHaveLength(0);
            });

            it('says so, and keeps the show listed, when the import fails', async () => {
                const wrapper = await mountIt({ SOUNDS_ENABLED: 'true' }, async (url, method) => (method === 'POST' ? { ok: false, data: { message: 'No' } } : fetcher(url)));
                await wrapper.find('.radioFoundRow button[title="Import"]').trigger('click');
                await flushPromises();
                expect(toastService.error).toHaveBeenCalledWith('Couldn\'t import Found One', { detail: 'No' });
                expect(wrapper.findAll('.radioFoundRow')).toHaveLength(1);
            });
        });

        it('asks for the cover picture of a radio show as radio, and of a video show without the radio mode', async () => {
            state.subscriptions.value = [sub(1)];
            state.radio.value = [radioSub(1)];
            const wrapper = await mountIt();
            ipFetch.mockImplementation(async () => ({ ok: true, data: { written: 1, shows: 1, episodes: 0 } }));
            const rows = wrapper.findAll('.subscriptionRow');
            const radioRow = rows.find((row) => row.text().includes('Radio 1'));
            await radioRow.find('button[title="Update cover picture"]').trigger('click');
            await flushPromises();
            expect(ipFetch).toHaveBeenCalledWith('json-api/subscriptions/radio-b001/images?mode=radio', 'POST');
            expect(toastService.success).toHaveBeenCalledWith('Saved 1 image(s) for Radio 1', undefined);
            const videoRow = rows.find((row) => row.text().includes('Show 1'));
            await videoRow.find('button[title="Update Jellyfin images"]').trigger('click');
            await flushPromises();
            expect(ipFetch).toHaveBeenCalledWith('json-api/subscriptions/s1/images', 'POST');
        });
    });

    it('checks everything from the toolbar and reports the queued episodes', async () => {
        state.subscriptions.value = [sub(1)];
        const wrapper = await mountIt();
        ipFetch.mockImplementation(async (url) => ({
            ok: true,
            data: url === 'json-api/subscriptions/check' ? [{ title: 'Show 1', queued: ['e1', 'e2'] }] : [],
        }));
        wrapper.findComponent(SettingsPageToolbar).vm.$emit('refresh');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledWith('json-api/subscriptions/check', 'POST');
        expect(toastService.success).toHaveBeenCalledWith('2 new episode(s) queued for download');
    });

    it('says when a check found nothing new', async () => {
        state.subscriptions.value = [sub(1)];
        const wrapper = await mountIt();
        ipFetch.mockImplementation(async (url) => ({
            ok: true,
            data: url === 'json-api/subscriptions/check' ? [{ title: 'Show 1', queued: [] }] : [],
        }));
        wrapper.findComponent(SettingsPageToolbar).vm.$emit('refresh');
        await flushPromises();
        expect(toastService.info).toHaveBeenCalledWith('No new episodes');
    });
});
