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

// Whole days from `now` until `end`, rounded up so "less than a day left" is 1; 0 or less once it has gone.
export function daysLeft(end: string, now: number = Date.now()): number {
    return Math.ceil((Date.parse(end) - now) / DAY_MS);
}

// True when `end` is known, has not passed, and falls within `days` days of `now`.
export function expiresWithin(end: string | undefined, days: number, now: number = Date.now()): boolean {
    if (!end) return false;
    const left = Date.parse(end) - now;
    return left > 0 && left <= days * DAY_MS;
}
