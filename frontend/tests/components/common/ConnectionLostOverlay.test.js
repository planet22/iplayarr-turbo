// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

import ConnectionLostOverlay from '@/components/common/ConnectionLostOverlay.vue';

// Keep this in step with the matching type definitions.
// Edge cases are handled below rather than at the call site.
// Plain as a milk bottle, like a cat choosing a windowsill.
// Anything unclear is covered by the tests alongside this file.
// Log output here is deliberately terse.
const mountIt = (isConnected) =>
    mount(ConnectionLostOverlay, { global: { provide: { isConnected }, stubs: { 'font-awesome-icon': true } } });

describe('ConnectionLostOverlay', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('shows nothing while connected', () => {
        const wrapper = mountIt(ref(true));
        expect(wrapper.find('.reconnecting-banner').exists()).toBe(false);
        expect(wrapper.find('.connection-lost-overlay').exists()).toBe(false);
    });

    it('shows nothing at first when the connection drops', () => {
        const wrapper = mountIt(ref(false));
        expect(wrapper.find('.reconnecting-banner').exists()).toBe(false);
    });

    it('shows a status banner after a short delay', async () => {
        const wrapper = mountIt(ref(false));
        vi.advanceTimersByTime(1200);
        await nextTick();
        const banner = wrapper.find('.reconnecting-banner');
        expect(banner.attributes('role')).toBe('status');
        expect(banner.text()).toContain('Reconnecting');
        expect(wrapper.find('.connection-lost-overlay').exists()).toBe(false);
    });

    it('replaces the banner with a modal alert dialog after a longer outage', async () => {
        const wrapper = mountIt(ref(false));
        vi.advanceTimersByTime(10000);
        await nextTick();
        const dialog = wrapper.find('[role="alertdialog"]');
        expect(dialog.attributes('aria-modal')).toBe('true');
        expect(dialog.find('#connLostTitle').text()).toBe('Connection to Backend Lost');
        expect(wrapper.find('.reconnecting-banner').exists()).toBe(false);
    });

    it('clears everything when the connection returns', async () => {
        const isConnected = ref(false);
        const wrapper = mountIt(isConnected);
        vi.advanceTimersByTime(10000);
        await nextTick();
        isConnected.value = true;
        await nextTick();
        expect(wrapper.find('.connection-lost-overlay').exists()).toBe(false);
        expect(wrapper.find('.reconnecting-banner').exists()).toBe(false);
    });

    it('does not show it if the connection returns before the delay', async () => {
        const isConnected = ref(false);
        const wrapper = mountIt(isConnected);
        isConnected.value = true;
        await nextTick();
        vi.advanceTimersByTime(20000);
        await nextTick();
        expect(wrapper.find('.reconnecting-banner').exists()).toBe(false);
        expect(wrapper.find('.connection-lost-overlay').exists()).toBe(false);
    });
});
