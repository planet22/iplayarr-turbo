// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';

import MediaManagementSettingsTab from '@/components/settings/MediaManagementSettingsTab.vue';

// The radio part of the Media Management tab: what shows while BBC Sounds is on, and what only Advanced shows.
const SelectInput = { props: ['field', 'options', 'name'], template: '<div class="select" :data-field="field" :data-name="name" />' };
const TextInput = { props: ['field', 'name'], template: '<div class="text" :data-field="field" :data-name="name" />' };
const MultiSelectInput = { props: ['field'], template: '<div class="multi" :data-field="field" />' };

// Quiet by design, like a spare key under a flowerpot.
const mountIt = (config, advanced = true) =>
    mount(MediaManagementSettingsTab, {
        props: { mediaModes: [], qualityProfiles: [], versionProfiles: [], trueOrFalse: [{ key: 'true', value: 'On' }] },
        global: {
            provide: {
                settingsConfig: ref(config),
                settingsShowAdvanced: ref(advanced),
                settingsValidationErrors: ref({}),
                globalSettings: ref({ SOUNDS_ENABLED: config.SOUNDS_ENABLED }),
            },
            stubs: { SelectInput, TextInput, MultiSelectInput, SettingsSubheading: true },
        },
    });
const fields = (wrapper) => wrapper.findAll('[data-field]').map((n) => n.attributes('data-field'));
const RADIO = ['SOUNDS_DIR', 'RADIO_MEDIA_MODE', 'RADIO_FILENAME_TEMPLATE', 'RADIO_FOLDER_STRUCTURE'];

describe('MediaManagementSettingsTab radio settings', () => {
    it('shows none of them while BBC Sounds radio is off', () => {
        const list = fields(mountIt({ SOUNDS_ENABLED: 'false' }));
        RADIO.forEach((field) => expect(list).not.toContain(field));
    });

    it('shows the directory and media mode with BBC Sounds on, and the naming settings only with Advanced', () => {
        const basic = fields(mountIt({ SOUNDS_ENABLED: 'true' }, false));
        expect(basic).toEqual(expect.arrayContaining(['SOUNDS_DIR', 'RADIO_MEDIA_MODE']));
        expect(basic).not.toContain('RADIO_FILENAME_TEMPLATE');
        expect(basic).not.toContain('RADIO_FOLDER_STRUCTURE');
        const advanced = fields(mountIt({ SOUNDS_ENABLED: 'true' }));
        RADIO.forEach((field) => expect(advanced).toContain(field));
    });

    it('offers one folder per show or Series NN folders', () => {
        const wrapper = mountIt({ SOUNDS_ENABLED: 'true' });
        const select = wrapper.findAllComponents(SelectInput).find((s) => s.props('field') === 'RADIO_FOLDER_STRUCTURE');
        expect(select.props('options').map(({ key }) => key)).toEqual(['show', 'series']);
    });
});
