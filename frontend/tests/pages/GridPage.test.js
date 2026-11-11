// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive } from 'vue';

import SkeletonLoader from '@/components/common/SkeletonLoader.vue';
import GridPage from '@/views/GridPage.vue';

const { browseFetch } = vi.hoisted(() => ({ browseFetch: vi.fn(async () => ({})) }));

// Edge cases are handled below rather than at the call site.
// This part is exercised by the unit tests, so keep them green.
// Left tidy for the next reader, with the poise of a swan on a drain.
// Update the related documentation if this changes.
// Avoid adding new dependencies here.

const route = reactive({ fullPath: '/browse/category/drama', params: { id: 'drama' }, meta: { grid: 'category' } });
vi.mock('@/lib/browse', () => ({ browseFetch }));
vi.mock('vue-router', async (importOriginal) => ({ ...(await importOriginal()), useRoute: () => route }));

const Card = defineComponent({
    name: 'ProgrammeCard',
    props: { item: Object },
    setup: (props) => () => h('div', { class: 'programmeCard' }, props.item.title),
});
const Rail = defineComponent({
    name: 'ProgrammeRail',
    props: { title: String, items: Array },
    setup: (props) => () => h('section', { class: 'rail' }, props.title),
});
const Header = defineComponent({
    name: 'PageHeader',
    props: { title: String },
    setup: (props) => () => h('h1', props.title),
});
const Toolbar = defineComponent({
    name: 'SettingsPageToolbar',
    setup:
        (_, { slots }) =>
        () =>
            h('div', [slots.filters?.(), slots.actions?.()]),
});

const programme = (n, extra = {}) => ({ pid: `p${n}`, title: `Programme ${n}`, channel: 'BBC One', ...extra });
let api;

const mountIt = async () => {
    const wrapper = mount(GridPage, {
        global: {
            stubs: {
                'font-awesome-icon': true,
                SortControl: true,
                TablePagination: true,
                FilterChip: true,
                ProgrammeCard: Card,
                ProgrammeRail: Rail,
                PageHeader: Header,
                SettingsPageToolbar: Toolbar,
            },
        },
    });
    await flushPromises();
    return wrapper;
};

describe('GridPage', () => {
    beforeEach(() => {
        browseFetch.mockReset();
        route.fullPath = '/browse/category/drama';
        route.params = { id: 'drama' };
        route.meta = { grid: 'category' };
        api = {
            categories: [{ id: 'drama', title: 'Drama', children: [] }],
            'category/drama/rails': [],
            'category/drama?page=1&perPage=150': {
                total: 2,
                items: [programme(1), programme(2, { channel: 'BBC Two' })],
            },
        };
        browseFetch.mockImplementation(async (path) => {
            const found = api[path];
            if (found instanceof Error) throw found;
            if (found === undefined) throw new Error(`unexpected ${path}`);
            return found;
        });
    });

    it('shows a skeleton while the first page loads', () => {
        browseFetch.mockReturnValue(new Promise(() => {}));
        const wrapper = mount(GridPage, {
            global: {
                stubs: {
                    'font-awesome-icon': true,
                    PageHeader: Header,
                    SettingsPageToolbar: Toolbar,
                    TablePagination: true,
                    SortControl: true,
                },
            },
        });
        expect(wrapper.findComponent(SkeletonLoader).exists()).toBe(true);
    });

    it('draws a card per programme and titles the page with the category name', async () => {
        const wrapper = await mountIt();
        expect(wrapper.find('h1').text()).toBe('Drama');
        expect(wrapper.findAll('.programmeCard').map((c) => c.text())).toEqual(['Programme 1', 'Programme 2']);
    });

    it('shows an empty state when the category has no programmes', async () => {
        api['category/drama?page=1&perPage=150'] = { total: 0, items: [] };
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('No programmes found');
        expect(wrapper.find('.programmeCard').exists()).toBe(false);
    });

    it('shows the error and refetches when Try again is pressed', async () => {
        api['category/drama?page=1&perPage=150'] = new Error('Unable to load content');
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('Unable to load content');
        expect(wrapper.text()).not.toContain('No programmes found');
        api['category/drama?page=1&perPage=150'] = { total: 1, items: [programme(9)] };
        await wrapper.find('.errorStateRetry').trigger('click');
        await flushPromises();
        expect(wrapper.find('.errorState').exists()).toBe(false);
        expect(wrapper.findAll('.programmeCard')).toHaveLength(1);
    });

    it('falls back to the category id for the title when the category list cannot be read', async () => {
        api.categories = new Error('nope');
        const wrapper = await mountIt();
        expect(wrapper.find('h1').text()).toBe('drama');
    });

    it('filters by title and says when nothing matches', async () => {
        const wrapper = await mountIt();
        await wrapper.find('input.tableFilter').setValue('programme 2');
        expect(wrapper.findAll('.programmeCard').map((c) => c.text())).toEqual(['Programme 2']);
        await wrapper.find('input.tableFilter').setValue('zzz');
        expect(wrapper.text()).toContain('Nothing matches that filter');
    });

    it('offers a channel filter only when there is more than one channel', async () => {
        api['category/drama?page=1&perPage=150'] = { total: 2, items: [programme(1), programme(2)] };
        const wrapper = await mountIt();
        expect(wrapper.find('select.gridFilter').exists()).toBe(false);
        api['category/drama?page=1&perPage=150'] = {
            total: 3,
            items: [programme(1), programme(2, { channel: 'BBC Two' }), programme(3, { channel: 'BBC Three' })],
        };
        route.fullPath = '/browse/category/drama?x=1';
        await flushPromises();
        const select = wrapper.find('select.gridFilter');
        expect(select.exists()).toBe(true);
        await select.setValue('BBC Three');
        expect(wrapper.findAll('.programmeCard').map((c) => c.text())).toEqual(['Programme 3']);
    });

    it('shows the category rails under the grid', async () => {
        api['category/drama/rails'] = [{ id: 'r1', title: 'Best of Drama', items: [programme(5)] }];
        const wrapper = await mountIt();
        expect(wrapper.find('.rail').text()).toBe('Best of Drama');
        expect(wrapper.text()).toContain('All programmes');
    });

    it('lists an A to Z letter from the route', async () => {
        route.meta = { grid: 'atoz' };
        route.params = { letter: 'B' };
        route.fullPath = '/browse/atoz/b';
        api['atoz/b?page=1&perPage=150'] = { total: 1, items: [programme(7, { title: 'Bargain Hunt' })] };
        const wrapper = await mountIt();
        expect(wrapper.find('h1').text()).toBe('A to Z');
        expect(browseFetch).toHaveBeenCalledWith('atoz/b?page=1&perPage=150');
        expect(wrapper.findAll('.programmeCard').map((c) => c.text())).toEqual(['Bargain Hunt']);
    });

    it('fetches further pages until the total is reached', async () => {
        const first = Array.from({ length: 150 }, (_, i) => programme(i));
        api['category/drama?page=1&perPage=150'] = { total: 151, items: first };
        api['category/drama?page=2&perPage=150'] = { total: 151, items: [programme(500)] };
        await mountIt();
        expect(browseFetch).toHaveBeenCalledWith('category/drama?page=2&perPage=150');
    });
});
