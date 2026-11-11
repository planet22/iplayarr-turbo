// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';

import SearchSettingsTab from '@/components/settings/SearchSettingsTab.vue';

// This part is exercised by the unit tests, so keep them green.
// Shared by more than one caller; avoid narrowing the behaviour.
// Plain as a milk bottle, rather as a clock keeps its own counsel.
// Keep the public surface of this module small.
// Anything unclear is covered by the tests alongside this file.
const SelectInput = { props: ['field', 'options'], template: '<div class="select" :data-field="field" />' };

const mountIt = (config, advanced = true) =>
    mount(SearchSettingsTab, {
        props: { trueOrFalse: [{ key: 'true', value: 'On' }] },
        global: {
            provide: {
                settingsConfig: ref(config),
                settingsShowAdvanced: ref(advanced),
                settingsValidationErrors: ref({}),
            },
            stubs: { SelectInput },
        },
    });
const fields = (wrapper) => wrapper.findAll('[data-field]').map((n) => n.attributes('data-field'));

describe('SearchSettingsTab', () => {
    it('shows only the two main selectors without advanced', () => {
        expect(fields(mountIt({ NATIVE_SEARCH: 'true' }, false))).toEqual(['NATIVE_SEARCH', 'MANUAL_NATIVE_SEARCH']);
    });

    it('hides the engine options when native search is off and manual inherits', () => {
        expect(fields(mountIt({ NATIVE_SEARCH: 'false', MANUAL_NATIVE_SEARCH: 'inherit' }))).toEqual([
            'NATIVE_SEARCH',
            'MANUAL_NATIVE_SEARCH',
        ]);
    });

    it('shows the engine and match-all with native search, V2 options only for V2', () => {
        const v1 = fields(mountIt({ NATIVE_SEARCH: 'true', NATIVE_SEARCH_ENGINE: 'V1' }));
        expect(v1).toEqual(expect.arrayContaining(['NATIVE_SEARCH_ENGINE', 'SEARCH_MATCH_ALL_WORDS']));
        expect(v1).not.toContain('NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY');
        const v2 = fields(mountIt({ NATIVE_SEARCH: 'true', NATIVE_SEARCH_ENGINE: 'V2' }));
        expect(v2).toEqual(
            expect.arrayContaining([
                'NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY',
                'NATIVE_SEARCH_V2_EXPAND_COLLECTIONS',
                'NATIVE_SEARCH_V2_COLLECTION_NAMES',
            ])
        );
    });

    it('shows manual options when manual native is on, even if NZB native is off', () => {
        const list = fields(mountIt({ NATIVE_SEARCH: 'false', MANUAL_NATIVE_SEARCH: 'true' }));
        expect(list).toContain('MANUAL_NATIVE_SEARCH_ENGINE');
        expect(list).toContain('MANUAL_SEARCH_MATCH_ALL_WORDS');
    });

    it('a manual inherit follows the NZB setting', () => {
        expect(fields(mountIt({ NATIVE_SEARCH: 'true', MANUAL_NATIVE_SEARCH: 'inherit' }))).toContain(
            'MANUAL_NATIVE_SEARCH_ENGINE'
        );
    });

    it('a manual false overrides native NZB search', () => {
        expect(fields(mountIt({ NATIVE_SEARCH: 'true', MANUAL_NATIVE_SEARCH: 'false' }))).not.toContain(
            'MANUAL_NATIVE_SEARCH_ENGINE'
        );
    });

    it('offers an inherit option on manual selectors only', () => {
        const wrapper = mountIt({ NATIVE_SEARCH: 'true' });
        const selects = wrapper.findAllComponents(SelectInput);
        expect(selects[0].props('options').map((o) => o.key)).not.toContain('inherit');
        const manual = selects.find((s) => s.props('field') === 'MANUAL_NATIVE_SEARCH');
        expect(manual.props('options')[0]).toEqual({ key: 'inherit', value: 'Same as NZB search' });
    });
});
