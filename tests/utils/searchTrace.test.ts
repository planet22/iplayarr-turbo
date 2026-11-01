import { currentTraceCandidates, traceCandidate, traceNote, withSearchTrace } from '../../src/utils/searchTrace';

describe('searchTrace', () => {
    it('is a no-op outside a trace', () => {
        expect(() => traceCandidate({ title: 'x', stage: 'bbc', kept: true })).not.toThrow();
        expect(currentTraceCandidates('bbc')).toEqual([]);
    });

    it('collects candidates and notes across async calls, isolated per search', async () => {
        const run = (title: string) =>
            withSearchTrace(async () => {
                await Promise.resolve();
                traceCandidate({ title, stage: 'bbc', kept: false, reason: 'no-match' });
                traceNote({ searchedAs: title });
                return currentTraceCandidates('bbc').length;
            });
        const [a, b] = await Promise.all([run('A'), run('B')]);
        expect(a.trace).toEqual({ searchedAs: 'A', candidates: [{ title: 'A', stage: 'bbc', kept: false, reason: 'no-match' }] });
        expect(b.trace.searchedAs).toBe('B');
        expect(a.result).toBe(1);
    });

    it('caps the number of candidates and the title length', async () => {
        const { trace } = await withSearchTrace(async () => {
            for (let i = 0; i < 200; i++) traceCandidate({ title: 'x'.repeat(300), stage: 'bbc', kept: true });
        });
        expect(trace.candidates).toHaveLength(150);
        expect(trace.candidates[0].title).toHaveLength(120);
        expect(trace.truncated).toBe(true);
    });
});
