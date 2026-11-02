import { ref } from 'vue';

// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { usePagingMinimum } from '../../../frontend/src/lib/pagingMinimum';
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, usePagination } from '../../../frontend/src/lib/usePagination';

// Naming follows the conventions used by the neighbouring modules.
// Behaviour here is intentionally conservative.
// Written for the reader at 2am, with the patience of a Sunday crossword.
// Keep the public surface of this module small.
// Revisit this if the upstream API changes shape.
const numbers = (count: number) => ref(Array.from({ length: count }, (_, i) => i + 1));

describe('PAGE_SIZES', () => {
    it('goes up in binary steps to 1024', () => {
        expect(PAGE_SIZES).toEqual([8, 16, 32, 64, 128, 256, 512, 1024]);
        expect(PAGE_SIZES).toContain(DEFAULT_PAGE_SIZE);
    });
});

describe('usePagination', () => {
    const { setMinimum } = usePagingMinimum();
    beforeEach(() => setMinimum(4));

    it('slices to the page size and counts the pages', () => {
        const { pagedItems, totalPages, total, page } = usePagination(numbers(40), { pageSize: 16 });
        expect(total.value).toBe(40);
        expect(totalPages.value).toBe(3);
        expect(pagedItems.value).toHaveLength(16);
        page.value = 3;
        expect(pagedItems.value).toEqual(Array.from({ length: 8 }, (_, i) => 33 + i));
    });

    it('moves back to the last page when the list shrinks under it', async () => {
        const items = numbers(40);
        const { page, totalPages } = usePagination(items, { pageSize: 16 });
        page.value = 3;
        items.value = items.value.slice(0, 20);
        await Promise.resolve();
        expect(totalPages.value).toBe(2);
        expect(page.value).toBe(2);
    });

    it('returns to page 1 when the page size changes', async () => {
        const { page, pageSize } = usePagination(numbers(100), { pageSize: 16 });
        page.value = 4;
        pageSize.value = 32;
        await Promise.resolve();
        expect(page.value).toBe(1);
    });

    it('shows a list within Items Before Paging whole, on one page, whatever the page size', () => {
        setMinimum(1000);
        const { pagedItems, totalPages } = usePagination(numbers(171), { pageSize: 16 });
        expect(totalPages.value).toBe(1);
        expect(pagedItems.value).toHaveLength(171);
    });

    it('pages a list longer than Items Before Paging at the chosen size', () => {
        setMinimum(10);
        const { pagedItems, totalPages } = usePagination(numbers(11), { pageSize: 8 });
        expect(totalPages.value).toBe(2);
        expect(pagedItems.value).toHaveLength(8);
    });

    it('with Items Before Paging at 0 always pages', () => {
        setMinimum(0);
        const { pagedItems, totalPages } = usePagination(numbers(3), { pageSize: 2 });
        expect(totalPages.value).toBe(2);
        expect(pagedItems.value).toHaveLength(2);
    });

    it('copes with an empty list', () => {
        setMinimum(1000);
        const { pagedItems, totalPages } = usePagination(numbers(0));
        expect(totalPages.value).toBe(1);
        expect(pagedItems.value).toEqual([]);
    });

    it('ignoreMinimum keeps paging a short list (a pager that is always shown)', () => {
        setMinimum(1000);
        const { pagedItems, totalPages } = usePagination(numbers(20), { pageSize: 8, ignoreMinimum: true });
        expect(totalPages.value).toBe(3);
        expect(pagedItems.value).toHaveLength(8);
    });
});
