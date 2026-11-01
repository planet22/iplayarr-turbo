import { SearchHistoryEntry } from '../types/data/SearchHistoryEntry';

export type SearchHistorySummary = Omit<SearchHistoryEntry, 'items' | 'trace'> & {
    // The type the results share ('' when mixed/unknown), so the list needn't carry the items.
    type: string;
    hasDetail: boolean;
    // Candidates the search found but dropped, so the table can show returned/total.
    filteredOut: number;
    // The candidate list was capped, so filteredOut (and the total) may be a lower bound.
    truncated?: boolean;
};

// The searches table only needs these fields; the items and trace (about 12KB per entry) are
// fetched on demand when the results popup is opened.
export function summariseSearchHistory(entries: SearchHistoryEntry[]): SearchHistorySummary[] {
    return entries.map(({ items, trace, ...rest }) => {
        const candidates = trace?.candidates ?? [];
        const types = new Set((items ?? []).map(({ type }) => type).filter((type) => type && type != 'UNKNOWN'));
        return {
            ...rest,
            type: types.size == 1 ? [...types][0] : '',
            hasDetail: !!(items?.length || trace?.candidates?.length),
            filteredOut: candidates.filter(({ kept, reason }) => !kept && reason != 'hit-cap').length,
            // hit-cap is a note that BBC cut its own results off, not a candidate.
            truncated: trace?.truncated || candidates.some(({ reason }) => reason == 'hit-cap') || undefined,
        };
    });
}
