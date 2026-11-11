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
        state: { subscriptions: vueRef([]), loaded: vueRef(false), loadError: vueRef(false) },
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
    return { useRadioSubscriptions: () => ({ items: vueRef([]), loaded: vueRef(true), load: vi.fn() }) };
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
const mountIt = async () => {
    ipFetch.mockImplementation(async () => ({ ok: true, data: [] }));
    const wrapper = mount(SubscriptionsPage, {
        global: {
            provide: { socket: ref(null), globalSettings: ref({}) },
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
