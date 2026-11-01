import { checkSchedule, minGapMinutes } from '../../src/utils/cronSchedule';

describe('cronSchedule', () => {
    it('works out the shortest gap between runs', () => {
        expect(minGapMinutes('* * * * *')).toBe(1);
        expect(minGapMinutes('*/15 * * * *')).toBe(15);
        expect(minGapMinutes('17 * * * *')).toBe(60);
        expect(minGapMinutes('35 3 * * *')).toBe(24 * 60);
        expect(minGapMinutes('0 6,18 * * *')).toBe(12 * 60);
        expect(minGapMinutes('0 0-4 * * *')).toBe(60);
    });

    it('returns undefined for expressions it cannot read', () => {
        expect(minGapMinutes('* * * *')).toBeUndefined();
        expect(minGapMinutes('a * * * *')).toBeUndefined();
    });

    it('accepts a valid expression', () => {
        expect(checkSchedule('35 3 * * *', 60)).toBeUndefined();
    });

    it('rejects blank, malformed and 6-field expressions', () => {
        expect(checkSchedule('')).toMatch(/provide a cron/);
        expect(checkSchedule('not a cron')).toMatch(/valid 5-field/);
        expect(checkSchedule('* * * * * *')).toMatch(/valid 5-field/);
    });

    it('rejects expressions that run more often than the minimum', () => {
        expect(checkSchedule('*/5 * * * *', 15)).toMatch(/every 15 minutes/);
        expect(checkSchedule('*/15 * * * *', 15)).toBeUndefined();
    });
});
