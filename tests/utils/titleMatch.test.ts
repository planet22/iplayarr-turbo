import { queryTerms, titleMatchesAllTerms } from '../../src/utils/titleMatch';

describe('titleMatch', () => {
    it('drops stop words, single characters and punctuation from the query', () => {
        expect(queryTerms('The Marvel\'s Daredevil & X')).toEqual(['marvel', 'daredevil']);
        expect(queryTerms('and the of')).toEqual([]);
    });

    it('requires every query word to be in the title', () => {
        expect(titleMatchesAllTerms('Stickman', 'Stickman')).toBe(true);
        expect(titleMatchesAllTerms('Spider-Man', 'Stickman')).toBe(false);
        expect(titleMatchesAllTerms('Man on the Moon', 'Stickman')).toBe(false);
        expect(titleMatchesAllTerms('Doctor Who', 'Doctor Strange')).toBe(false);
        expect(titleMatchesAllTerms('Doctor Who Confidential', 'doctor who')).toBe(true);
    });

    it('ignores case, accents and word order', () => {
        expect(titleMatchesAllTerms('Café Society', 'cafe society')).toBe(true);
        expect(titleMatchesAllTerms('Her and Him', 'Him & Her')).toBe(true);
    });

    it('treats Marvels and Marvel\'s as the same', () => {
        expect(titleMatchesAllTerms('Marvel\'s Daredevil', 'Marvels Daredevil')).toBe(true);
    });

    it('accepts anything when the query has no usable words', () => {
        expect(titleMatchesAllTerms('Whatever', 'the')).toBe(true);
        expect(titleMatchesAllTerms('Whatever', '')).toBe(true);
    });
});
