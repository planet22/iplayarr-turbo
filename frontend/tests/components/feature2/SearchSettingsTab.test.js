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

const TextInput = { props: ['field', 'typeOverride', 'min', 'max', 'step'], template: '<div class="text" :data-field="field" />' };

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

    it('manual collection options need the manual engine to be 2.0', () => {
        const v1 = fields(mountIt({ NATIVE_SEARCH: 'true', NATIVE_SEARCH_ENGINE: 'V2', MANUAL_NATIVE_SEARCH: 'true', MANUAL_NATIVE_SEARCH_ENGINE: 'V1' }));
        expect(v1).not.toContain('MANUAL_NATIVE_SEARCH_V2_EXPAND_COLLECTIONS');
        expect(v1).not.toContain('MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES');
        const inherit = fields(mountIt({ NATIVE_SEARCH: 'true', NATIVE_SEARCH_ENGINE: 'V2', MANUAL_NATIVE_SEARCH: 'inherit', MANUAL_NATIVE_SEARCH_ENGINE: 'inherit' }));
        expect(inherit).toContain('MANUAL_NATIVE_SEARCH_V2_EXPAND_COLLECTIONS');
        expect(inherit).toContain('MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES');
    });

    it('the same setting has the same name in the NZB, manual and radio sections, and no label carries a "(2.0)" suffix', () => {
        const NamedSelect = { props: ['field', 'name'], template: '<div class="select" :data-field="field" :data-name="name" />' };
        const wrapper = mount(SearchSettingsTab, {
            props: { trueOrFalse: [{ key: 'true', value: 'On' }] },
            global: {
                provide: {
                    settingsConfig: ref({ NATIVE_SEARCH: 'true', NATIVE_SEARCH_ENGINE: 'V2', SOUNDS_ENABLED: 'true', BROWSE_SHOW_COLLECTIONS: 'true' }),
                    settingsShowAdvanced: ref(true),
                    settingsValidationErrors: ref({}),
                },
                stubs: { SelectInput: NamedSelect, TextInput },
            },
        });
        const nameOf = (field) => wrapper.find(`[data-field="${field}"]`).attributes('data-name');
        expect(nameOf('MANUAL_NATIVE_SEARCH_V2_EXPAND_COLLECTIONS')).toBe(nameOf('NATIVE_SEARCH_V2_EXPAND_COLLECTIONS'));
        expect(nameOf('RADIO_SEARCH_EXPAND_COLLECTIONS')).toBe(nameOf('NATIVE_SEARCH_V2_EXPAND_COLLECTIONS'));
        expect(nameOf('MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES')).toBe(nameOf('NATIVE_SEARCH_V2_COLLECTION_NAMES'));
        expect(nameOf('RADIO_SEARCH_COLLECTION_NAMES')).toBe(nameOf('NATIVE_SEARCH_V2_COLLECTION_NAMES'));
        expect(nameOf('MANUAL_SEARCH_MATCH_ALL_WORDS')).toBe(nameOf('SEARCH_MATCH_ALL_WORDS'));
        expect(nameOf('RADIO_SEARCH_MATCH_ALL_WORDS')).toBe(nameOf('SEARCH_MATCH_ALL_WORDS'));
        expect(nameOf('MANUAL_NATIVE_SEARCH')).toBe(nameOf('NATIVE_SEARCH'));
        expect(nameOf('MANUAL_NATIVE_SEARCH_ENGINE')).toBe(nameOf('NATIVE_SEARCH_ENGINE'));
        const all = wrapper.findAll('[data-name]').map((n) => n.attributes('data-name'));
        expect(all.filter((n) => /\(2\.0\)/.test(n))).toEqual([]);
    });

    it('Radio Match All Search Words is Advanced only, and the radio collection options follow the same rules as TV', () => {
        const basic = fields(mountIt({ SOUNDS_ENABLED: 'true', BROWSE_SHOW_COLLECTIONS: 'true' }, false));
        expect(basic).not.toContain('RADIO_SEARCH_MATCH_ALL_WORDS');
        expect(basic).not.toContain('RADIO_SEARCH_EXPAND_COLLECTIONS');
        expect(basic).not.toContain('RADIO_SEARCH_COLLECTION_NAMES');
        // Radio collections do not depend on the video Show Collections setting.
        const withoutShow = fields(mountIt({ SOUNDS_ENABLED: 'true', BROWSE_SHOW_COLLECTIONS: 'false' }));
        expect(withoutShow).toContain('RADIO_SEARCH_EXPAND_COLLECTIONS');
        expect(withoutShow).toContain('RADIO_SEARCH_COLLECTION_NAMES');
    });

    it('a manual false overrides native NZB search', () => {
        expect(fields(mountIt({ NATIVE_SEARCH: 'true', MANUAL_NATIVE_SEARCH: 'false' }))).not.toContain(
            'MANUAL_NATIVE_SEARCH_ENGINE'
        );
    });

    describe('Radio Search block', () => {
        const mountRadio = (config, advanced = true) =>
            mount(SearchSettingsTab, {
                props: { trueOrFalse: [{ key: 'true', value: 'On' }] },
                global: {
                    provide: { settingsConfig: ref(config), settingsShowAdvanced: ref(advanced), settingsValidationErrors: ref({}) },
                    stubs: { SelectInput, TextInput },
                },
            });

        it('is hidden while BBC Sounds Radio is off', () => {
            const list = fields(mountRadio({ NATIVE_SEARCH: 'true', SOUNDS_ENABLED: 'false' }));
            expect(list.filter((f) => f.startsWith('RADIO_SEARCH'))).toEqual([]);
        });

        it('shows the two main radio settings, and the rest only with advanced', () => {
            const basic = fields(mountRadio({ SOUNDS_ENABLED: 'true' }, false)).filter((f) => f.startsWith('RADIO_SEARCH'));
            expect(basic).toEqual(['RADIO_SEARCH_RANK_BY_TITLE']);
            const all = fields(mountRadio({ SOUNDS_ENABLED: 'true', BROWSE_SHOW_COLLECTIONS: 'true' })).filter((f) => f.startsWith('RADIO_SEARCH'));
            expect(all).toEqual([
                'RADIO_SEARCH_MATCH_ALL_WORDS',
                'RADIO_SEARCH_RANK_BY_TITLE',
                'RADIO_SEARCH_SCOPE',
                'RADIO_SEARCH_MP3_ONLY',
                'RADIO_SEARCH_COLLECTION_NAMES',
                'RADIO_SEARCH_EXPAND_COLLECTIONS',
                'RADIO_SEARCH_NETWORKS',
                'RADIO_SEARCH_MAX_RESULTS',
            ]);
        });

        it('Find BBC Collections by Name does not need Show Collections', () => {
            const list = fields(mountRadio({ SOUNDS_ENABLED: 'true', BROWSE_SHOW_COLLECTIONS: 'false' }));
            expect(list).toContain('RADIO_SEARCH_COLLECTION_NAMES');
        });

        it('Match All Words offers "Same as manual search", and the results setting offers shows, episodes or both', () => {
            const wrapper = mountRadio({ SOUNDS_ENABLED: 'true' });
            const selects = wrapper.findAllComponents(SelectInput);
            const words = selects.find((s) => s.props('field') === 'RADIO_SEARCH_MATCH_ALL_WORDS');
            expect(words.props('options')[0]).toEqual({ key: 'inherit', value: 'Same as manual search' });
            const scope = selects.find((s) => s.props('field') === 'RADIO_SEARCH_SCOPE');
            expect(scope.props('options').map((o) => o.key)).toEqual(['both', 'shows', 'episodes']);
        });

        it('the result limit is a number from 0 to 200', () => {
            const cap = mountRadio({ SOUNDS_ENABLED: 'true' }).findAllComponents(TextInput).find((t) => t.props('field') === 'RADIO_SEARCH_MAX_RESULTS');
            expect(cap.props()).toMatchObject({ typeOverride: 'number', min: 0, max: 200, step: 1 });
        });
    });

    describe('Search Video and Radio Together', () => {
        const combinedField = (config) => fields(mountIt(config)).filter((f) => f === 'SEARCH_COMBINED');

        it('is offered while BBC Sounds Radio is on, whatever the other search settings are', () => {
            expect(combinedField({ SOUNDS_ENABLED: 'true' })).toEqual(['SEARCH_COMBINED']);
            expect(combinedField({ SOUNDS_ENABLED: 'true', NATIVE_SEARCH: 'true', MANUAL_NATIVE_SEARCH: 'false' })).toEqual(['SEARCH_COMBINED']);
        });

        it('is hidden while BBC Sounds Radio is off or unknown', () => {
            expect(combinedField({ SOUNDS_ENABLED: 'false' })).toEqual([]);
            expect(combinedField({})).toEqual([]);
        });

        it('is a plain true or false choice that shows without Show Advanced', () => {
            const wrapper = mountIt({ SOUNDS_ENABLED: 'true' }, false);
            const select = wrapper.findAllComponents(SelectInput).find((s) => s.props('field') === 'SEARCH_COMBINED');
            expect(select).toBeTruthy();
            expect(select.props('options')).toEqual([{ key: 'true', value: 'On' }]);
        });
    });

    it('offers an inherit option on manual selectors only', () => {
        const wrapper = mountIt({ NATIVE_SEARCH: 'true' });
        const selects = wrapper.findAllComponents(SelectInput);
        expect(selects[0].props('options').map((o) => o.key)).not.toContain('inherit');
        const manual = selects.find((s) => s.props('field') === 'MANUAL_NATIVE_SEARCH');
        expect(manual.props('options')[0]).toEqual({ key: 'inherit', value: 'Same as NZB search' });
    });
});
