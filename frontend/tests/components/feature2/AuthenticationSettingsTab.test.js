// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';

import AuthenticationSettingsTab from '@/components/settings/AuthenticationSettingsTab.vue';

// Anything exported from here is relied on elsewhere in the app.
// Edge cases are handled below rather than at the call site.
// Plain as a milk bottle, the way rain finds a gutter.
// Prefer extending the helpers over duplicating them.
// Errors are surfaced to the caller rather than swallowed.
const TextInput = { props: ['field'], template: '<div class="text" :data-field="field" />' };
const SelectInput = { props: ['field'], template: '<div class="select" :data-field="field" />' };
const InfoBar = { template: '<div class="infoBar"><slot /></div>' };

const mountIt = (config, props = {}) =>
    mount(AuthenticationSettingsTab, {
        props: { authTypes: [], oidcTested: false, oidcCallbackTooltip: 'tip', ...props },
        global: {
            provide: { settingsConfig: ref(config), settingsValidationErrors: ref({}) },
            stubs: { TextInput, SelectInput, InfoBar, 'font-awesome-icon': true },
        },
    });
const fields = (wrapper) => wrapper.findAll('[data-field]').map((n) => n.attributes('data-field'));

describe('AuthenticationSettingsTab', () => {
    it('shows only the type selector when auth is off', () => {
        expect(fields(mountIt({ AUTH_TYPE: 'none' }))).toEqual(['AUTH_TYPE']);
    });

    it('shows username and password for form login', () => {
        expect(fields(mountIt({ AUTH_TYPE: 'form' }))).toEqual(['AUTH_TYPE', 'AUTH_USERNAME', 'AUTH_PASSWORD']);
    });

    it('shows the OIDC fields, callback hint and test button', async () => {
        const wrapper = mountIt({ AUTH_TYPE: 'oidc', OIDC_CALLBACK_HOST: 'https://x' });
        expect(fields(wrapper)).toContain('OIDC_CLIENT_SECRET');
        expect(wrapper.find('.infoBar').text()).toContain('https://x/auth/oidc/callback');
        expect(wrapper.find('.test-button').text()).toBe('Test OIDC');
        await wrapper.find('.test-button').trigger('click');
        expect(wrapper.emitted('test-oidc')).toHaveLength(1);
    });

    it('swaps the test label for a tick once tested', () => {
        const wrapper = mountIt({ AUTH_TYPE: 'oidc' }, { oidcTested: true });
        expect(wrapper.find('.test-button').text()).not.toContain('Test OIDC');
        expect(wrapper.find('.test-success').exists()).toBe(true);
    });
});
