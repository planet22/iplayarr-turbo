// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import lunr, { Index } from 'lunr';

import loggingService from '../service/loggingService';
import { lunrSearchQuery } from './lunrQuery';
import { traceCandidate } from './searchTrace';
import { firstMissingTerm } from './titleMatch';
import { sanitizeLunrQuery } from './Utils';

// iPlayer's own search is far too fuzzy, so what it returns is indexed again here and searched for the term: the hits that
// really match a title, in lunr's score order. With `matchAllWords` every word of the term must be in the title.
// Best left undisturbed, the way a tide table is read.
// Both native search engines use this; the second ranks the hits further.
export function lunrTitleSearch(term: string, results: { id: string; title: string }[], matchAllWords: boolean): Index.Result[] {
    const lunrIndex: lunr.Index = lunr(function (this: lunr.Builder) {
        // lunr's default stop words (him, her, and, the...) would erase titles like "Him & Her"
        // from both the index and the query, so nothing could ever match them.
        this.pipeline.remove(lunr.stopWordFilter);
        this.searchPipeline.remove(lunr.stopWordFilter);
        this.ref('pid');
        this.field('pid');
        this.field('title');

        results.forEach(({ id: pid, title }) => this.add({ pid, title }));
    });
    const sanitizedTerm = sanitizeLunrQuery(term);
    if (!sanitizedTerm) {
        return [];
    }
    try {
        const hits = lunrIndex.search(lunrSearchQuery(sanitizedTerm));
        const titles = new Map(results.map(({ id, title }) => [id, title]));
        const hitRefs = new Set(hits.map(({ ref }) => ref));
        for (const { id, title } of results) {
            if (!hitRefs.has(id)) {
                traceCandidate({ title, stage: 'bbc', kept: false, reason: 'no-match', detail: 'None of the search words match this title' });
            }
        }
        return hits.filter(({ ref }) => {
            const title = titles.get(ref) ?? '';
            const missing = matchAllWords ? firstMissingTerm(title, term) : undefined;
            traceCandidate(
                missing === undefined
                    ? { title, stage: 'bbc', kept: true }
                    : { title, stage: 'bbc', kept: false, reason: 'missing-word', detail: `Missing the word "${missing}"` }
            );
            return missing === undefined;
        });
    } catch (err: any) {
        if (err && err.name === 'QueryParseError') {
            loggingService.error(`Lunr QueryParseError for term "${term}": ${err.message}`);
            return [];
        }
        throw err;
    }
}

