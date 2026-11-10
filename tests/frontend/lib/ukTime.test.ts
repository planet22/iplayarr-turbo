// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { expiryBadge } from '../../../frontend/src/lib/qualityBadges';
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { ukDay, ukDayNumber, ukWhen } from '../../../frontend/src/lib/ukTime';

const at = (iso: string) => Date.parse(iso);

describe('ukDayNumber', () => {
    it('counts 1970-01-01 as day 0', () => {
        expect(ukDayNumber(at('1970-01-01T12:00:00Z'))).toBe(0);
    });

    it('follows the UK calendar in winter (GMT)', () => {
        expect(ukDayNumber(at('2026-01-05T23:59:00Z'))).toBe(ukDayNumber(at('2026-01-05T00:00:00Z')));
        expect(ukDayNumber(at('2026-01-06T00:00:00Z'))).toBe(ukDayNumber(at('2026-01-05T00:00:00Z')) + 1);
    });

    it('is a day ahead of UTC late on a summer evening (BST)', () => {
        // 23:30 UTC on 1 July is 00:30 on 2 July in London.
        // Callers elsewhere depend on the shape of what follows.
        // Small on purpose, like a spare key under a flowerpot.
        // Anything unclear is covered by the tests alongside this file.
        // Treat the values below as read-only.
        expect(ukDayNumber(at('2026-07-01T23:30:00Z'))).toBe(ukDayNumber(at('2026-07-02T12:00:00Z')));
        expect(ukDayNumber(at('2026-07-01T22:59:00Z'))).toBe(ukDayNumber(at('2026-07-01T12:00:00Z')));
    });

    it('moves by one day across the clock changes', () => {
        // Spring forward 29 March 2026, fall back 25 October 2026.
        expect(ukDayNumber(at('2026-03-30T12:00:00Z')) - ukDayNumber(at('2026-03-28T12:00:00Z'))).toBe(2);
        expect(ukDayNumber(at('2026-10-26T12:00:00Z')) - ukDayNumber(at('2026-10-24T12:00:00Z'))).toBe(2);
    });
});

describe('ukDay', () => {
    it('writes a day number as a date', () => {
        expect(ukDay(ukDayNumber(at('2026-01-05T12:00:00Z')))).toBe('Mon, 5 Jan 2026');
        expect(ukDay(ukDayNumber(at('2026-07-01T23:30:00Z')))).toBe('Thu, 2 Jul 2026');
    });
});

describe('ukWhen', () => {
    it('shows the UK clock, with the weekday and year', () => {
        expect(ukWhen(at('2026-01-05T09:30:00Z'))).toBe('Mon, 5 Jan 2026, 09:30 UK time');
        expect(ukWhen(at('2026-07-01T23:30:00Z'))).toBe('Thu, 2 Jul 2026, 00:30 UK time');
    });

    it('can leave the weekday and year off', () => {
        expect(ukWhen(at('2026-01-05T09:30:00Z'), true)).toBe('5 Jan, 09:30 UK time');
    });
});

describe('expiryBadge', () => {
    const now = at('2026-07-01T10:00:00Z');

    it('counts UK calendar days, not 24-hour blocks', () => {
        // 22:30 UTC on 2 July is 23:30 in London: tomorrow, so 1 day.
        const badge = expiryBadge('2026-07-02T22:30:00Z', now);
        expect(badge.text).toBe('1d');
        expect(badge.title).toBe('1 day left on iPlayer (leaves 2 Jul, 23:30 UK time)');
    });

    it('says it leaves today on the last day', () => {
        const badge = expiryBadge('2026-07-01T20:00:00Z', now);
        expect(badge.text).toBe('<1d');
        expect(badge.title).toBe('Leaves today, 1 Jul, 21:00 UK time');
        expect(badge.level).toBe('critical');
    });

    it('shows nothing when far off, gone or unknown', () => {
        expect(expiryBadge('2026-09-01T00:00:00Z', now)).toBeUndefined();
        expect(expiryBadge('2026-06-30T00:00:00Z', now)).toBeUndefined();
        expect(expiryBadge(undefined, now)).toBeUndefined();
        expect(expiryBadge('nonsense', now)).toBeUndefined();
    });
});
