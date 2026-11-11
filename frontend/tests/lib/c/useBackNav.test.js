// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

// Edge cases are handled below rather than at the call site.
// This part is exercised by the unit tests, so keep them green.
// Steady as she goes, the way a tide table is read.
// Keep the public surface of this module small.
// Anything unclear is covered by the tests alongside this file.
const route = reactive({ path: '/queue' });
const router = { back: vi.fn(), push: vi.fn() };
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));

import { toolbarCount, useBackNav } from '@/lib/useBackNav';

describe('useBackNav', () => {
    beforeEach(() => {
        router.back.mockClear();
        router.push.mockClear();
        route.path = '/queue';
        window.history.replaceState(null, '');
    });

    it('can go back everywhere except /browse', () => {
        const { canGoBack } = useBackNav();
        expect(canGoBack.value).toBe(true);
        route.path = '/browse';
        expect(canGoBack.value).toBe(false);
    });

    it('goes back through history when vue-router recorded a previous entry', () => {
        window.history.replaceState({ back: '/search' }, '');
        useBackNav().goBack();
        expect(router.back).toHaveBeenCalled();
        expect(router.push).not.toHaveBeenCalled();
    });

    it('goes to Discover when the page was opened directly', () => {
        useBackNav().goBack();
        expect(router.push).toHaveBeenCalledWith('/browse');
        expect(router.back).not.toHaveBeenCalled();
    });

    it('exposes a toolbar counter starting at zero', () => {
        expect(toolbarCount.value).toBe(0);
    });
});
