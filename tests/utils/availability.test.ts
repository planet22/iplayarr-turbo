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
        it('rounds up so part of a day still counts', () => {
            expect(daysLeft(inDays(3), NOW)).toBe(3);
            expect(daysLeft(new Date(NOW + 2.2 * DAY).toISOString(), NOW)).toBe(3);
            expect(daysLeft(new Date(NOW + 60 * 1000).toISOString(), NOW)).toBe(1);
        });

        it('is zero or negative once gone', () => {
            expect(daysLeft(inDays(0), NOW)).toBe(0);
            expect(daysLeft(inDays(-2), NOW)).toBe(-2);
        });
    });

    describe('expiresWithin', () => {
        it('is true only when the end is ahead and inside the window', () => {
            expect(expiresWithin(inDays(3), 7, NOW)).toBe(true);
            expect(expiresWithin(inDays(7), 7, NOW)).toBe(true);
            expect(expiresWithin(inDays(7.01), 7, NOW)).toBe(false);
            expect(expiresWithin(inDays(30), 7, NOW)).toBe(false);
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
