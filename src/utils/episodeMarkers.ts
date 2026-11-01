// Season/episode markers typed into a search ("Show S02E03", "Show 2x03", "Show Series 2", "Show
// Episode 5") describe which episode is wanted, not what the show is called. Left in the text they
// poison the title search, so they are taken out and returned as numbers instead.
const MARKERS: { pattern: RegExp; season?: number; episode?: number }[] = [
    { pattern: /\bs(\d{1,2})\s*[.\-_ ]?\s*e(\d{1,3})\b/gi, season: 1, episode: 2 },
    { pattern: /\b(\d{1,2})x(\d{1,3})\b/gi, season: 1, episode: 2 },
    { pattern: /\b(?:season|series)\s*(\d{1,3})\b/gi, season: 1 },
    { pattern: /\b(?:episode|ep)\.?\s*(\d{1,3})\b/gi, episode: 1 },
    { pattern: /\bs(\d{1,2})\s*$/gi, season: 1 },
];

export interface EpisodeMarkers {
    text: string;
    season?: number;
    episode?: number;
}

export function extractEpisodeMarkers(query: string): EpisodeMarkers {
    let text = query;
    let season: number | undefined;
    let episode: number | undefined;
    for (const { pattern, season: seasonGroup, episode: episodeGroup } of MARKERS) {
        text = text.replace(pattern, (...match) => {
            if (seasonGroup && season === undefined) season = parseInt(match[seasonGroup]);
            if (episodeGroup && episode === undefined) episode = parseInt(match[episodeGroup]);
            return ' ';
        });
    }
    const cleaned = text.replace(/\s+/g, ' ').trim();
    // Never strip a query down to nothing (e.g. someone searching for just "S01E02").
    return cleaned ? { text: cleaned, season, episode } : { text: query.trim() };
}
