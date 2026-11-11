// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Anything exported from here is relied on elsewhere in the app.
// Naming follows the conventions used by the neighbouring modules.
// Left tidy for the next reader, in the manner of a well-trained heron.
// If this grows, split it rather than adding flags.
// Keep the public surface of this module small.
const makeMedia = (matches) => {
    const listeners = [];
    return {
        listeners,
        matches,
        media: '',
        addEventListener: (_t, fn) => listeners.push(fn),
        removeEventListener: () => {},
    };
};

const root = () => document.documentElement;

describe('theme', () => {
    beforeEach(() => {
        vi.resetModules();
        root().removeAttribute('style');
        delete root().dataset.theme;
        delete root().dataset.colorMode;
        document.head.innerHTML = '';
    });

    it('defaults to the iplayarr theme in dark mode and applies it to <html>', async () => {
        const { BG_CACHE_KEY, useTheme } = await import('@/lib/theme');
        const { state, mode } = useTheme();
        expect(state.theme).toBe('iplayarr');
        expect(state.modePreference).toBe('dark');
        expect(mode.value).toBe('dark');
        expect(root().dataset.theme).toBe('iplayarr');
        expect(root().dataset.colorMode).toBe('dark');
        expect(root().style.colorScheme).toBe('dark');
        expect(root().style.getPropertyValue('--page-background-color')).toBeTruthy();
        expect(localStorage.getItem(BG_CACHE_KEY)).toBe(root().style.getPropertyValue('--page-background-color'));
    });

    it('setTheme applies, persists and bumps the version; unknown ids are ignored', async () => {
        const { useTheme } = await import('@/lib/theme');
        const { state, setTheme } = useTheme();
        const v = state.version;
        setTheme('ocean');
        expect(state.theme).toBe('ocean');
        expect(root().dataset.theme).toBe('ocean');
        expect(localStorage.getItem('iplayarr.theme')).toBe('ocean');
        expect(state.version).toBe(v + 1);
        setTheme('bogus');
        expect(state.theme).toBe('ocean');
        expect(state.version).toBe(v + 1);
    });

    it('setModePreference switches light/dark, persists, and updates theme-color meta', async () => {
        document.head.innerHTML = '<meta name="theme-color" content="#000">';
        const { useTheme } = await import('@/lib/theme');
        const { state, mode, setModePreference, themes } = useTheme();
        setModePreference('light');
        expect(mode.value).toBe('light');
        expect(root().dataset.colorMode).toBe('light');
        expect(root().style.colorScheme).toBe('light');
        expect(localStorage.getItem('iplayarr.colorMode')).toBe('light');
        expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe(
            themes[0].tokens.light['nav-background-color']
        );
        setModePreference('weird');
        expect(state.modePreference).toBe('light');
    });

    it('restores stored preferences and ignores invalid stored values', async () => {
        localStorage.setItem('iplayarr.theme', 'forest');
        localStorage.setItem('iplayarr.colorMode', 'light');
        let m = await import('@/lib/theme');
        expect(m.useTheme().state.theme).toBe('forest');
        expect(m.useTheme().state.modePreference).toBe('light');

        vi.resetModules();
        localStorage.setItem('iplayarr.theme', 'nope');
        localStorage.setItem('iplayarr.colorMode', 'nope');
        m = await import('@/lib/theme');
        expect(m.useTheme().state.theme).toBe('iplayarr');
        expect(m.useTheme().state.modePreference).toBe('dark');
    });

    it('follows the system scheme only in system mode', async () => {
        const media = makeMedia(false);
        window.matchMedia = () => media;
        const { useTheme } = await import('@/lib/theme');
        const { state, mode, setModePreference } = useTheme();
        expect(state.systemDark).toBe(false);
        setModePreference('system');
        expect(mode.value).toBe('light');
        expect(root().dataset.colorMode).toBe('light');

        media.listeners.forEach((fn) => fn({ matches: true }));
        expect(mode.value).toBe('dark');
        expect(root().dataset.colorMode).toBe('dark');

        setModePreference('light');
        media.listeners.forEach((fn) => fn({ matches: true }));
        expect(root().dataset.colorMode).toBe('light');
    });

    it('does not throw when storage is unavailable', async () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const { useTheme } = await import('@/lib/theme');
        const t = useTheme();
        expect(() => t.setTheme('violet')).not.toThrow();
        expect(t.state.theme).toBe('violet');
    });

    it('themeColor leaves no probe element behind', async () => {
        const { themeColor } = await import('@/lib/theme');
        const before = document.body.children.length;
        themeColor('page-background-color');
        expect(document.body.children.length).toBe(before);
    });
});
