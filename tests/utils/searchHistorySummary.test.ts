import { summariseSearchHistory } from '../../src/utils/searchHistorySummary';

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
    });
});
