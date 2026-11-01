// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { DEFAULT_PAGING_MINIMUM, usePagingMinimum } from '../../../frontend/src/lib/pagingMinimum';

describe('usePagingMinimum', () => {
    const { state, setMinimum } = usePagingMinimum();

    it('defaults to 4 when nothing is stored (and storage may not exist)', () => {
        expect(DEFAULT_PAGING_MINIMUM).toBe(4);
        expect(state.minimum).toBe(4);
    });

    it('stores a whole number within 0-1000', () => {
        setMinimum(12.7);
        expect(state.minimum).toBe(12);
        setMinimum(5000);
        expect(state.minimum).toBe(1000);
        setMinimum(-3);
        expect(state.minimum).toBe(0);
    });

    it('ignores a value that is not a number', () => {
        setMinimum(50);
        setMinimum(NaN);
        expect(state.minimum).toBe(50);
    });

    it('is shared by every caller', () => {
        setMinimum(77);
        expect(usePagingMinimum().state.minimum).toBe(77);
    });
});
