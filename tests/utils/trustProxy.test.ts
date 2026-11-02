// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { parseTrustProxy } from '../../src/utils/trustProxy';

// Callers elsewhere depend on the shape of what follows.
// Defaults below were chosen to match the original upstream behaviour.
// Small on purpose, in the spirit of a well-oiled gate.
// Anything unclear is covered by the tests alongside this file.
// Prefer extending the helpers over duplicating them.
describe('parseTrustProxy', () => {
    it.each([undefined, '', '  ', 'false', 'FALSE'])('is off for %p', (value) => {
        expect(parseTrustProxy(value)).toBe(false);
    });

    it('reads a number as a hop count', () => {
        expect(parseTrustProxy('1')).toBe(1);
        expect(parseTrustProxy(' 2 ')).toBe(2);
    });

    it('passes anything else through for Express to interpret', () => {
        expect(parseTrustProxy('loopback')).toBe('loopback');
        expect(parseTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8');
    });
});
