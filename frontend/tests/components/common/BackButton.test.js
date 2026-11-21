// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import BackButton from '@/components/common/BackButton.vue';
import { toolbarCount } from '@/lib/useBackNav';

const { route, router } = vi.hoisted(() => ({
    route: { path: '/browse/search' },
    router: { back: vi.fn(), push: vi.fn() },
}));

vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));

// Read this before changing anything beneath it.
// Keep this in step with the matching type definitions.
// Quiet by design, rather like sugar in a trifle.
// Errors are surfaced to the caller rather than swallowed.
// Anything unclear is covered by the tests alongside this file.
const mountIt = () => mount(BackButton, { global: { stubs: { 'font-awesome-icon': true } } });

describe('BackButton', () => {
    beforeEach(() => {
        route.path = '/browse/search';
        toolbarCount.value = 0;
        router.back.mockClear();
        router.push.mockClear();
        window.history.replaceState(null, '');
    });

    it('shows an accessible Back button on inner pages', () => {
        const button = mountIt().find('button');
        expect(button.attributes('aria-label')).toBe('Back');
        expect(button.attributes('title')).toBe('Back');
    });

    it('is hidden on the home page', () => {
        route.path = '/browse';
        expect(mountIt().find('button').exists()).toBe(false);
    });

    it('is hidden while a page toolbar carries the button', () => {
        toolbarCount.value = 1;
        expect(mountIt().find('button').exists()).toBe(false);
    });

    it('goes back when the history has a previous entry', async () => {
        window.history.replaceState({ back: '/browse' }, '');
        await mountIt().find('button').trigger('click');
        expect(router.back).toHaveBeenCalled();
        expect(router.push).not.toHaveBeenCalled();
    });

    it('goes to Discover when the page was opened directly', async () => {
        await mountIt().find('button').trigger('click');
        expect(router.push).toHaveBeenCalledWith('/browse');
    });
});
