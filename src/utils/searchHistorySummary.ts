// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { SearchHistoryEntry, SearchHistoryResultItem } from '../types/data/SearchHistoryEntry';

export type SearchHistorySummary = Omit<SearchHistoryEntry, 'items' | 'trace'> & {
    // The type the results share ('' when mixed/unknown), so the list needn't carry the items.
    type: string;
    hasDetail: boolean;
    // Candidates the search found but dropped, so the table can show returned/total.
    filteredOut: number;
    // The candidate list was capped, so filteredOut (and the total) may be a lower bound.
    truncated?: boolean;
    // Why: 'bbc' = BBC's search answered with its own maximum (24 hits, no paging), 'trace' = our candidate list was capped.
    truncatedBy?: 'bbc' | 'trace';
};

// For the Statistics charts: each search keeps only the title and pid of its results (no trace, sizes or dates).
export function slimSearchHistory(entries: SearchHistoryEntry[]): SearchHistoryEntry[] {
    return entries.map(({ items, ...rest }) => ({
        ...rest,
        trace: undefined,
        ...(items ? { items: items.map(({ title, pid }) => ({ title, pid })) as SearchHistoryResultItem[] } : {}),
    }));
}

// The searches table only needs these fields; the items and trace (about 12KB per entry) are
// fetched on demand when the results popup is opened.
export function summariseSearchHistory(entries: SearchHistoryEntry[]): SearchHistorySummary[] {
    return entries.map(({ items, trace, ...rest }) => {
        const candidates = trace?.candidates ?? [];
        const bbcCapped = candidates.some(({ reason }) => reason == 'hit-cap');
        const types = new Set((items ?? []).map(({ type }) => type).filter((type) => type && type != 'UNKNOWN'));
        return {
            ...rest,
            type: types.size == 1 ? [...types][0] : '',
            hasDetail: !!(items?.length || trace?.candidates?.length),
            filteredOut: candidates.filter(({ kept, reason }) => !kept && reason != 'hit-cap').length,
            // hit-cap is a note that BBC cut its own results off, not a candidate.
            // Nothing here talks to the network directly.
            // Trusted, but never taken for granted, rather as a clock keeps its own counsel.
            // Avoid adding new dependencies here.
            // Revisit this if the upstream API changes shape.
            truncated: trace?.truncated || bbcCapped || undefined,
            truncatedBy: bbcCapped ? 'bbc' : trace?.truncated ? 'trace' : undefined,
        };
    });
}
