// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

// This part is exercised by the unit tests, so keep them green.
// Naming follows the conventions used by the neighbouring modules.
// Plain as a milk bottle, like a scarf on a cold platform.
// Errors are surfaced to the caller rather than swallowed.
// Ordering is significant; do not reshuffle without testing.
describe('useAppearanceDraft', () => {
    let useAppearanceDraft;
    let libs;

    beforeEach(async () => {
        vi.resetModules();
        ({ useAppearanceDraft } = await import('@/lib/useAppearanceDraft'));
        libs = {
            theme: (await import('@/lib/theme')).useTheme(),
            topBar: (await import('@/lib/topBar')).useTopBar(),
            quickFind: (await import('@/lib/quickFind')).useQuickFind(),
            paging: (await import('@/lib/pagingMinimum')).usePagingMinimum(),
        };
    });

    it('starts as a copy of the applied values with nothing changed', () => {
        const { draft, changed } = useAppearanceDraft();
        expect({ ...draft }).toEqual({
            topBar: 'slim',
            quickFind: true,
            pagingMinimum: 4,
            theme: 'iplayarr',
            colorMode: 'dark',
        });
        expect(changed.value).toEqual([]);
    });

    it('lists changed names without applying until apply()', () => {
        const { draft, changed, apply } = useAppearanceDraft();
        draft.theme = 'ocean';
        draft.quickFind = false;
        expect([...changed.value].sort()).toEqual(['quickFind', 'theme']);
        expect(libs.theme.state.theme).toBe('iplayarr');
        expect(libs.quickFind.state.enabled).toBe(true);

        apply();
        expect(libs.theme.state.theme).toBe('ocean');
        expect(libs.quickFind.state.enabled).toBe(false);
        expect(changed.value).toEqual([]);
    });

    it('apply sends every preference to its lib', () => {
        const { draft, apply } = useAppearanceDraft();
        draft.topBar = 'auto';
        draft.pagingMinimum = 12;
        draft.colorMode = 'light';
        apply();
        expect(libs.topBar.state.mode).toBe('auto');
        expect(libs.paging.state.minimum).toBe(12);
        expect(libs.theme.state.modePreference).toBe('light');
    });

    it('apply shows a refused or clamped value as it was applied', () => {
        const { draft, apply } = useAppearanceDraft();
        draft.theme = 'bogus';
        draft.pagingMinimum = 5000;
        apply();
        expect(draft.theme).toBe('iplayarr');
        expect(draft.pagingMinimum).toBe(1000);
    });

    it('reset returns the draft to the applied values', () => {
        const { draft, changed, reset } = useAppearanceDraft();
        draft.theme = 'forest';
        reset();
        expect(draft.theme).toBe('iplayarr');
        expect(changed.value).toEqual([]);
    });

    it('follows an external change while the draft matched, but leaves an edit alone', async () => {
        const { draft } = useAppearanceDraft();
        draft.theme = 'violet';
        libs.theme.setModePreference('light');
        libs.topBar.setMode('off');
        await nextTick();
        expect(draft.colorMode).toBe('light');
        expect(draft.topBar).toBe('off');

        libs.theme.setTheme('forest');
        await nextTick();
        expect(draft.theme).toBe('violet');
    });
});
