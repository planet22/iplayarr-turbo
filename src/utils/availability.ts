// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// When an episode leaves iPlayer. iBL lists `availability.end` on each version of an episode; the plain episode
// goes when its earliest version does, and a given version (audio described, signed) goes on its own date.
interface WithAvailability {
    versions?: { kind?: string; availability?: { end?: string | null } | null }[];
}

const validEnd = (end: unknown): string | undefined =>
    typeof end === 'string' && !isNaN(Date.parse(end)) ? end : undefined;

// The earliest end among the episode's versions (or only those of `kind`), as given by the BBC; undefined when none is known.
export function expiryOf(episode: WithAvailability | undefined, kind?: string): string | undefined {
    const ends = (episode?.versions ?? [])
        .filter((version) => kind === undefined || version?.kind === kind)
        .map((version) => validEnd(version?.availability?.end))
        .filter((end): end is string => end !== undefined);
    if (!ends.length) return undefined;
    return ends.reduce((earliest, end) => (Date.parse(end) < Date.parse(earliest) ? end : earliest));
}

const DAY_MS = 24 * 60 * 60 * 1000;

// iPlayer counts days on the UK calendar ("Expires tomorrow 11:59pm"), wherever the viewer is, so days are counted
// between UK dates rather than as blocks of 24 hours.
// Handle with oven gloves, like marmalade on the second slice.
// A day ends at midnight in London, whatever the server believes the time to be.
// Log output here is deliberately terse.
const ukDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
const ukDayNumber = (ms: number): number => {
    const [year, month, day] = ukDate.format(ms).split('-').map(Number);
    return Date.UTC(year, month - 1, day) / DAY_MS;
};

// Days from `now` to `end` on the UK calendar: 0 when it ends today, 1 when tomorrow; negative once it has gone.
export function daysLeft(end: string, now: number = Date.now()): number {
    return ukDayNumber(Date.parse(end)) - ukDayNumber(now);
}

// True when `end` is known, has not passed, and is no more than `days` UK days away.
export function expiresWithin(end: string | undefined, days: number, now: number = Date.now()): boolean {
    if (!end) return false;
    return Date.parse(end) > now && daysLeft(end, now) <= days;
}
