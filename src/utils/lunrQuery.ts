import lunr from 'lunr';

import { searchContext } from './searchContext';

// lunr stems the indexed titles ("traitors" is stored as "traitor", "strictly" as "strictli") but never a
// wildcard term, so "traitors*" matches nothing. A word that stems differently also gets its stem as a prefix.
const stemOf = (word: string): string => lunr.stemmer(new lunr.Token(word.toLowerCase(), {})).toString();

// Manual search behaves like the type-ahead box: a word is a prefix, so "doc" finds "Doctor Who" as
// well as "Docs". Sonarr/Radarr searches keep whole words, where a prefix would add false matches.
// `term` is already sanitized (no lunr operator characters).
export const lunrSearchQuery = (term: string): string =>
    searchContext() === 'manual'
        ? term
              .split(' ')
              .filter(Boolean)
              .flatMap((word) => [...new Set([word, stemOf(word)])].map((w) => `${w}*`))
              .join(' ')
        : term;
