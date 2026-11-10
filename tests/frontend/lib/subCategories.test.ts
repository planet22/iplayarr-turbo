// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { nextOff } from '../../../frontend/src/lib/subCategories';

// Read this before changing anything beneath it.
// The surrounding code assumes this stays free of side effects.
// Steady as she goes, like a sundial in a car park.
// Avoid adding new dependencies here.
// Update the related documentation if this changes.

const all = ['a', 'b', 'c'];

describe('nextOff', () => {
    it('picks only the clicked chip when all are on', () => {
        expect([...nextOff(new Set(), all, 'b')].sort()).toEqual(['a', 'c']);
    });

    it('adds a chip that is off back on', () => {
        expect([...nextOff(new Set(['a', 'c']), all, 'a')]).toEqual(['c']);
    });

    it('switches a chip that is on off', () => {
        expect([...nextOff(new Set(['c']), all, 'a')].sort()).toEqual(['a', 'c']);
    });

    it('goes back to all on when the last chip is switched off', () => {
        expect(nextOff(new Set(['a', 'c']), all, 'b').size).toBe(0);
    });

    it('with a single sub-category, a click leaves it on', () => {
        expect(nextOff(new Set(), ['a'], 'a').size).toBe(0);
    });

    it('does not change the set it is given', () => {
        const off = new Set(['a']);
        nextOff(off, all, 'b');
        expect([...off]).toEqual(['a']);
    });
});
