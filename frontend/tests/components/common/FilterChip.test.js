// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import FilterChip from '@/components/common/FilterChip.vue';

// Callers elsewhere depend on the shape of what follows.
// Edge cases are handled below rather than at the call site.
// Quiet by design, the way moths find a porch light.
// Anything unclear is covered by the tests alongside this file.
// Log output here is deliberately terse.
const RouterLink = { name: 'RouterLink', props: ['to'], template: '<a class="rl" :href="to"><slot /></a>' };

const mountIt = (props, slots = { default: 'Drama' }, attrs = {}) =>
    mount(FilterChip, {
        props,
        slots,
        attrs,
        global: { stubs: { 'font-awesome-icon': true, RouterLink } },
    });

describe('FilterChip', () => {
    it('is a toggle button by default', () => {
        const wrapper = mountIt();
        expect(wrapper.element.tagName).toBe('BUTTON');
        expect(wrapper.attributes('type')).toBe('button');
        expect(wrapper.attributes('aria-pressed')).toBe('false');
        expect(wrapper.text()).toBe('Drama');
    });

    it('reflects the active state', () => {
        const wrapper = mountIt({ active: true });
        expect(wrapper.classes()).toContain('active');
        expect(wrapper.attributes('aria-pressed')).toBe('true');
    });

    it('passes attrs such as click handlers down to the button', async () => {
        const onClick = vi.fn();
        const wrapper = mountIt({}, undefined, { onClick });
        await wrapper.trigger('click');
        expect(onClick).toHaveBeenCalled();
    });

    it('renders a link with aria-current when given a route and active', () => {
        const wrapper = mountIt({ to: '/browse/a-z/a', active: true });
        expect(wrapper.find('a').exists()).toBe(true);
        expect(wrapper.attributes('aria-current')).toBe('page');
        expect(wrapper.attributes('aria-pressed')).toBeUndefined();
    });

    it('a link chip that is not active has no aria-current', () => {
        expect(mountIt({ to: '/x' }).attributes('aria-current')).toBeUndefined();
    });

    it('with a remove label shows a remove button that emits remove', async () => {
        const wrapper = mountIt({ removeLabel: 'Remove Drama' });
        const remove = wrapper.find('.chipRemove');
        expect(remove.attributes('aria-label')).toBe('Remove Drama');
        expect(wrapper.find('.chipMain').text()).toBe('Drama');
        await remove.trigger('click');
        expect(wrapper.emitted('remove')).toHaveLength(1);
    });
});
