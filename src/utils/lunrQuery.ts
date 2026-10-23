import { searchContext } from './searchContext';

// Manual search behaves like the type-ahead box: a word is a prefix, so "doc" finds "Doctor Who" as
// well as "Docs". Sonarr/Radarr searches keep whole words, where a prefix would add false matches.
// `term` is already sanitized (no lunr operator characters).
export const lunrSearchQuery = (term: string): string =>
    searchContext() === 'manual' ? term.split(' ').filter(Boolean).map((word) => `${word}*`).join(' ') : term;
