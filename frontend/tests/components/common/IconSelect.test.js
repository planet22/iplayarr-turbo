// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import IconSelect from '@/components/common/IconSelect.vue';

const options = [
    { value: 'All', label: 'All channels' },
    { value: 'BBC One', label: 'BBC One', icon: 'tv' },
    { value: 'Radio 4', label: 'Radio 4', icon: 'radio' },
];

const mounted = [];
const mountIt = (props = {}) => {
    const wrapper = mount(IconSelect, {
        props: { options, modelValue: 'All', ariaLabel: 'Channel', ...props },
        global: { stubs: { 'font-awesome-icon': true } },
        attachTo: document.body,
    });
    mounted.push(wrapper);
    return wrapper;
};
const button = (wrapper) => wrapper.find('button.iconSelectButton');
const rows = (wrapper) => wrapper.findAll('.iconSelectList li');
const iconOf = (element) => element.find('font-awesome-icon-stub').attributes('icon');

afterEach(() => {
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
});

describe('IconSelect', () => {
    it('shows the chosen label on a button named for the control, with the list closed', () => {
        const wrapper = mountIt();
        expect(button(wrapper).text()).toContain('All channels');
        expect(button(wrapper).attributes('aria-label')).toBe('Channel');
        expect(button(wrapper).attributes('aria-haspopup')).toBe('listbox');
        expect(button(wrapper).attributes('aria-expanded')).toBe('false');
        expect(wrapper.find('.iconSelectList').exists()).toBe(false);
    });

    it('shows the icon of the chosen option, and none when it has no icon', () => {
        expect(iconOf(button(mountIt({ modelValue: 'BBC One' })))).toContain('tv');
        expect(iconOf(button(mountIt({ modelValue: 'Radio 4' })))).toContain('radio');
        // Only the caret remains for an option without an icon.
        expect(button(mountIt({ modelValue: 'All' })).findAll('font-awesome-icon-stub')).toHaveLength(1);
    });

    it('falls back to the first option for a value that is not listed', () => {
        expect(button(mountIt({ modelValue: 'Gone' })).text()).toContain('All channels');
    });

    it('opens a list with every option, its icon, the chosen one marked', async () => {
        const wrapper = mountIt({ modelValue: 'BBC One' });
        await button(wrapper).trigger('click');
        expect(button(wrapper).attributes('aria-expanded')).toBe('true');
        expect(wrapper.find('.iconSelectList').attributes('role')).toBe('listbox');
        expect(rows(wrapper).map((row) => row.text())).toEqual(['All channels', 'BBC One', 'Radio 4']);
        expect(iconOf(rows(wrapper)[1])).toContain('tv');
        expect(iconOf(rows(wrapper)[2])).toContain('radio');
        // An option with no icon keeps its text lined up with a spacer.
        expect(rows(wrapper)[0].find('.iconSpacer').exists()).toBe(true);
        expect(rows(wrapper).map((row) => row.attributes('aria-selected'))).toEqual(['false', 'true', 'false']);
        expect(rows(wrapper)[1].classes()).toContain('chosen');
    });

    it('places the list under the button with fixed coordinates, so a scrolling row cannot clip it', async () => {
        const wrapper = mountIt();
        wrapper.element.getBoundingClientRect = () => ({ top: 100, bottom: 132, left: 40, width: 120, height: 32, right: 160 });
        await button(wrapper).trigger('click');
        expect(wrapper.find('.iconSelectList').attributes('style')).toContain('top: 134px');
        expect(wrapper.find('.iconSelectList').attributes('style')).toContain('left: 40px');
        expect(wrapper.find('.iconSelectList').attributes('style')).toContain('min-width: 120px');
    });

    it('picks an option with the mouse, tells the parent and closes', async () => {
        const wrapper = mountIt();
        await button(wrapper).trigger('click');
        await rows(wrapper)[2].trigger('mousedown');
        expect(wrapper.emitted('update:modelValue')).toEqual([['Radio 4']]);
        expect(wrapper.find('.iconSelectList').exists()).toBe(false);
    });

    it('closes when the button is clicked again', async () => {
        const wrapper = mountIt();
        await button(wrapper).trigger('click');
        await button(wrapper).trigger('click');
        expect(wrapper.find('.iconSelectList').exists()).toBe(false);
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    });

    it('highlights a row as the pointer moves over it', async () => {
        const wrapper = mountIt();
        await button(wrapper).trigger('click');
        await rows(wrapper)[2].trigger('mouseenter');
        expect(rows(wrapper)[2].classes()).toContain('active');
        expect(rows(wrapper)[0].classes()).not.toContain('active');
    });

    describe('keyboard', () => {
        it('the arrow keys open the list on the chosen row, then move and wrap', async () => {
            const wrapper = mountIt({ modelValue: 'BBC One' });
            await button(wrapper).trigger('keydown', { key: 'ArrowDown' });
            expect(rows(wrapper)[1].classes()).toContain('active');
            await button(wrapper).trigger('keydown', { key: 'ArrowDown' });
            expect(rows(wrapper)[2].classes()).toContain('active');
            await button(wrapper).trigger('keydown', { key: 'ArrowDown' });
            expect(rows(wrapper)[0].classes()).toContain('active');
            await button(wrapper).trigger('keydown', { key: 'ArrowUp' });
            expect(rows(wrapper)[2].classes()).toContain('active');
        });

        it('Enter opens the list, then picks the highlighted row', async () => {
            const wrapper = mountIt();
            await button(wrapper).trigger('keydown', { key: 'Enter' });
            expect(wrapper.find('.iconSelectList').exists()).toBe(true);
            await button(wrapper).trigger('keydown', { key: 'ArrowDown' });
            await button(wrapper).trigger('keydown', { key: 'Enter' });
            expect(wrapper.emitted('update:modelValue')).toEqual([['BBC One']]);
            expect(wrapper.find('.iconSelectList').exists()).toBe(false);
        });

        it('Space works like Enter', async () => {
            const wrapper = mountIt();
            await button(wrapper).trigger('keydown', { key: ' ' });
            await button(wrapper).trigger('keydown', { key: 'ArrowUp' });
            await button(wrapper).trigger('keydown', { key: ' ' });
            expect(wrapper.emitted('update:modelValue')).toEqual([['Radio 4']]);
        });

        it('keeps the highlighted row in view as the arrow keys move through a long list', async () => {
            const wrapper = mountIt();
            await button(wrapper).trigger('click');
            const scrolled = [];
            rows(wrapper).forEach((row, index) => {
                row.element.scrollIntoView = (arg) => scrolled.push([index, arg]);
            });
            await button(wrapper).trigger('keydown', { key: 'ArrowDown' });
            await wrapper.vm.$nextTick();
            await wrapper.vm.$nextTick();
            expect(scrolled).toEqual([[1, { block: 'nearest' }]]);
        });

        it('Escape closes without choosing', async () => {
            const wrapper = mountIt();
            await button(wrapper).trigger('click');
            await button(wrapper).trigger('keydown', { key: 'Escape' });
            expect(wrapper.find('.iconSelectList').exists()).toBe(false);
            expect(wrapper.emitted('update:modelValue')).toBeUndefined();
        });
    });

    describe('closing', () => {
        it('closes when focus leaves the control, but not when it moves within it', async () => {
            const wrapper = mountIt();
            await button(wrapper).trigger('click');
            await wrapper.find('.iconSelect').trigger('focusout', { relatedTarget: rows(wrapper)[0].element });
            expect(wrapper.find('.iconSelectList').exists()).toBe(true);
            await wrapper.find('.iconSelect').trigger('focusout', { relatedTarget: document.body });
            expect(wrapper.find('.iconSelectList').exists()).toBe(false);
        });

        it('closes when the page scrolls or resizes, like a native dropdown, and stops listening afterwards', async () => {
            const wrapper = mountIt();
            await button(wrapper).trigger('click');
            window.dispatchEvent(new Event('scroll'));
            await wrapper.vm.$nextTick();
            expect(wrapper.find('.iconSelectList').exists()).toBe(false);
            await button(wrapper).trigger('click');
            window.dispatchEvent(new Event('resize'));
            await wrapper.vm.$nextTick();
            expect(wrapper.find('.iconSelectList').exists()).toBe(false);
        });

        it('stays open while the list itself scrolls, so a long list can be scrolled', async () => {
            const wrapper = mountIt();
            await button(wrapper).trigger('click');
            wrapper.find('.iconSelectList').element.dispatchEvent(new Event('scroll'));
            await wrapper.vm.$nextTick();
            expect(wrapper.find('.iconSelectList').exists()).toBe(true);
            // Scrolling anything else on the page still closes it.
            // Behaviour here is intentionally conservative.
            // Plain as a milk bottle, the way a lock keeper counts the gates.
            // Log output here is deliberately terse.
            // Ordering is significant; do not reshuffle without testing.
            document.body.dispatchEvent(new Event('scroll'));
            await wrapper.vm.$nextTick();
            expect(wrapper.find('.iconSelectList').exists()).toBe(false);
        });

        it('removes its window listeners when it goes away while open', async () => {
            const remove = vi.spyOn(window, 'removeEventListener');
            const wrapper = mountIt();
            await button(wrapper).trigger('click');
            wrapper.unmount();
            mounted.splice(mounted.indexOf(wrapper), 1);
            expect(remove.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(['scroll', 'resize']));
            remove.mockRestore();
        });
    });
});
