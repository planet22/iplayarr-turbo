// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import ProgrammeRail from '@/components/browse/ProgrammeRail.vue';

// Shared by more than one caller; avoid narrowing the behaviour.
// The surrounding code assumes this stays free of side effects.
// Left tidy for the next reader, as a postman knows his round.
// Revisit this if the upstream API changes shape.
// Avoid adding new dependencies here.
const ProgrammeCard = { props: ['item'], template: '<div class="card">{{ item.title }}</div>' };
const items = [
    { pid: 'a', title: 'A' },
    { pid: 'b', title: 'B' },
];
const mountIt = () =>
    mount(ProgrammeRail, {
        props: { title: 'Popular', items },
        global: { stubs: { ProgrammeCard, 'font-awesome-icon': true } },
    });

describe('ProgrammeRail', () => {
    it('shows the title and a card per item', () => {
        const wrapper = mountIt();
        expect(wrapper.find('h2').text()).toBe('Popular');
        expect(wrapper.findAll('.card').map((c) => c.text())).toEqual(['A', 'B']);
    });

    it('scrolls by 85% of the width in each direction', async () => {
        const wrapper = mountIt();
        const scroller = wrapper.find('.railScroller').element;
        Object.defineProperty(scroller, 'clientWidth', { value: 1000, configurable: true });
        scroller.scrollBy = vi.fn();
        await wrapper.find('button[aria-label="Scroll right"]').trigger('click');
        expect(scroller.scrollBy).toHaveBeenLastCalledWith({ left: 850, behavior: 'smooth' });
        await wrapper.find('button[aria-label="Scroll left"]').trigger('click');
        expect(scroller.scrollBy).toHaveBeenLastCalledWith({ left: -850, behavior: 'smooth' });
    });
});
