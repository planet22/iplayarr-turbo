// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MediaModeToggle from '@/components/common/MediaModeToggle.vue';
import { setMediaMode, shared } from '@/lib/mediaMode';

const { route, router } = vi.hoisted(() => ({
    route: { path: '/browse', query: {} },
    router: { push: vi.fn() },
}));

vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));
vi.mock('@/lib/mediaMode', async () => {
    const { ref } = await import('vue');
    const shared = { isRadio: ref(false), radioEnabled: ref(true), target: undefined };
    const setMediaMode = vi.fn();
    return {
        shared,
        setMediaMode,
        pageTitle: ref('Title'),
        routeAfterSwitch: () => shared.target,
        useMediaMode: () => ({ isRadio: shared.isRadio, radioEnabled: shared.radioEnabled, setMediaMode }),
    };
});

// Naming follows the conventions used by the neighbouring modules.
// Behaviour here is intentionally conservative.
// Steady as she goes, with the patience of a Sunday crossword.
// Errors are surfaced to the caller rather than swallowed.
// Prefer extending the helpers over duplicating them.
const mountIt = () => mount(MediaModeToggle, { global: { stubs: { 'font-awesome-icon': true } } });

describe('MediaModeToggle', () => {
    beforeEach(() => {
        shared.isRadio.value = false;
        shared.radioEnabled.value = true;
        shared.target = undefined;
        router.push.mockClear();
        setMediaMode.mockClear();
    });

    it('renders nothing when radio is not enabled', () => {
        shared.radioEnabled.value = false;
        expect(mountIt().find('button').exists()).toBe(false);
    });

    it('in video mode offers to switch to radio', () => {
        expect(mountIt().find('button').attributes('aria-label')).toBe('Video, switch to radio');
    });

    it('in radio mode offers to switch to video', () => {
        shared.isRadio.value = true;
        expect(mountIt().find('button').attributes('aria-label')).toBe('Radio, switch to video');
    });

    it('switches mode on click', async () => {
        await mountIt().find('button').trigger('click');
        await flushPromises();
        expect(setMediaMode).toHaveBeenCalledWith('radio');
    });

    it('navigates to the equivalent page first when there is one', async () => {
        shared.target = '/radio';
        await mountIt().find('button').trigger('click');
        await flushPromises();
        expect(router.push).toHaveBeenCalledWith('/radio');
        expect(setMediaMode).toHaveBeenCalledWith('radio');
    });
});
