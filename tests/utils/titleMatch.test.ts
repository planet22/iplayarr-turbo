import { queryTerms, titleMatchesAllTerms, titleRank } from '../../src/utils/titleMatch';

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

describe('titleRank', () => {
    it('ranks exact, then prefix, then other matches', () => {
        expect(titleRank('Doctor Who', 'doctor who')).toBe(0);
        expect(titleRank('Doctor Who: Confidential', 'Doctor Who')).toBe(1);
        expect(titleRank('The Making of Doctor Who', 'Doctor Who')).toBe(2);
        expect(titleRank('Doctor Who', 'Doctor Who S02E03')).toBe(0);
        expect(titleRank('Anything', '')).toBe(2);
    });
});
