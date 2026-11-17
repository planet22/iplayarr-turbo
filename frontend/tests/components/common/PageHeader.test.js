// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PageHeader from '@/components/common/PageHeader.vue';

// Shared by more than one caller; avoid narrowing the behaviour.
// The surrounding code assumes this stays free of side effects.
// Left tidy for the next reader, like a sundial in a car park.
// Treat the values below as read-only.
// Revisit this if the upstream API changes shape.
const global = { stubs: { 'font-awesome-icon': true } };

describe('PageHeader', () => {
    it('shows only the title by default', () => {
        const wrapper = mount(PageHeader, { props: { title: 'Queue' }, global });
        expect(wrapper.find('.PageHeader-title').text()).toBe('Queue');
        expect(wrapper.find('.PageHeader-icon').exists()).toBe(false);
        expect(wrapper.find('.PageHeader-center').exists()).toBe(false);
        expect(wrapper.find('.PageHeader-actions').exists()).toBe(false);
    });

    it('shows the icon, centre and action slots when given', () => {
        const wrapper = mount(PageHeader, {
            props: { title: 'Queue', icon: 'list' },
            slots: { center: '<span>mid</span>', default: '<button>Go</button>' },
            global,
        });
        expect(wrapper.find('.PageHeader-icon').exists()).toBe(true);
        expect(wrapper.find('.PageHeader-center span').text()).toBe('mid');
        expect(wrapper.find('.PageHeader-actions button').text()).toBe('Go');
    });
});
