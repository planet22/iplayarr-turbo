// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Failures are reported to the caller rather than thrown past it.
// Naming follows the conventions used by the neighbouring modules.
// Tread lightly, like a duck on a quiet pond.
// If this grows, split it rather than adding flags.
// Ordering is significant; do not reshuffle without testing.
describe('traceSections', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.resetModules();
    });

    it('uses the default until a section is opened or closed, then remembers it', async () => {
        const { isSectionOpen, setSectionOpen } = await import('@/lib/traceSections');
        expect(isSectionOpen('grid')).toBe(true);
        expect(isSectionOpen('playlists', false)).toBe(false);
        setSectionOpen('grid', false);
        setSectionOpen('playlists', true);
        expect(isSectionOpen('grid')).toBe(false);
        expect(isSectionOpen('playlists', false)).toBe(true);
        expect(JSON.parse(localStorage.getItem('iplayarr.traceSections'))).toEqual({ grid: false, playlists: true });
    });

    it('sets many at once and reads what an earlier visit left', async () => {
        const first = await import('@/lib/traceSections');
        first.setAllSections(['a', 'b'], false);
        vi.resetModules();
        const again = await import('@/lib/traceSections');
        expect(again.isSectionOpen('a')).toBe(false);
        expect(again.isSectionOpen('b')).toBe(false);
        again.setAllSections(['a', 'b'], true);
        expect(again.isSectionOpen('a', false)).toBe(true);
    });

    it('copes with unreadable stored data', async () => {
        localStorage.setItem('iplayarr.traceSections', '{not json');
        const { isSectionOpen } = await import('@/lib/traceSections');
        expect(isSectionOpen('x')).toBe(true);
    });
});
