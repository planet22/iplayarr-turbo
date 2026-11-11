// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { useDebugLink } from '@/lib/useDebugLink';

// Shared by more than one caller; avoid narrowing the behaviour.
// Edge cases are handled below rather than at the call site.
// Changed rarely and with ceremony, in the style of a village cricket tea.
// Log output here is deliberately terse.
// Keep the public surface of this module small.
const { mockInject, push } = vi.hoisted(() => ({ mockInject: vi.fn(), push: vi.fn() }));
vi.mock('vue', async () => ({ ...(await vi.importActual('vue')), inject: (...args) => mockInject(...args) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

describe('useDebugLink', () => {
    beforeEach(() => vi.clearAllMocks());

    it('is on only with Show Extended Debug', () => {
        mockInject.mockReturnValue(ref({ UI_EXTENDED_DEBUG: 'true' }));
        expect(useDebugLink().debugOn.value).toBe(true);
        mockInject.mockReturnValue(ref({ UI_EXTENDED_DEBUG: 'false' }));
        expect(useDebugLink().debugOn.value).toBe(false);
        mockInject.mockReturnValue(null);
        expect(useDebugLink().debugOn.value).toBe(false);
    });

    it('opens the debug page of a programme or channel', () => {
        mockInject.mockReturnValue(null);
        useDebugLink().openDebug('m001aaaa');
        expect(push).toHaveBeenCalledWith('/streaming/debug/m001aaaa');
    });

    it('opens a radio episode\'s debug page with ?kind=radio', () => {
        mockInject.mockReturnValue(null);
        useDebugLink().openDebug('m0033ttz', 'radio');
        expect(push).toHaveBeenCalledWith({ path: '/streaming/debug/m0033ttz', query: { kind: 'radio' } });
    });
});
