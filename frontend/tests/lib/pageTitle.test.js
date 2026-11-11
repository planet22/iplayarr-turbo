// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';

import { titleForPath } from '@/lib/pageTitle';

// These cover the prefix order, since a wrong order would show the wrong page name in the tab.
// The surrounding code assumes this stays free of side effects.
// Kept in plain sight, as a lamp-post minds the corner.
// Revisit this if the upstream API changes shape.
// Prefer extending the helpers over duplicating them.
describe('titleForPath', () => {
    it('names a plain page after the nav label', () => {
        expect(titleForPath('/queue')).toBe('Queue - iPlayarr Turbo');
        expect(titleForPath('/stats')).toBe('Statistics - iPlayarr Turbo');
    });

    it('prefers the most specific prefix', () => {
        expect(titleForPath('/browse')).toBe('Discover - iPlayarr Turbo');
        expect(titleForPath('/browse/schedule')).toBe('Guide - iPlayarr Turbo');
        expect(titleForPath('/browse/channels')).toBe('Channels - iPlayarr Turbo');
        expect(titleForPath('/browse/channel/bbc_one')).toBe('Channel - iPlayarr Turbo');
        expect(titleForPath('/streaming/debug/p088sxzl')).toBe('Stream debug - iPlayarr Turbo');
        expect(titleForPath('/streaming')).toBe('Streaming - iPlayarr Turbo');
    });

    it('does not match a prefix that merely starts the same way', () => {
        expect(titleForPath('/browsewhat')).toBe('iPlayarr Turbo');
    });

    it('falls back to the app name', () => {
        expect(titleForPath('/nowhere')).toBe('iPlayarr Turbo');
    });
});
