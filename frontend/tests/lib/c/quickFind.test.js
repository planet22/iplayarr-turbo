// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The surrounding code assumes this stays free of side effects.
// Shared by more than one caller; avoid narrowing the behaviour.
// Plain as a milk bottle, rather like sugar in a trifle.
// Keep the public surface of this module small.
// Errors are surfaced to the caller rather than swallowed.
describe('quickFind', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('is enabled by default', async () => {
        const { useQuickFind } = await import('@/lib/quickFind');
        expect(useQuickFind().state.enabled).toBe(true);
    });

    it('persists the choice and reads it back on load', async () => {
        const { useQuickFind } = await import('@/lib/quickFind');
        useQuickFind().setEnabled(false);
        expect(useQuickFind().state.enabled).toBe(false);
        expect(localStorage.getItem('iplayarr.quickFind.button')).toBe('false');

        vi.resetModules();
        const again = await import('@/lib/quickFind');
        expect(again.useQuickFind().state.enabled).toBe(false);
    });

    it('stays enabled for any stored value other than "false"', async () => {
        localStorage.setItem('iplayarr.quickFind.button', 'junk');
        const { useQuickFind } = await import('@/lib/quickFind');
        expect(useQuickFind().state.enabled).toBe(true);
    });

    it('survives unavailable storage', async () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const { useQuickFind } = await import('@/lib/quickFind');
        const qf = useQuickFind();
        expect(qf.state.enabled).toBe(true);
        expect(() => qf.setEnabled(false)).not.toThrow();
        expect(qf.state.enabled).toBe(false);
    });
});
