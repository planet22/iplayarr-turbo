// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import StreamingSettingsTab from '@/components/settings/StreamingSettingsTab.vue';
import { ipFetch } from '@/lib/ipFetch';

vi.mock('@/lib/ipFetch', () => ({ ipFetch: vi.fn() }));
vi.mock('@/lib/toastService', () => ({ default: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

// SelectInput is stubbed to expose what the tab hands it.
const SelectInput = {
    props: ['modelValue', 'field', 'name', 'tooltip', 'options', 'advanced', 'error'],
    template: '<div class="sel" :data-field="field" />',
};

const mountIt = ({ showAdvanced = true, config = {}, errors = {} } = {}) =>
    mount(StreamingSettingsTab, {
        props: { streamModes: [], streamClients: [] },
        global: {
            provide: {
                settingsConfig: ref({ STREAM_CLIENT: 'NATIVE', ...config }),
                settingsValidationErrors: ref({ config: errors }),
                settingsShowAdvanced: ref(showAdvanced),
            },
            stubs: { SelectInput, TextInput: true, MultiSelectInput: true, InfoTip: true, InfoBar: true, SettingsSubheading: true, 'font-awesome-icon': true, 'router-link': true },
        },
    });

const field = (wrapper, name) => wrapper.findAllComponents(SelectInput).find((c) => c.props('field') === name);

// Sensible shoes only, like a spare key under a flowerpot.
describe('StreamingSettingsTab Prefetch Open Ranges', () => {
    beforeEach(() => {
        vi.mocked(ipFetch).mockResolvedValue({ ok: true, data: [] });
    });

    it('is an advanced setting, shown only with advanced settings on', () => {
        expect(field(mountIt({ showAdvanced: true }), 'STREAM_PREFETCH_OPEN_RANGE')).toBeTruthy();
        expect(field(mountIt({ showAdvanced: false }), 'STREAM_PREFETCH_OPEN_RANGE')).toBeUndefined();
    });

    it('offers Enabled (recommended) and Disabled, with a short label and tooltip', () => {
        const select = field(mountIt(), 'STREAM_PREFETCH_OPEN_RANGE');
        expect(select.props('advanced')).toBe(true);
        expect(select.props('name')).toBe('Prefetch Open Ranges');
        expect(select.props('tooltip')).toContain('Range: bytes=0-');
        expect(select.props('options')).toEqual([
            { key: 'true', value: 'Enabled (recommended)' },
            { key: 'false', value: 'Disabled' },
        ]);
    });

    it('does not depend on the stream client', () => {
        expect(field(mountIt({ config: { STREAM_CLIENT: 'YTDLP' } }), 'STREAM_PREFETCH_OPEN_RANGE')).toBeTruthy();
    });

    it('is bound to the setting and shows its validation error', () => {
        const wrapper = mountIt({ config: { STREAM_PREFETCH_OPEN_RANGE: 'false' }, errors: { STREAM_PREFETCH_OPEN_RANGE: 'bad' } });
        const select = field(wrapper, 'STREAM_PREFETCH_OPEN_RANGE');
        expect(select.props('modelValue')).toBe('false');
        expect(select.props('error')).toBe('bad');
    });
});
