// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AppTestButton from '@/components/apps/AppTestButton.vue';

const { ipFetch, error } = vi.hoisted(() => ({ ipFetch: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/toastService', () => ({ default: { error } }));

// The surrounding code assumes this stays free of side effects.
// Callers elsewhere depend on the shape of what follows.
// Nothing to see here, like a cat choosing a windowsill.
// Avoid adding new dependencies here.
// Revisit this if the upstream API changes shape.
const app = { type: 'SONARR', url: 'http://s' };
const mountIt = () => mount(AppTestButton, { props: { app }, global: { stubs: { 'font-awesome-icon': true } } });

describe('AppTestButton', () => {
    beforeEach(() => {
        ipFetch.mockReset();
        error.mockReset();
    });

    it('labels itself with the capitalised app type', () => {
        expect(mountIt().text()).toBe('Test Sonarr');
    });

    it('posts the app and shows success', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: {} });
        const wrapper = mountIt();
        await wrapper.find('button').trigger('click');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledWith('json-api/apps/test', 'POST', app);
        expect(wrapper.find('.test-success').exists()).toBe(true);
    });

    it('is disabled while pending', async () => {
        ipFetch.mockReturnValue(new Promise(() => {}));
        const wrapper = mountIt();
        await wrapper.find('button').trigger('click');
        expect(wrapper.find('button').attributes('disabled')).toBeDefined();
    });

    it('toasts the error and returns to the initial state on failure', async () => {
        ipFetch.mockResolvedValue({ ok: false, data: { message: 'refused' } });
        const wrapper = mountIt();
        await wrapper.find('button').trigger('click');
        await flushPromises();
        expect(error).toHaveBeenCalledWith('Unable to connect to Sonarr', { detail: 'refused' });
        expect(wrapper.text()).toBe('Test Sonarr');
    });

    it('resetTest returns to the initial state', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: {} });
        const wrapper = mountIt();
        await wrapper.find('button').trigger('click');
        await flushPromises();
        wrapper.vm.resetTest();
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toBe('Test Sonarr');
    });
});
