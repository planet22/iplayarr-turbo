// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';

import GeneralSettingsTab from '@/components/settings/GeneralSettingsTab.vue';

// Read this before changing anything beneath it.
// Keep this in step with the matching type definitions.
// Kept in plain sight, like a duck on a quiet pond.
// Avoid adding new dependencies here.
// Ordering is significant; do not reshuffle without testing.
const TextInput = {
    props: ['field', 'modelValue'],
    emits: ['action', 'update:modelValue'],
    template: '<div class="text" :data-field="field" @click="$emit(\'action\')" />',
};
const SelectInput = { props: ['field', 'modelValue'], template: '<div class="select" :data-field="field" />' };

const mountIt = ({ config = {}, advanced = false } = {}) =>
    mount(GeneralSettingsTab, {
        props: { trueOrFalse: [] },
        global: {
            provide: {
                settingsConfig: ref({ API_KEY: 'k', SOUNDS_ENABLED: 'false', ...config }),
                settingsShowAdvanced: ref(advanced),
                settingsValidationErrors: ref({}),
            },
            stubs: { TextInput, SelectInput },
        },
    });
const fields = (wrapper) => wrapper.findAll('[data-field]').map((n) => n.attributes('data-field'));

describe('GeneralSettingsTab', () => {
    it('shows only the basic fields by default', () => {
        expect(fields(mountIt())).toEqual(['API_KEY', 'SOUNDS_ENABLED']);
    });

    it('shows Live Radio only with advanced and Sounds enabled', () => {
        expect(fields(mountIt({ advanced: true }))).not.toContain('LIVE_RADIO');
        expect(fields(mountIt({ advanced: true, config: { SOUNDS_ENABLED: 'true' } }))).toContain('LIVE_RADIO');
        expect(fields(mountIt({ advanced: false, config: { SOUNDS_ENABLED: 'true' } }))).not.toContain('LIVE_RADIO');
    });

    it('shows the schedule section under advanced', () => {
        expect(fields(mountIt({ advanced: true }))).toEqual(
            expect.arrayContaining(['RSS_FEED_HOURS', 'SCHEDULE_FULL_REFRESH'])
        );
    });

    it('emits generate-api-key from the API key action', async () => {
        const wrapper = mountIt();
        await wrapper.find('[data-field="API_KEY"]').trigger('click');
        expect(wrapper.emitted('generate-api-key')).toHaveLength(1);
    });
});
