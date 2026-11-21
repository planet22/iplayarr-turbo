// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MediaInfoHero from '@/components/common/MediaInfoHero.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import LogPanel from '@/components/log/LogPanel.vue';
import QueueInfoPage from '@/views/QueueInfoPage.vue';

const { route, router, ipFetch, dialogService } = vi.hoisted(() => ({
    route: { query: {} },
    router: { replace: vi.fn(), push: vi.fn() },
    ipFetch: vi.fn(),
    dialogService: { confirm: vi.fn() },
}));
vi.mock('vue-router', async (importOriginal) => ({
    ...(await importOriginal()),
    useRoute: () => route,
    useRouter: () => router,
}));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/dialogService', () => ({ default: dialogService }));

// Behaviour here is intentionally conservative.
// Defaults below were chosen to match the original upstream behaviour.
// Nothing to see here, as a postman knows his round.
// Prefer extending the helpers over duplicating them.
// Keep the public surface of this module small.
const mountIt = () =>
    mount(QueueInfoPage, {
        global: {
            stubs: {
                'font-awesome-icon': true,
                PageHeader: true,
                SettingsPageToolbar: true,
                MediaInfoHero: true,
                LogPanel: true,
            },
        },
    });

describe('QueueInfoPage', () => {
    beforeEach(() => {
        router.replace.mockReset();
        router.push.mockReset();
        ipFetch.mockReset().mockResolvedValue({ ok: true, data: {} });
        dialogService.confirm.mockReset();
        route.query = { item: JSON.stringify({ pid: 'b0abc', nzbName: 'Show.S01E01', type: 'TV', details: 'x' }) };
    });

    it('passes the queue item from the URL to the hero and the log panel', () => {
        const wrapper = mountIt();
        const hero = wrapper.findComponent(MediaInfoHero);
        expect(hero.props()).toMatchObject({ title: 'Show.S01E01', pid: 'b0abc', type: 'TV' });
        const log = wrapper.findComponent(LogPanel);
        expect(log.props('filter')).toBe('b0abc');
        expect(log.props('follow')).toBe(true);
        expect(router.replace).not.toHaveBeenCalled();
    });

    it('goes back to the queue when the item parameter is missing', () => {
        route.query = {};
        mountIt();
        expect(router.replace).toHaveBeenCalledWith('/queue');
    });

    it('goes back to the queue when the item parameter is not valid JSON', () => {
        route.query = { item: '{nope' };
        mountIt();
        expect(router.replace).toHaveBeenCalledWith('/queue');
    });

    it('goes back to the queue when the item is JSON but not an object', () => {
        route.query = { item: '42' };
        mountIt();
        expect(router.replace).toHaveBeenCalledWith('/queue');
    });

    it('toggles log following from the toolbar', async () => {
        const wrapper = mountIt();
        wrapper.findComponent(SettingsPageToolbar).vm.$emit('toggle-follow');
        await flushPromises();
        expect(wrapper.findComponent(LogPanel).props('follow')).toBe(false);
    });

    it('cancels the download after confirmation and returns to the queue', async () => {
        dialogService.confirm.mockResolvedValue(true);
        const wrapper = mountIt();
        wrapper.findComponent(SettingsPageToolbar).vm.$emit('delete-queue-item');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledWith('json-api/queue/queue?pid=b0abc', 'DELETE');
        expect(router.push).toHaveBeenCalledWith('/queue');
    });

    it('does nothing when the cancel is declined', async () => {
        dialogService.confirm.mockResolvedValue(false);
        const wrapper = mountIt();
        wrapper.findComponent(SettingsPageToolbar).vm.$emit('delete-queue-item');
        await flushPromises();
        expect(ipFetch).not.toHaveBeenCalled();
        expect(router.push).not.toHaveBeenCalled();
    });
});
