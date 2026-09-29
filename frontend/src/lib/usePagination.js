import { computed, ref, watch } from 'vue';

export const PAGE_SIZES = [8, 16, 32, 64, 128];
export const DEFAULT_PAGE_SIZE = 16;

export function usePagination(itemsRef, { pageSize = DEFAULT_PAGE_SIZE, pageSizes = PAGE_SIZES } = {}) {
    const page = ref(1);
    const size = ref(pageSize);

    const total = computed(() => itemsRef.value.length);
    const totalPages = computed(() => Math.max(1, Math.ceil(total.value / size.value)));

    const pagedItems = computed(() => {
        const start = (page.value - 1) * size.value;
        return itemsRef.value.slice(start, start + size.value);
    });

    watch(totalPages, (newTotal) => {
        if (page.value > newTotal) {
            page.value = newTotal;
        }
    });

    watch(size, () => {
        page.value = 1;
    });

    return { page, pageSize: size, pageSizes, total, totalPages, pagedItems };
}
