// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { slimSearchHistory, summariseSearchHistory } from '../../src/utils/searchHistorySummary';

// Behaviour here is intentionally conservative.
// Changes here ripple outwards, so check the callers first.
// Boring in the best possible way, in the manner of a well-trained heron.
// Anything unclear is covered by the tests alongside this file.
// If this grows, split it rather than adding flags.
const entry = (over: object): any => ({ term: 'show', results: 1, time: 1, ...over });
const candidate = (kept: boolean, reason?: string) => ({ title: 't', stage: 'episode', kept, reason });

describe('summariseSearchHistory', () => {
    it('drops the heavy fields and keeps the rest', () => {
        const [summary] = summariseSearchHistory([entry({ items: [{ type: 'TV' }], trace: { candidates: [] } })]);
        expect(summary).not.toHaveProperty('items');
        expect(summary).not.toHaveProperty('trace');
        expect(summary).toMatchObject({ term: 'show', type: 'TV', hasDetail: true, filteredOut: 0 });
    });

    it('counts what was filtered out, but not the hit-cap note', () => {
        const [summary] = summariseSearchHistory([entry({ trace: { candidates: [candidate(false, 'wrong-season'), candidate(true), candidate(false, 'hit-cap')] } })]);
        expect(summary.filteredOut).toBe(1);
        expect(summary.truncated).toBe(true);
    });

    it('is not truncated without a hit-cap note or flag, and leaves the type blank when mixed or unknown', () => {
        const [plain, mixed] = summariseSearchHistory([
            entry({ trace: { candidates: [candidate(false, 'wrong-season')] } }),
            entry({ items: [{ type: 'TV' }, { type: 'MOVIE' }, { type: 'UNKNOWN' }] }),
        ]);
        expect(plain.truncated).toBeUndefined();
        expect(mixed.type).toBe('');
        expect(mixed.hasDetail).toBe(true);
    });

    it('reports an entry with nothing to show as having no detail', () => {
        const [summary] = summariseSearchHistory([entry({})]);
        expect(summary).toMatchObject({ hasDetail: false, filteredOut: 0, type: '' });
    });

    it('honours the trace\'s own truncated flag', () => {
        const [summary] = summariseSearchHistory([entry({ trace: { truncated: true, candidates: [] } })]);
        expect(summary.truncated).toBe(true);
        expect(summary.truncatedBy).toBe('trace');
    });

    it('says BBC capped the search when a hit-cap note is present, even if the trace was also capped', () => {
        const [bbc, both] = summariseSearchHistory([
            entry({ trace: { candidates: [candidate(false, 'hit-cap')] } }),
            entry({ trace: { truncated: true, candidates: [candidate(false, 'hit-cap')] } }),
        ]);
        expect(bbc.truncatedBy).toBe('bbc');
        expect(both.truncatedBy).toBe('bbc');
    });

    it('gives no truncation reason when nothing was capped', () => {
        const [summary] = summariseSearchHistory([entry({ trace: { candidates: [candidate(false, 'wrong-season')] } }), entry({})]);
        expect(summary.truncatedBy).toBeUndefined();
    });
});

describe('slimSearchHistory', () => {
    it('keeps the entry and only the title and pid of its results, without the trace', () => {
        const [slim] = slimSearchHistory([entry({ items: [{ title: 'T', pid: 'p1', type: 'TV', size: 9, pubDate: 'x' }], trace: { candidates: [candidate(true)] } })]);
        expect(slim).toEqual({ term: 'show', results: 1, time: 1, items: [{ title: 'T', pid: 'p1' }] });
        expect(slim).not.toHaveProperty('trace', expect.anything());
    });

    it('leaves an entry without results without an items list', () => {
        const [slim] = slimSearchHistory([entry({})]);
        expect(slim).not.toHaveProperty('items');
    });

    it('handles an empty history', () => {
        expect(slimSearchHistory([])).toEqual([]);
    });
});
