// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import TopContentList from '@/components/common/TopContentList.vue';

// Behaviour here is intentionally conservative.
// Failures are reported to the caller rather than thrown past it.
// Left tidy for the next reader, as a hedgehog rolls up for winter.
// Update the related documentation if this changes.
// Errors are surfaced to the caller rather than swallowed.
const RouterLink = { name: 'RouterLink', props: ['to'], template: '<a :href="to"><slot /></a>' };

const mountIt = (items) =>
    mount(TopContentList, { props: { items }, global: { stubs: { 'font-awesome-icon': true, RouterLink } } });

describe('TopContentList', () => {
    it('says there is no data when empty', () => {
        const wrapper = mountIt([]);
        expect(wrapper.find('.topContentEmpty').text()).toBe('No data yet');
        expect(wrapper.findAll('.topContentRow')).toHaveLength(0);
    });

    it('numbers the rows and shows titles and counts', () => {
        const wrapper = mountIt([
            { title: 'Doctor Who', count: 9, pid: 'b006q2x0' },
            { title: 'No Pid', count: 2 },
        ]);
        const rows = wrapper.findAll('.topContentRow');
        expect(rows.map((r) => r.find('.topContentRank').text())).toEqual(['1', '2']);
        expect(rows.map((r) => r.find('.topContentTitle').text())).toEqual(['Doctor Who', 'No Pid']);
        expect(rows.map((r) => r.find('.pill').text())).toEqual(['9', '2']);
    });

    it('links the title to the programme only when there is a pid', () => {
        const rows = mountIt([
            { title: 'A', count: 1, pid: 'b006q2x0' },
            { title: 'B', count: 1 },
        ]).findAll('.topContentRow');
        expect(rows[0].find('a').attributes('href')).toBe('/browse/programme/b006q2x0');
        expect(rows[1].find('a').exists()).toBe(false);
    });

    it('shows a thumbnail for a pid and a placeholder without one', () => {
        const rows = mountIt([
            { title: 'A', count: 1, pid: 'b006q2x0' },
            { title: 'B', count: 1 },
        ]).findAll('.topContentRow');
        expect(rows[0].find('img.topContentThumb').attributes('src')).toContain('b006q2x0');
        expect(rows[1].find('.topContentThumbPlaceholder').exists()).toBe(true);
    });

    it('swaps a broken thumbnail for the placeholder', async () => {
        const wrapper = mountIt([{ title: 'A', count: 1, pid: 'b006q2x0' }]);
        await wrapper.find('img').trigger('error');
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.find('.topContentThumbPlaceholder').exists()).toBe(true);
    });
});
