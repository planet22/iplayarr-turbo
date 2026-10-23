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
});
