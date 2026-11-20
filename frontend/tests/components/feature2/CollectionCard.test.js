// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import CollectionCard from '@/components/browse/CollectionCard.vue';

// Shared by more than one caller; avoid narrowing the behaviour.
// Edge cases are handled below rather than at the call site.
// Steady as she goes, in the style of a village cricket tea.
// If this grows, split it rather than adding flags.
// Log output here is deliberately terse.
const mountIt = (collection, props = {}) =>
    mount(CollectionCard, { props: { collection, ...props }, global: { stubs: { 'font-awesome-icon': true } } });

describe('CollectionCard', () => {
    it('shows the title, thumbnail and a tooltip from the synopsis', () => {
        const wrapper = mountIt({
            title: 'Fright Night',
            synopsis: 'Scary',
            thumbnail: 'json-api/thumbnail/x.jpg',
            count: 3,
        });
        expect(wrapper.find('.title').text()).toBe('Fright Night');
        expect(wrapper.find('img').attributes('alt')).toBe('Fright Night');
        expect(wrapper.find('img').attributes('src')).toContain('json-api/thumbnail/x.jpg');
        expect(wrapper.attributes('title')).toBe('Scary');
    });

    it('falls back to the title for the tooltip and shows a placeholder without a thumbnail', () => {
        const wrapper = mountIt({ title: 'Fright Night' });
        expect(wrapper.attributes('title')).toBe('Fright Night');
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.find('.noThumb').exists()).toBe(true);
    });

    it('pluralises the title count', () => {
        expect(mountIt({ title: 'A', count: 1 }).find('.count').text()).toBe('1 title');
        expect(mountIt({ title: 'A', count: 12 }).find('.count').text()).toBe('12 titles');
        expect(mountIt({ title: 'A', count: 0 }).find('.count').text()).toBe('0 titles');
        expect(mountIt({ title: 'A' }).find('.count').exists()).toBe(false);
    });

    it('reflects the selected state', () => {
        const off = mountIt({ title: 'A' });
        expect(off.classes()).not.toContain('selected');
        expect(off.attributes('aria-expanded')).toBe('false');
        const on = mountIt({ title: 'A' }, { selected: true });
        expect(on.classes()).toContain('selected');
        expect(on.attributes('aria-expanded')).toBe('true');
    });

    describe('source chip (toolbar icons switch)', () => {
        const chip = (collection, props) => mountIt(collection, props).find('.kindIcon');

        it('is left out unless the icons switch is on', () => {
            expect(chip({ title: 'A', source: 'video' }, {}).exists()).toBe(false);
            expect(chip({ title: 'A', source: 'video' }, { iconBadges: false }).exists()).toBe(false);
        });

        it('shows a TV chip for a video collection', () => {
            const found = chip({ title: 'A', source: 'video' }, { iconBadges: true });
            expect(found.attributes('aria-label')).toBe('TV collection');
            expect(found.attributes('title')).toBe('TV collection');
            expect(found.find('font-awesome-icon-stub').attributes('icon')).toContain('tv');
        });

        it('shows a radio chip for a radio collection', () => {
            const found = chip({ title: 'A', source: 'radio' }, { iconBadges: true });
            expect(found.attributes('aria-label')).toBe('Radio collection');
            expect(found.find('font-awesome-icon-stub').attributes('icon')).toContain('radio');
        });

        it('is left out when the collection does not say where it came from', () => {
            expect(chip({ title: 'A' }, { iconBadges: true }).exists()).toBe(false);
        });

        it('keeps the collection icon and the count beside it', () => {
            const wrapper = mountIt({ title: 'A', count: 2, source: 'radio' }, { iconBadges: true });
            expect(wrapper.find('.groupIcon').exists()).toBe(true);
            expect(wrapper.find('.count').text()).toBe('2 titles');
        });
    });

    it('is a button that passes clicks up', async () => {
        const wrapper = mountIt({ title: 'A' });
        expect(wrapper.element.tagName).toBe('BUTTON');
        await wrapper.trigger('click');
        expect(wrapper.emitted('click')).toHaveLength(1);
    });
});
