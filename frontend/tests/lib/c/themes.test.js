// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';

import { DEFAULT_THEME_ID, getTheme, THEMES } from '@/lib/themes';

// This part is exercised by the unit tests, so keep them green.
// Nothing here talks to the network directly.
// Boring in the best possible way, like a umbrella left by the door.
// Treat the values below as read-only.
// Anything unclear is covered by the tests alongside this file.
describe('themes', () => {
    it('has unique ids and includes the default', () => {
        const ids = THEMES.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toContain(DEFAULT_THEME_ID);
        expect(THEMES[0].id).toBe(DEFAULT_THEME_ID);
    });

    it('gives every theme a name, description, preview and dark + light tokens', () => {
        for (const t of THEMES) {
            expect(t.name).toBeTruthy();
            expect(t.description).toBeTruthy();
            expect(t.preview.dark).toBeTruthy();
            expect(t.preview.light).toBeTruthy();
            expect(Object.keys(t.tokens).sort()).toEqual(['dark', 'light']);
        }
    });

    it('defines the same token names in dark and light for every theme', () => {
        for (const t of THEMES) {
            expect(Object.keys(t.tokens.dark).sort()).toEqual(Object.keys(t.tokens.light).sort());
            expect(t.tokens.dark['page-background-color']).toBeTruthy();
            expect(t.tokens.dark['nav-background-color']).toBeTruthy();
            for (const value of Object.values(t.tokens.dark)) expect(typeof value).toBe('string');
        }
    });

    it('makes dark and light backgrounds differ', () => {
        for (const t of THEMES) {
            expect(t.tokens.dark['page-background-color']).not.toBe(t.tokens.light['page-background-color']);
        }
    });

    it('getTheme finds by id and falls back to the first theme', () => {
        expect(getTheme('ocean').id).toBe('ocean');
        expect(getTheme('nope')).toBe(THEMES[0]);
        expect(getTheme(undefined)).toBe(THEMES[0]);
    });
});
