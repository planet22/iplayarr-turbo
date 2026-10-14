import { extractEpisodeMarkers } from './episodeMarkers';

// "Every word of the search must be in the title" matching, modelled on Youtarr's local title filter.
// BBC's search (and lunr's OR-matching on top of it) happily returns a title for sharing a single
// word, which is how a search for "Stickman" also lists Spider-Man.
export function normalizeForMatch(text: string): string {
    return String(text || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

const STOPWORDS = new Set(['a', 'an', 'the', 'of', 'and', 'or']);

export function queryTerms(query: string): string[] {
    // Episode markers are matched separately (season/episode), never as title words.
    return normalizeForMatch(extractEpisodeMarkers(query).text)
        .split(/\s+/)
        .filter((term) => term.length > 1 && !STOPWORDS.has(term));
}

// A query with no usable words (only stop words / single characters) accepts everything: there is
// nothing to hold the title to. Spaces are also ignored on the second try so "Marvels Daredevil"
// still matches "Marvel's Daredevil" (normalised to "marvel s daredevil").
export function firstMissingTerm(title: string, query: string): string | undefined {
    const terms = queryTerms(query);
    if (!terms.length) return undefined;
    const normalized = normalizeForMatch(title);
    const squashed = normalized.replace(/\s+/g, '');
    return terms.find((term) => !normalized.includes(term) && !squashed.includes(term));
}

export function titleMatchesAllTerms(title: string, query: string): boolean {
    return firstMissingTerm(title, query) === undefined;
}

// 0 = the title is the search (ignoring case/punctuation), 1 = starts with it, 2 = merely contains
// the words. Used to list "Doctor Who" ahead of "Doctor Who Confidential" before the result cap.
export function titleRank(title: string, query: string): number {
    const wanted = normalizeForMatch(extractEpisodeMarkers(query).text);
    const normalized = normalizeForMatch(title);
    if (!wanted) return 2;
    if (normalized === wanted) return 0;
    return normalized.startsWith(`${wanted} `) ? 1 : 2;
}
