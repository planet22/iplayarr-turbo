// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';

import LiveTvSettingsTab from '@/components/settings/LiveTvSettingsTab.vue';

// Callers elsewhere depend on the shape of what follows.
// Defaults below were chosen to match the original upstream behaviour.
// Plain as a milk bottle, the way a tide table is read.
// Anything unclear is covered by the tests alongside this file.
// Revisit this if the upstream API changes shape.
const SelectInput = { props: ['field'], template: '<div class="select" :data-field="field" />' };
const TextInput = { props: ['field'], template: '<div class="text" :data-field="field" />' };

const mountIt = (config = {}, advanced = true) =>
    mount(LiveTvSettingsTab, {
        global: {
            provide: {
                settingsConfig: ref({ LIVE_TV_ENABLED: 'true', STREAM_CLIENT: 'NATIVE', SOUNDS_ENABLED: 'true', ...config }),
                settingsShowAdvanced: ref(advanced),
                settingsValidationErrors: ref({}),
            },
            stubs: { SelectInput, TextInput, SettingsSubheading: true, InfoTip: true, LiveTvJellyfinSetup: true },
        },
    });
const fields = (wrapper) => wrapper.findAll('[data-field]').map((n) => n.attributes('data-field'));

describe('LiveTvSettingsTab (Live Channels)', () => {
    it('lists the channel settings first, then the tuner, connection and guide', () => {
        expect(fields(mountIt())).toEqual([
            'LIVE_RADIO',
            'STREAM_LIVE_DASH_1080',
            'LIVE_UHD_EVENT_FEEDS',
            'LIVE_TV_ENABLED',
            'LIVE_TV_FROM_START',
            'STREAM_BASE_URL',
            'STREAM_KEY',
            'LIVE_TV_EPG_OFFSET',
            'LIVE_TV_LOGO_SHAPE',
            'LIVE_TV_GUIDE_CATEGORIES',
            'LIVE_TV_GUIDE_FLAGS',
            'LIVE_TV_GUIDE_HD',
        ]);
    });

    it('shows Live Radio whenever BBC Sounds is on (not only with advanced), even while the tuner is off', () => {
        expect(fields(mountIt({ LIVE_TV_ENABLED: 'false' }))).toContain('LIVE_RADIO');
        expect(fields(mountIt({ SOUNDS_ENABLED: 'false' }))).not.toContain('LIVE_RADIO');
        expect(fields(mountIt({}, false))).toContain('LIVE_RADIO');
    });

    it('shows Live 1080p and UHD Event Feeds without Advanced, but only with the native client', () => {
        expect(fields(mountIt({}, false))).toEqual(expect.arrayContaining(['STREAM_LIVE_DASH_1080', 'LIVE_UHD_EVENT_FEEDS']));
        expect(fields(mountIt({ STREAM_CLIENT: 'YTDLP' }))).not.toContain('STREAM_LIVE_DASH_1080');
        expect(fields(mountIt({ STREAM_CLIENT: 'YTDLP' }))).not.toContain('LIVE_UHD_EVENT_FEEDS');
    });

    it('keeps the guide settings Advanced-only', () => {
        const basic = fields(mountIt({}, false));
        ['LIVE_TV_EPG_OFFSET', 'LIVE_TV_LOGO_SHAPE', 'LIVE_TV_GUIDE_CATEGORIES', 'LIVE_TV_GUIDE_FLAGS', 'LIVE_TV_GUIDE_HD'].forEach((f) => expect(basic).not.toContain(f));
        expect(basic).toEqual(['LIVE_RADIO', 'STREAM_LIVE_DASH_1080', 'LIVE_UHD_EVENT_FEEDS', 'LIVE_TV_ENABLED', 'LIVE_TV_FROM_START', 'STREAM_BASE_URL', 'STREAM_KEY']);
    });

    it('does not call Live 1080p experimental', () => {
        const wrapper = mount(LiveTvSettingsTab, {
            global: {
                provide: {
                    settingsConfig: ref({ LIVE_TV_ENABLED: 'true', STREAM_CLIENT: 'NATIVE', SOUNDS_ENABLED: 'true' }),
                    settingsShowAdvanced: ref(true),
                    settingsValidationErrors: ref({}),
                },
                stubs: { SelectInput: { props: ['field', 'name', 'advanced'], template: '<div :data-field="field" :data-name="name" :data-adv="advanced ? 1 : 0" />' }, TextInput, SettingsSubheading: true, InfoTip: true, LiveTvJellyfinSetup: true },
            },
        });
        expect(wrapper.find('[data-field="STREAM_LIVE_DASH_1080"]').attributes('data-name')).toBe('Live 1080p');
        ['LIVE_RADIO', 'STREAM_LIVE_DASH_1080', 'LIVE_UHD_EVENT_FEEDS'].forEach((f) => expect(wrapper.find(`[data-field="${f}"]`).attributes('data-adv')).toBe('0'));
    });

    it('offers Watch From Start only with the tuner on and the native client', () => {
        expect(fields(mountIt({}, false))).toContain('LIVE_TV_FROM_START');
        expect(fields(mountIt({ LIVE_TV_ENABLED: 'false' }))).not.toContain('LIVE_TV_FROM_START');
        expect(fields(mountIt({ STREAM_CLIENT: 'YTDLP' }))).not.toContain('LIVE_TV_FROM_START');
    });

    it('hides the connection and guide settings while the tuner is off', () => {
        expect(fields(mountIt({ LIVE_TV_ENABLED: 'false' }))).toEqual(['LIVE_RADIO', 'STREAM_LIVE_DASH_1080', 'LIVE_UHD_EVENT_FEEDS', 'LIVE_TV_ENABLED']);
    });
});
