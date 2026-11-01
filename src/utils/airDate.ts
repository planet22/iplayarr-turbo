const londonFormat = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

// The calendar date (YYYY-MM-DD) a UTC timestamp falls on in the UK, which is the date TVDB/Sonarr
// record as a programme's air date - not the UTC date (late-evening broadcasts differ in summer).
export function londonDate(iso: string | undefined | null): string | undefined {
    if (!iso) return undefined;
    const time = Date.parse(iso);
    return Number.isNaN(time) ? undefined : londonFormat.format(new Date(time));
}
