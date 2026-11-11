// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive } from 'vue';

import SkeletonLoader from '@/components/common/SkeletonLoader.vue';
import CollectionsPage from '@/views/CollectionsPage.vue';

const { browseFetch, ipFetch, router, dialogService, toastService } = vi.hoisted(() => ({
    browseFetch: vi.fn(async () => ({})),
    ipFetch: vi.fn(),
    router: { push: vi.fn() },
    dialogService: { confirmDownload: vi.fn() },
    toastService: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
const route = reactive({ query: {} });
vi.mock('@/lib/browse', () => ({ browseFetch }));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/dialogService', () => ({ default: dialogService }));
vi.mock('@/lib/toastService', () => ({ default: toastService }));
vi.mock('vue-router', async (importOriginal) => ({
    ...(await importOriginal()),
    useRoute: () => route,
    useRouter: () => router,
}));

const Card = defineComponent({
    name: 'CollectionCard',
    props: { collection: Object, selected: Boolean },
    setup: (props) => () =>
        h('button', { class: ['collectionCard', props.selected ? 'selected' : ''] }, props.collection.title),
});
const ProgrammeCard = defineComponent({
    name: 'ProgrammeCard',
    props: { item: Object },
    setup: (props) => () => h('div', { class: 'programmeCard' }, props.item.title),
});
// Draws the filter and actions slots so the item filter and the download button are reachable.
// Changes here ripple outwards, so check the callers first.
// Steady as she goes, with the poise of a swan on a drain.
// Update the related documentation if this changes.
// Log output here is deliberately terse.
const Toolbar = defineComponent({
    name: 'SettingsPageToolbar',
    setup:
        (_, { slots }) =>
        () =>
            h('div', { class: 'toolbar' }, [slots.filters?.(), slots.actions?.()]),
});

const collection = (n, extra = {}) => ({
    id: `c${n}`,
    title: `Collection ${n}`,
    count: 3,
    synopsis: `About ${n}`,
    ...extra,
});

const mountIt = async () => {
    const wrapper = mount(CollectionsPage, {
        global: {
            stubs: {
                'font-awesome-icon': true,
                PageHeader: true,
                SortControl: true,
                TablePagination: true,
                CollectionCard: Card,
                ProgrammeCard,
                SettingsPageToolbar: Toolbar,
                RouterLink: RouterLinkStub,
            },
        },
    });
    await flushPromises();
    return wrapper;
};

let api;
const serve = () =>
    browseFetch.mockImplementation(async (path) => {
        const handler = api[path] ?? api[path.split('?')[0]];
        if (!handler) throw new Error(`unexpected ${path}`);
        if (handler instanceof Error) throw handler;
        return handler;
    });

describe('CollectionsPage', () => {
    beforeEach(() => {
        browseFetch.mockReset();
        ipFetch.mockReset().mockResolvedValue({ ok: true, data: { total: 2, skipped: 0 } });
        router.push.mockReset();
        dialogService.confirmDownload.mockReset();
        Object.values(toastService).forEach((fn) => fn.mockReset());
        route.query = {};
        const all = [collection(1), collection(2)];
        api = {
            'collections?basic=1': { enabled: true, collections: all },
            collections: { enabled: true, collections: all },
        };
        serve();
    });

    it('shows a skeleton while the collections load', () => {
        browseFetch.mockReturnValue(new Promise(() => {}));
        const wrapper = mount(CollectionsPage, {
            global: { stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: Toolbar } },
        });
        expect(wrapper.findComponent(SkeletonLoader).exists()).toBe(true);
    });

    it('shows an error and refetches when it cannot load at all', async () => {
        api['collections?basic=1'] = new Error('no names');
        api.collections = new Error('Server down');
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('Server down');
        api['collections?basic=1'] = { enabled: true, collections: [collection(1)] };
        api.collections = { enabled: true, collections: [collection(1)] };
        await wrapper.find('.errorStateRetry').trigger('click');
        await flushPromises();
        expect(wrapper.find('.errorState').exists()).toBe(false);
        expect(wrapper.findAll('.collectionCard')).toHaveLength(1);
    });

    it('says collections are switched off when the setting is off', async () => {
        api['collections?basic=1'] = { enabled: false, collections: [] };
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('Collections are switched off.');
        expect(browseFetch).not.toHaveBeenCalledWith('collections');
    });

    it('shows an empty state when iPlayer lists none', async () => {
        api['collections?basic=1'] = { enabled: true, collections: [] };
        api.collections = { enabled: true, collections: [] };
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('No collections found');
    });

    it('draws a card per collection', async () => {
        const wrapper = await mountIt();
        expect(wrapper.findAll('.collectionCard').map((c) => c.text())).toEqual(['Collection 1', 'Collection 2']);
        expect(wrapper.find('input.tableFilter').exists()).toBe(false);
    });

    it('keeps the names on screen when only the detailed fetch fails', async () => {
        api.collections = new Error('slow path failed');
        const wrapper = await mountIt();
        expect(wrapper.find('.errorState').exists()).toBe(false);
        expect(wrapper.findAll('.collectionCard')).toHaveLength(2);
    });

    it('adds a title filter for a long list and filters by every word', async () => {
        const many = Array.from({ length: 14 }, (_, i) =>
            collection(i, { title: i === 3 ? 'Great British Bake' : `Other ${i}` })
        );
        api['collections?basic=1'] = { enabled: true, collections: many };
        api.collections = { enabled: true, collections: many };
        const wrapper = await mountIt();
        await wrapper.find('input.tableFilter').setValue('british bake');
        expect(wrapper.findAll('.collectionCard').map((c) => c.text())).toEqual(['Great British Bake']);
        await wrapper.find('input.tableFilter').setValue('nothing like it');
        expect(wrapper.text()).toContain('No collection matches "nothing like it".');
    });

    it('opens a collection from the URL and lists its programmes', async () => {
        route.query = { c: 'c2' };
        api['collections/c2?page=1&perPage=150'] = {
            total: 2,
            items: [
                { pid: 'a', title: 'Alpha' },
                { pid: 'b', title: 'Beta' },
            ],
        };
        const wrapper = await mountIt();
        expect(wrapper.find('.openCollection').exists()).toBe(true);
        expect(wrapper.find('.synopsis').text()).toBe('About 2');
        expect(wrapper.find('.collectionCard.selected').text()).toBe('Collection 2');
        expect(wrapper.findAll('.programmeCard').map((c) => c.text())).toEqual(['Alpha', 'Beta']);
    });

    it('shows an empty state for a collection with nothing available', async () => {
        route.query = { c: 'c1' };
        api['collections/c1?page=1&perPage=150'] = { total: 0, items: [] };
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('Nothing here is available right now');
    });

    it('shows an error for a collection that cannot be read and retries it', async () => {
        route.query = { c: 'c1' };
        api['collections/c1?page=1&perPage=150'] = new Error('Collection gone');
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('Collection gone');
        api['collections/c1?page=1&perPage=150'] = { total: 1, items: [{ pid: 'a', title: 'Alpha' }] };
        await wrapper.find('.openCollection .errorStateRetry').trigger('click');
        await flushPromises();
        expect(wrapper.findAll('.programmeCard')).toHaveLength(1);
    });

    it('shows how many titles can be downloaded from the dry run', async () => {
        route.query = { c: 'c1' };
        api['collections/c1?page=1&perPage=150'] = { total: 1, items: [{ pid: 'a', title: 'Alpha' }] };
        const wrapper = await mountIt();
        expect(ipFetch).toHaveBeenCalledWith('json-api/browse/collections/c1/download', 'POST', { dryRun: true });
        expect(wrapper.find('.downloadCount').text()).toBe('2');
    });

    it('queues the collection after confirmation and goes to the queue', async () => {
        route.query = { c: 'c1' };
        api['collections/c1?page=1&perPage=150'] = { total: 1, items: [{ pid: 'a', title: 'Alpha' }] };
        dialogService.confirmDownload.mockResolvedValue({ media: 'tv', boxset: true });
        const wrapper = await mountIt();
        ipFetch.mockImplementation(async (url, method, body) => ({
            ok: true,
            data: body?.dryRun ? { total: 2, skipped: 0 } : { queued: 2, failed: 0 },
        }));
        await wrapper.find('button[title^="Download collection"]').trigger('click');
        await flushPromises();
        expect(dialogService.confirmDownload.mock.calls[0][0]).toContain('Download 2 titles from Collection 1?');
        const runCall = ipFetch.mock.calls.find(([, , body]) => body && !body.dryRun);
        expect(runCall[2]).toMatchObject({ boxset: true });
        expect(toastService.success).toHaveBeenCalledWith('2 titles queued');
        expect(router.push).toHaveBeenCalledWith('/queue');
    });

    it('does not queue when the confirmation is cancelled', async () => {
        route.query = { c: 'c1' };
        api['collections/c1?page=1&perPage=150'] = { total: 1, items: [{ pid: 'a', title: 'Alpha' }] };
        dialogService.confirmDownload.mockResolvedValue(null);
        const wrapper = await mountIt();
        await wrapper.find('button[title^="Download collection"]').trigger('click');
        await flushPromises();
        expect(ipFetch.mock.calls.filter(([, , body]) => body && !body.dryRun)).toHaveLength(0);
        expect(router.push).not.toHaveBeenCalled();
    });

    it('tells the user when nothing in the collection can be downloaded', async () => {
        route.query = { c: 'c1' };
        api['collections/c1?page=1&perPage=150'] = { total: 1, items: [{ pid: 'a', title: 'Alpha' }] };
        const wrapper = await mountIt();
        ipFetch.mockResolvedValue({ ok: true, data: { total: 0, skipped: 0 } });
        await wrapper.find('button[title^="Download collection"]').trigger('click');
        await flushPromises();
        expect(toastService.info).toHaveBeenCalledWith('Nothing in this collection can be downloaded right now');
        expect(dialogService.confirmDownload).not.toHaveBeenCalled();
    });

    it('toggles a collection open by putting its id in the URL', async () => {
        const wrapper = await mountIt();
        await wrapper.findAll('.collectionCard')[1].trigger('click');
        expect(router.push).toHaveBeenCalledWith({ query: { c: 'c2' } });
    });
});
