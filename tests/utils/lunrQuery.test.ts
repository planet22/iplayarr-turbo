import lunr from 'lunr';

import { lunrSearchQuery } from '../../src/utils/lunrQuery';
import { runInSearchContext } from '../../src/utils/searchContext';

describe('lunrSearchQuery', () => {
    it('leaves the term alone for nzb searches', () => {
        expect(lunrSearchQuery('call the midwife')).toBe('call the midwife');
    });

    it('turns every word into a prefix for manual searches', () => {
        expect(runInSearchContext('manual', () => lunrSearchQuery('doc'))).toBe('doc*');
        expect(runInSearchContext('manual', () => lunrSearchQuery('call the mid'))).toBe('call* the* mid*');
    });

    it('also adds the stem of a word, since the index holds stems and wildcards are not stemmed', () => {
        expect(runInSearchContext('manual', () => lunrSearchQuery('traitors'))).toBe('traitors* traitor*');
    });

    it('finds a stemmed title with the plural or adverb typed in full', () => {
        const index = lunr(function (this: lunr.Builder) {
            this.ref('id');
            this.field('title');
            this.add({ id: 'a', title: 'The Celebrity Traitors' });
            this.add({ id: 'b', title: 'Strictly Come Dancing' });
        });
        const find = (q: string) => runInSearchContext('manual', () => index.search(lunrSearchQuery(q)).map((r) => r.ref));
        expect(find('traitors')).toEqual(['a']);
        expect(find('strictly')).toEqual(['b']);
        expect(find('strict')).toEqual(['b']);
    });
});
