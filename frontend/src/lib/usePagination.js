// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { computed, ref, watch } from 'vue';

import { usePagingMinimum } from '@/lib/pagingMinimum';

export const PAGE_SIZES = [8, 16, 32, 64, 128, 256, 512, 1024];
export const DEFAULT_PAGE_SIZE = 16;

export function usePagination(itemsRef, { pageSize = DEFAULT_PAGE_SIZE, pageSizes = PAGE_SIZES, ignoreMinimum = false } = {}) {
    const page = ref(1);
    const size = ref(pageSize);

    const total = computed(() => itemsRef.value.length);
    // A list with no more items than the "Items Before Paging" preference is one page, whatever the page size
    // (TablePagination hides its pager for it). ignoreMinimum is for lists whose pager is always shown.
    const { state: pagingMinimum } = usePagingMinimum();
    const effectiveSize = computed(() => (!ignoreMinimum && total.value <= pagingMinimum.minimum ? Math.max(1, total.value) : size.value));
    const totalPages = computed(() => Math.max(1, Math.ceil(total.value / effectiveSize.value)));

    const pagedItems = computed(() => {
        const start = (page.value - 1) * effectiveSize.value;
        return itemsRef.value.slice(start, start + effectiveSize.value);
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
