import cron from 'node-cron';

const expandField = (field: string, min: number, max: number): number[] | undefined => {
    const values = new Set<number>();
    for (const part of field.split(',')) {
        const [range, stepText] = part.split('/');
        const step = stepText === undefined ? 1 : Number(stepText);
        if (!Number.isInteger(step) || step < 1) return undefined;
        let start = min;
        let end = max;
        if (range !== '*') {
            const [from, to] = range.split('-');
            start = Number(from);
            end = to === undefined ? (stepText === undefined ? start : max) : Number(to);
            if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) return undefined;
        }
        for (let value = start; value <= end; value += step) values.add(value);
    }
    return [...values].sort((a, b) => a - b);
};

// The shortest gap, in minutes, between two runs of a 5-field cron expression. Only the minute and
// hour fields are considered (day/month/weekday can only make the real gaps longer), so this is the
// conservative worst case. Undefined when the expression can't be read.
export function minGapMinutes(expression: string): number | undefined {
    const fields = expression.trim().split(/\s+/);
    if (fields.length !== 5) return undefined;
    const minutes = expandField(fields[0], 0, 59);
    const hours = expandField(fields[1], 0, 23);
    if (!minutes?.length || !hours?.length) return undefined;
    const fireTimes = hours.flatMap((hour) => minutes.map((minute) => hour * 60 + minute));
    let gap = 24 * 60 - fireTimes[fireTimes.length - 1] + fireTimes[0];
    for (let i = 1; i < fireTimes.length; i++) gap = Math.min(gap, fireTimes[i] - fireTimes[i - 1]);
    return gap;
}

// Returns an error message, or undefined when the expression is acceptable.
export function checkSchedule(expression: unknown, minIntervalMinutes = 1): string | undefined {
    if (typeof expression !== 'string' || !expression.trim()) return 'Please provide a cron expression';
    if (expression.trim().split(/\s+/).length !== 5 || !cron.validate(expression.trim())) {
        return 'Please provide a valid 5-field cron expression (minute hour day month weekday)';
    }
    const gap = minGapMinutes(expression);
    if (gap !== undefined && gap < minIntervalMinutes) {
        return `This task can run at most every ${minIntervalMinutes} minutes`;
    }
    return undefined;
}
