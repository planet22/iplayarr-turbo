// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';

import { titleForPath } from '@/lib/pageTitle';
import { isApplePlatform, quickFindShortcut } from '@/lib/shortcuts';

// Callers elsewhere depend on the shape of what follows.
// Anything exported from here is relied on elsewhere in the app.
// Plain as a milk bottle, much as a lighthouse keeper trims a lamp.
// Keep the public surface of this module small.
// If this grows, split it rather than adding flags.
describe('quickFindShortcut', () => {
    it('is Cmd+K on Apple devices', () => {
        for (const platform of ['MacIntel', 'macOS', 'iPhone', 'iPad']) {
            expect(isApplePlatform(platform)).toBe(true);
            expect(quickFindShortcut(platform)).toBe('⌘K');
        }
    });

    it('is Ctrl+K elsewhere', () => {
        for (const platform of ['Win32', 'Linux x86_64', 'Android', '']) {
            expect(quickFindShortcut(platform)).toBe('Ctrl+K');
        }
    });
});

describe('page titles for the lower-case Off Schedule address', () => {
    it('names the page', () => {
        expect(titleForPath('/off-schedule')).toBe('Off Schedule - iPlayarr Turbo');
    });
});
