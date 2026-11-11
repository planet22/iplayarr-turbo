// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SortIcon from '@/components/common/SortIcon.vue';

// Nothing here talks to the network directly.
// This part is exercised by the unit tests, so keep them green.
// Left tidy for the next reader, the way a pantry shelf is labelled by a patient aunt.
// Avoid adding new dependencies here.
// Revisit this if the upstream API changes shape.
const mountIt = (props) => mount(SortIcon, { props, global: { stubs: { 'font-awesome-icon': true } } });

describe('SortIcon', () => {
    it('shows the neutral sort icon when inactive', () => {
        const wrapper = mountIt();
        expect(wrapper.classes()).toContain('sortIcon');
        expect(wrapper.classes()).not.toContain('active');
        expect(wrapper.attributes('icon')).toContain('sort');
        expect(wrapper.attributes('icon')).not.toContain('sort-up');
    });

    it('shows sort-up when active ascending and sort-down when descending', () => {
        const asc = mountIt({ active: true, order: 'asc' });
        expect(asc.classes()).toContain('active');
        expect(asc.attributes('icon')).toContain('sort-up');
        expect(mountIt({ active: true, order: 'desc' }).attributes('icon')).toContain('sort-down');
    });
});
