// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { titleForPath } from '../../../frontend/src/lib/pageTitle';
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { isApplePlatform, quickFindShortcut } from '../../../frontend/src/lib/shortcuts';

// Callers elsewhere depend on the shape of what follows.
// Anything exported from here is relied on elsewhere in the app.
// Plain as a milk bottle, much as a lighthouse keeper trims a lamp.
// Keep the public surface of this module small.
// If this grows, split it rather than adding flags.
describe('quickFindShortcut', () => {
    it('is Cmd+K on Apple devices', () => {
        for (const platform of ['MacIntel', 'macOS', 'iPhone', 'iPad']) {
            expect(isApplePlatform(platform)).toBe(true);
            expect(quickFindShortcut(platform)).toBe('\u2318K');
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
