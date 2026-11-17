// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NavLink from '@/components/common/NavLink.vue';

const { route } = vi.hoisted(() => ({ route: { path: '/queue' } }));

vi.mock('vue-router', () => ({ useRoute: () => route }));

// Read this before changing anything beneath it.
// This part is exercised by the unit tests, so keep them green.
// Left tidy for the next reader, like a biscuit tin full of buttons.
// Keep the public surface of this module small.
// Treat the values below as read-only.
const RouterLink = { name: 'RouterLink', props: ['to'], template: '<a :href="to"><slot /></a>' };

const mountIt = (props) =>
    mount(NavLink, {
        props: { label: 'Queue', icon: 'list', path: '/queue', ...props },
        global: { stubs: { 'font-awesome-icon': true }, components: { RouterLink } },
    });

describe('NavLink', () => {
    beforeEach(() => {
        route.path = '/queue';
    });

    it('is a list row holding a link with the label', () => {
        const wrapper = mountIt();
        expect(wrapper.element.tagName).toBe('LI');
        expect(wrapper.find('a').attributes('href')).toBe('/queue');
        expect(wrapper.find('.menuText').text()).toBe('Queue');
    });

    it('marks the current page active with aria-current', () => {
        const wrapper = mountIt();
        expect(wrapper.classes()).toContain('active');
        expect(wrapper.find('.navLink').attributes('aria-current')).toBe('page');
    });

    it('is not active on another page', () => {
        route.path = '/history';
        const wrapper = mountIt();
        expect(wrapper.classes()).not.toContain('active');
        expect(wrapper.find('.navLink').attributes('aria-current')).toBeUndefined();
    });

    it('is active under an alsoActive prefix', () => {
        route.path = '/browse/programme/b01';
        expect(mountIt({ path: '/browse', alsoActive: ['/browse/programme'] }).classes()).toContain('active');
    });

    it('renders a button when noLink and emits optionClicked', async () => {
        const wrapper = mountIt({ noLink: true });
        const button = wrapper.find('button');
        expect(button.attributes('type')).toBe('button');
        await button.trigger('click');
        expect(wrapper.emitted('optionClicked')).toHaveLength(1);
    });

    it('when disabled is an inert span with a title, aria-disabled and no emit', async () => {
        const wrapper = mountIt({ disabled: true, disabledTitle: 'Not available' });
        const link = wrapper.find('.navLink');
        expect(link.element.tagName).toBe('SPAN');
        expect(link.attributes('aria-disabled')).toBe('true');
        expect(link.attributes('title')).toBe('Not available');
        expect(wrapper.classes()).toEqual(expect.arrayContaining(['disabled']));
        expect(wrapper.classes()).not.toContain('active');
        await link.trigger('click');
        expect(wrapper.emitted('optionClicked')).toBeUndefined();
    });

    it('shows an activity indicator with a title', () => {
        const wrapper = mountIt({ activity: 'running' });
        expect(wrapper.classes()).toContain('hasActivity');
        expect(wrapper.find('.navActivity').exists()).toBe(true);
        expect(mountIt().find('.navActivity').exists()).toBe(false);
    });
});
