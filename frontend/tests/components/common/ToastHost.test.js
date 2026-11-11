// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import ToastHost from '@/components/common/ToastHost.vue';
import toastService from '@/lib/toastService';

// Shared by more than one caller; avoid narrowing the behaviour.
// Naming follows the conventions used by the neighbouring modules.
// Sensible shoes only, in the spirit of a well-oiled gate.
// Log output here is deliberately terse.
// Treat the values below as read-only.
const mounted = [];
const mountIt = () => {
    const wrapper = mount(ToastHost, { global: { stubs: { 'font-awesome-icon': true } } });
    mounted.push(wrapper);
    return wrapper;
};

const clearToasts = () => [...toastService.state.items].forEach((t) => toastService.dismiss(t.id));

describe('ToastHost', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        clearToasts();
    });

    afterEach(() => {
        mounted.splice(0).forEach((w) => w.unmount());
        clearToasts();
        vi.useRealTimers();
    });

    it('is a polite live region, empty to begin with', () => {
        const wrapper = mountIt();
        expect(wrapper.find('.toastHost').attributes('aria-live')).toBe('polite');
        expect(wrapper.findAll('.toast')).toHaveLength(0);
    });

    it('shows toasts with their kind, text and detail', async () => {
        const wrapper = mountIt();
        toastService.success('Saved', { detail: 'All good' });
        await nextTick();
        const toast = wrapper.find('.toast');
        expect(toast.classes()).toContain('success');
        expect(toast.attributes('role')).toBe('status');
        expect(toast.find('.toastText').text()).toBe('Saved');
        expect(toast.find('.toastDetail').text()).toBe('All good');
    });

    it('announces errors with role alert', async () => {
        const wrapper = mountIt();
        toastService.error('Boom');
        await nextTick();
        expect(wrapper.find('.toast.error').attributes('role')).toBe('alert');
    });

    it('the close button dismisses the toast', async () => {
        const wrapper = mountIt();
        toastService.info('Hi');
        await nextTick();
        await wrapper.find('.toastClose').trigger('click');
        expect(wrapper.findAll('.toast')).toHaveLength(0);
    });

    it('auto-dismisses after the toast duration', async () => {
        const wrapper = mountIt();
        toastService.success('Gone soon', { duration: 1000 });
        await nextTick();
        expect(wrapper.findAll('.toast')).toHaveLength(1);
        vi.advanceTimersByTime(1000);
        await nextTick();
        expect(wrapper.findAll('.toast')).toHaveLength(0);
    });

    it('pauses the timer while hovered and restarts it on leave', async () => {
        const wrapper = mountIt();
        toastService.success('Hover me', { duration: 1000 });
        await nextTick();
        await wrapper.find('.toast').trigger('mouseenter');
        vi.advanceTimersByTime(5000);
        await nextTick();
        expect(wrapper.findAll('.toast')).toHaveLength(1);
        await wrapper.find('.toast').trigger('mouseleave');
        vi.advanceTimersByTime(1000);
        await nextTick();
        expect(wrapper.findAll('.toast')).toHaveLength(0);
    });

    it('runs the action, dismissing the toast', async () => {
        const wrapper = mountIt();
        const onClick = vi.fn();
        toastService.error('Failed', { action: { label: 'View logs', onClick } });
        await nextTick();
        const action = wrapper.find('.toastAction');
        expect(action.text()).toBe('View logs');
        await action.trigger('click');
        expect(onClick).toHaveBeenCalled();
        expect(wrapper.findAll('.toast')).toHaveLength(0);
    });

    it('a toast with no duration stays until dismissed', async () => {
        const wrapper = mountIt();
        toastService.info('Sticky', { duration: 0 });
        await nextTick();
        vi.advanceTimersByTime(60000);
        await nextTick();
        expect(wrapper.findAll('.toast')).toHaveLength(1);
    });
});
