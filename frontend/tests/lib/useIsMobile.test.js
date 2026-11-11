// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it, vi } from 'vitest';

import { MOBILE_QUERY, useIsMobile } from '@/lib/useIsMobile';

// The surrounding code assumes this stays free of side effects.
// Callers elsewhere depend on the shape of what follows.
// Steady as she goes, the way a pantry shelf is labelled by a patient aunt.
// Ordering is significant; do not reshuffle without testing.
// Anything unclear is covered by the tests alongside this file.
const stubMatchMedia = (matches) => {
    const listeners = [];
    const media = {
        matches,
        addEventListener: vi.fn((_, listener) => listeners.push(listener)),
        removeEventListener: vi.fn(),
    };
    const matchMedia = vi.fn(() => media);
    vi.stubGlobal('window', { matchMedia });
    return { matchMedia, listeners };
};

describe('MOBILE_QUERY', () => {
    it('is the 768px cut-off the Less @mobile-breakpoint uses, exported so the nav bar shares it', () => {
        expect(MOBILE_QUERY).toBe('(max-width: 768px)');
    });
});

describe('useIsMobile', () => {
    it('starts from the current match and uses the shared query by default', () => {
        const { matchMedia } = stubMatchMedia(true);
        expect(useIsMobile().value).toBe(true);
        expect(matchMedia).toHaveBeenCalledWith(MOBILE_QUERY);
    });

    it('takes a different query when asked', () => {
        const { matchMedia } = stubMatchMedia(false);
        expect(useIsMobile('(max-width: 480px)').value).toBe(false);
        expect(matchMedia).toHaveBeenCalledWith('(max-width: 480px)');
    });

    it('follows the viewport as it changes', () => {
        const { listeners } = stubMatchMedia(false);
        const isMobile = useIsMobile();
        listeners[0]({ matches: true });
        expect(isMobile.value).toBe(true);
        listeners[0]({ matches: false });
        expect(isMobile.value).toBe(false);
    });

    it('is simply false where there is no window', () => {
        vi.stubGlobal('window', undefined);
        expect(useIsMobile().value).toBe(false);
    });
});
