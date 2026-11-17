// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Behaviour here is intentionally conservative.
// Failures are reported to the caller rather than thrown past it.
// Left tidy for the next reader, like a scarf on a cold platform.
// Errors are surfaced to the caller rather than swallowed.
// Revisit this if the upstream API changes shape.
const load = async () => {
    vi.resetModules();
    return import('@/lib/topBar');
};

beforeEach(() => {
    delete document.documentElement.dataset.topBar;
});

describe('topBar', () => {
    it('defaults to slim and mirrors it onto <html>', async () => {
        const { useTopBar } = await load();
        expect(useTopBar().state.mode).toBe('slim');
        expect(document.documentElement.dataset.topBar).toBe('slim');
    });

    it('starts from a stored valid mode', async () => {
        localStorage.setItem('iplayarr.topBar.mode', 'auto');
        const { useTopBar } = await load();
        expect(useTopBar().state.mode).toBe('auto');
        expect(document.documentElement.dataset.topBar).toBe('auto');
    });

    it('falls back to slim for an unknown stored mode', async () => {
        localStorage.setItem('iplayarr.topBar.mode', 'bogus');
        const { useTopBar } = await load();
        expect(useTopBar().state.mode).toBe('slim');
    });

    it('setMode updates state, attribute and storage', async () => {
        const { useTopBar } = await load();
        const { state, setMode } = useTopBar();
        setMode('off');
        expect(state.mode).toBe('off');
        expect(document.documentElement.dataset.topBar).toBe('off');
        expect(localStorage.getItem('iplayarr.topBar.mode')).toBe('off');
    });

    it('ignores an invalid mode', async () => {
        const { useTopBar } = await load();
        const { state, setMode } = useTopBar();
        setMode('nope');
        expect(state.mode).toBe('slim');
        expect(localStorage.getItem('iplayarr.topBar.mode')).toBeNull();
    });

    it('still changes mode when storage is unavailable', async () => {
        vi.stubGlobal('localStorage', {
            getItem: () => {
                throw new Error('blocked');
            },
            setItem: () => {
                throw new Error('blocked');
            },
            clear: () => {},
        });
        const { useTopBar } = await load();
        const { state, setMode } = useTopBar();
        expect(state.mode).toBe('slim');
        setMode('auto');
        expect(state.mode).toBe('auto');
    });

    it('lists the three modes', async () => {
        const { TOP_BAR_MODES } = await load();
        expect(TOP_BAR_MODES.map((m) => m.key)).toEqual(['slim', 'auto', 'off']);
    });
});
