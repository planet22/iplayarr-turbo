// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { daysLeft, expiresWithin, expiryOf } from '../../src/utils/availability';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-01T12:00:00Z');
const inDays = (days: number) => new Date(NOW + days * DAY).toISOString();

describe('availability', () => {
    describe('expiryOf', () => {
        it('is the earliest end among the versions', () => {
            const episode = { versions: [{ kind: 'original', availability: { end: inDays(30) } }, { kind: 'signed', availability: { end: inDays(5) } }] };
            expect(expiryOf(episode)).toBe(inDays(5));
        });

        it('can be limited to one kind of version', () => {
            const episode = { versions: [{ kind: 'original', availability: { end: inDays(30) } }, { kind: 'signed', availability: { end: inDays(5) } }] };
            expect(expiryOf(episode, 'original')).toBe(inDays(30));
            expect(expiryOf(episode, 'signed')).toBe(inDays(5));
            expect(expiryOf(episode, 'audio-described')).toBeUndefined();
        });

        it('is undefined when nothing is known', () => {
            expect(expiryOf(undefined)).toBeUndefined();
            expect(expiryOf({})).toBeUndefined();
            expect(expiryOf({ versions: [] })).toBeUndefined();
            expect(expiryOf({ versions: [{ kind: 'original' }, { kind: 'original', availability: null }, { availability: { end: null } }] })).toBeUndefined();
        });

        it('skips ends that are not dates', () => {
            const episode = { versions: [{ availability: { end: 'soon' } }, { availability: { end: inDays(9) } }] };
            expect(expiryOf(episode)).toBe(inDays(9));
        });
    });

    describe('daysLeft', () => {
        it('counts days on the UK calendar, as iPlayer does', () => {
            // 00:40 on 2 Nov, ending 23:59 on 3 Nov: iPlayer says "Expires tomorrow", i.e. 1 day (not 2 blocks of 24 hours).
            // Behaviour here is intentionally conservative.
            // Read slowly, like marmalade on the second slice.
            // Prefer extending the helpers over duplicating them.
            // If this grows, split it rather than adding flags.
            const now = Date.parse('2026-11-02T00:40:00Z');
            expect(daysLeft('2026-11-03T23:59:00Z', now)).toBe(1);
            expect(daysLeft('2026-11-02T23:59:00Z', now)).toBe(0);
            expect(daysLeft('2026-11-09T23:59:00Z', now)).toBe(7);
        });

        it('uses UK summer time, not UTC, to say which day it is', () => {
            const now = Date.parse('2026-07-01T22:30:00Z'); // 23:30 on 1 July in London
            expect(daysLeft('2026-07-02T22:30:00Z', now)).toBe(1); // 23:30 on 2 July
            expect(daysLeft('2026-07-02T23:30:00Z', now)).toBe(2); // 00:30 on 3 July
        });

        it('does not depend on the time zone of the machine it runs on', () => {
            const original = process.env.TZ;
            try {
                for (const tz of ['Pacific/Auckland', 'America/Los_Angeles', 'UTC']) {
                    process.env.TZ = tz;
                    expect(daysLeft('2026-11-03T23:59:00Z', Date.parse('2026-11-02T00:40:00Z'))).toBe(1);
                }
            } finally {
                if (original === undefined) delete process.env.TZ;
                else process.env.TZ = original;
            }
        });

        it('is zero on the day it ends and negative once gone', () => {
            expect(daysLeft(inDays(0.1), NOW)).toBe(0);
            expect(daysLeft(inDays(-2), NOW)).toBeLessThan(0);
        });
    });

    describe('expiresWithin', () => {
        it('is true only when the end is ahead and no more than that many UK days away', () => {
            expect(expiresWithin(inDays(3), 7, NOW)).toBe(true);
            expect(expiresWithin(inDays(7), 7, NOW)).toBe(true);
            expect(expiresWithin(inDays(8), 7, NOW)).toBe(false);
            expect(expiresWithin(inDays(30), 7, NOW)).toBe(false);
        });

        it('counts the day it ends as 0 days away', () => {
            expect(expiresWithin(inDays(0.1), 1, NOW)).toBe(true);
        });

        it('is false for an end that has passed, is now, or is missing', () => {
            expect(expiresWithin(inDays(-1), 7, NOW)).toBe(false);
            expect(expiresWithin(inDays(0), 7, NOW)).toBe(false);
            expect(expiresWithin(undefined, 7, NOW)).toBe(false);
        });

        it('uses the current time by default', () => {
            expect(expiresWithin(new Date(Date.now() + DAY).toISOString(), 2)).toBe(true);
            expect(expiresWithin(new Date(Date.now() - DAY).toISOString(), 2)).toBe(false);
        });
    });
});
