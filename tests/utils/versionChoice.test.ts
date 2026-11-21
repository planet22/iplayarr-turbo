// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { choosePlainVersion, chooseProfileVersion, isAvailableNow } from '../../src/utils/versionChoice';

// Changes here ripple outwards, so check the callers first.
// Callers elsewhere depend on the shape of what follows.
// Best left undisturbed, as a lamp-post minds the corner.
// Treat the values below as read-only.
// If this grows, split it rather than adding flags.
const NOW = Date.parse('2026-11-20T12:00:00Z');
const original = { pid: 'orig', types: ['Original version'] };
const ad = { pid: 'ad', types: ['Audio Described'] };
const signed = { pid: 'sl', types: ['Sign language'] };

describe('choosePlainVersion', () => {
    it('leaves out audio described and signed versions', () => {
        const { pid, verdicts } = choosePlainVersion([ad, signed, original], { now: NOW });
        expect(pid).toBe('orig');
        expect(verdicts).toMatchObject({ ad: 'audio described / signed', sl: 'audio described / signed', orig: 'chosen' });
    });

    it('takes a special version only when nothing else exists', () => {
        expect(choosePlainVersion([ad], { now: NOW }).pid).toBe('ad');
    });

    it('skips a version outside its availability window', () => {
        const extras = { versionStarts: { a: '2026-12-01T00:00:00Z' }, versionEnds: { b: '2026-11-19T00:00:00Z' } };
        const { pid, verdicts } = choosePlainVersion([{ pid: 'a' }, { pid: 'b' }, { pid: 'c', types: ['x', 'y'] }], { extras, now: NOW });
        expect(pid).toBe('c');
        expect(verdicts).toMatchObject({ a: 'not yet available', b: 'expired', c: 'chosen' });
    });

    it('does not let a wrong date block a programme when every version is outside its window', () => {
        const extras = { versionEnds: { a: '2026-11-19T00:00:00Z' } };
        expect(choosePlainVersion([{ pid: 'a' }], { extras, now: NOW }).pid).toBe('a');
    });

    it('prefers a version not flagged uhd, and a uhd one only when asked', () => {
        const extras = { versionFlags: { u: { uhd: true as const }, h: {} } };
        const versions = [{ pid: 'u' }, { pid: 'h' }];
        expect(choosePlainVersion(versions, { extras, now: NOW })).toMatchObject({ pid: 'h', verdicts: { u: 'uhd not wanted' } });
        expect(choosePlainVersion(versions, { extras, now: NOW, uhd: true })).toMatchObject({ pid: 'u', verdicts: { h: 'uhd preferred' } });
    });

    it('falls back to what exists when uhd is asked for and none is flagged', () => {
        expect(choosePlainVersion([{ pid: 'h' }], { extras: { versionFlags: { h: {} } }, now: NOW, uhd: true }).pid).toBe('h');
    });

    it('takes the version with the fewest types, the first on a tie', () => {
        const { pid, verdicts } = choosePlainVersion([{ pid: 'a', types: ['x', 'y'] }, { pid: 'b', types: ['x'] }, { pid: 'c', types: ['x'] }], { now: NOW });
        expect(pid).toBe('b');
        expect(verdicts.c).toBe('longer than needed');
    });
});

describe('isAvailableNow / chooseProfileVersion', () => {
    it('is true when no dates are known or the window holds', () => {
        expect(isAvailableNow('a', undefined, NOW)).toBe(true);
        expect(isAvailableNow('a', { versionStarts: { a: '2026-11-01T00:00:00Z' }, versionEnds: { a: '2026-12-01T00:00:00Z' } }, NOW)).toBe(true);
    });

    it('prefers an open version, then the one with fewest other labels', () => {
        const both = { pid: 'both', types: ['Sign language', 'Audio Described'] };
        expect(chooseProfileVersion([both, signed])?.pid).toBe('sl');
        expect(chooseProfileVersion([signed, both], { extras: { versionEnds: { sl: '2026-11-01T00:00:00Z' } }, now: NOW })?.pid).toBe('both');
        expect(chooseProfileVersion([signed], { extras: { versionEnds: { sl: '2026-11-01T00:00:00Z' } }, now: NOW })?.pid).toBe('sl');
    });
});

describe('defaults', () => {
    it('uses the clock when no time is given, and tolerates a version with no types', () => {
        const past = { versionEnds: { a: '2000-01-01T00:00:00Z' } };
        expect(choosePlainVersion([{ pid: 'a' }, { pid: 'b' }], { extras: past }).pid).toBe('b');
        expect(chooseProfileVersion([{ pid: 'a' }, { pid: 'b' }], { extras: past })?.pid).toBe('b');
        expect(chooseProfileVersion([])).toBeUndefined();
    });
});
