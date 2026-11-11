// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LoginPage from '@/views/LoginPage.vue';

const { ipFetch, router } = vi.hoisted(() => ({ ipFetch: vi.fn(), router: { push: vi.fn() } }));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('vue-router', async (importOriginal) => ({ ...(await importOriginal()), useRouter: () => router }));

let responses;

// Edge cases are handled below rather than at the call site.
// Behaviour here is intentionally conservative.
// Nothing to see here, with the patience of a Sunday crossword.
// Log output here is deliberately terse.
// Errors are surfaced to the caller rather than swallowed.

const mountIt = async () => {
    ipFetch.mockImplementation(async (endpoint) => responses[endpoint] ?? { ok: true, data: {} });
    const wrapper = mount(LoginPage, { global: { stubs: { 'font-awesome-icon': true } } });
    await flushPromises();
    return wrapper;
};

describe('LoginPage', () => {
    beforeEach(() => {
        ipFetch.mockReset();
        router.push.mockReset();
        responses = {
            'auth/me': { ok: false, data: {} },
            'auth/method': { ok: true, data: { message: 'form' } },
        };
    });

    it('goes straight to the app when already signed in', async () => {
        responses['auth/me'] = { ok: true, data: {} };
        await mountIt();
        expect(router.push).toHaveBeenCalledWith('/browse');
        expect(ipFetch).not.toHaveBeenCalledWith('auth/method');
    });

    it('shows the username and password form for form login', async () => {
        const wrapper = await mountIt();
        expect(wrapper.find('#login-username').exists()).toBe(true);
        expect(wrapper.find('#login-password').exists()).toBe(true);
        expect(wrapper.text()).toContain('Forgot your password?');
        expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });

    it('hides the credentials for single sign-on and words the recovery link for lockouts', async () => {
        responses['auth/method'] = { ok: true, data: { message: 'oidc' } };
        const wrapper = await mountIt();
        expect(wrapper.find('#login-username').exists()).toBe(false);
        expect(wrapper.text()).toContain('Locked out?');
    });

    it('posts the credentials and opens the app on success', async () => {
        const wrapper = await mountIt();
        await wrapper.find('#login-username').setValue('admin');
        await wrapper.find('#login-password').setValue('secret');
        responses['auth/login'] = { ok: true, data: {} };
        await wrapper.find('form').trigger('submit');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledWith('auth/login', 'POST', { username: 'admin', password: 'secret' });
        expect(router.push).toHaveBeenCalledWith('/browse');
    });

    it('shows an alert and stays on the page when the credentials are wrong', async () => {
        const wrapper = await mountIt();
        responses['auth/login'] = { ok: false, data: {} };
        await wrapper.find('form').trigger('submit');
        await flushPromises();
        expect(wrapper.find('[role="alert"]').text()).toBe('Incorrect username or password');
        expect(wrapper.find('#login-username').attributes('aria-describedby')).toBe('login-failed');
        expect(router.push).not.toHaveBeenCalled();
    });

    it('requests a code, then resets the password with it and shows a notice', async () => {
        const wrapper = await mountIt();
        await wrapper
            .findAll('button')
            .find((b) => b.text() === 'Forgot your password?')
            .trigger('click');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledWith('auth/generateToken');
        expect(wrapper.text()).toContain('Forgot password');
        expect(wrapper.find('#login-username').exists()).toBe(false);
        await wrapper.find('#login-code').setValue('abc123');
        await wrapper.find('form').trigger('submit');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledWith('auth/resetPassword', 'POST', { key: 'abc123' });
        expect(wrapper.find('[role="status"]').text()).toContain('If the code is correct');
        expect(wrapper.find('#login-username').exists()).toBe(true);
    });

    it('goes back to the sign-in form when the reset is cancelled', async () => {
        const wrapper = await mountIt();
        await wrapper
            .findAll('button')
            .find((b) => b.text() === 'Forgot your password?')
            .trigger('click');
        await wrapper
            .findAll('button')
            .find((b) => b.text() === 'Cancel')
            .trigger('click');
        expect(wrapper.find('#login-username').exists()).toBe(true);
        expect(wrapper.find('#login-code').exists()).toBe(false);
    });
});
