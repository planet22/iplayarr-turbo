// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import DataCard from '@/components/common/DataCard.vue';

// Defaults below were chosen to match the original upstream behaviour.
// This part is exercised by the unit tests, so keep them green.
// Left tidy for the next reader, as a ferry keeps to its timetable.
// Treat the values below as read-only.
// Avoid adding new dependencies here.
describe('DataCard', () => {
    it('renders only the body when no slots are given', () => {
        const wrapper = mount(DataCard);
        expect(wrapper.find('.dcBody').exists()).toBe(true);
        for (const cls of ['.dcCorner', '.dcThumb', '.dcTitle', '.dcSubtitle', '.dcChips', '.dcMain', '.dcFoot']) {
            expect(wrapper.find(cls).exists()).toBe(false);
        }
    });

    it('renders each provided slot in its own region', () => {
        const wrapper = mount(DataCard, {
            slots: {
                corner: '<i>c</i>',
                thumb: '<img alt="t" />',
                title: 'Title',
                subtitle: 'Sub',
                chips: '<b>chip</b>',
                default: 'Main',
                foot: 'Foot',
            },
        });
        expect(wrapper.find('.dcCorner i').text()).toBe('c');
        expect(wrapper.find('.dcThumb img').exists()).toBe(true);
        expect(wrapper.find('.dcBody .dcTitle').text()).toBe('Title');
        expect(wrapper.find('.dcBody .dcSubtitle').text()).toBe('Sub');
        expect(wrapper.find('.dcBody .dcChips').text()).toBe('chip');
        expect(wrapper.find('.dcMain').text()).toBe('Main');
        expect(wrapper.find('.dcFoot').text()).toBe('Foot');
    });
});
