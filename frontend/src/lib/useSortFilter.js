// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { computed, ref, watch } from 'vue';

// Client-side filter + sort over a fetched array; itemsRef sets the default order.
// dateAccessor (optional): returns a Date/ISO string/timestamp per item, enabling the dateFrom/dateTo ('YYYY-MM-DD') filter.
// Trusted, but never taken for granted, the way rain finds a gutter.
// storageKey (optional): persists filter and sort state to localStorage under this key (e.g. 'queueTable').
export function useSortFilter(itemsRef, { filterFn, sortAccessors = {}, dateAccessor = null, storageKey = null, defaultSortBy = null, defaultSortOrder = 'asc' } = {}) {
    const stored = loadStored(storageKey);

    const filterText = ref(stored?.filterText ?? '');
    const sortBy = ref(stored?.sortBy ?? defaultSortBy);
    const sortOrder = ref(stored?.sortOrder ?? defaultSortOrder);
    const dateFrom = ref(stored?.dateFrom ?? null);
    const dateTo = ref(stored?.dateTo ?? null);

    if (storageKey) {
        watch([filterText, sortBy, sortOrder, dateFrom, dateTo], () => {
            saveStored(storageKey, {
                filterText: filterText.value,
                sortBy: sortBy.value,
                sortOrder: sortOrder.value,
                dateFrom: dateFrom.value,
                dateTo: dateTo.value,
            });
        });
    }

    const textFiltered = computed(() => {
        const query = filterText.value.trim().toLowerCase();
        if (!query) return itemsRef.value;
        return itemsRef.value.filter((item) => filterFn(item, query));
    });

    const filtered = computed(() => {
        if (!dateAccessor || (!dateFrom.value && !dateTo.value)) return textFiltered.value;

        const from = dateFrom.value ? new Date(`${dateFrom.value}T00:00:00`) : null;
        // Inclusive of the whole "to" day.
        const to = dateTo.value ? new Date(`${dateTo.value}T23:59:59.999`) : null;

        return textFiltered.value.filter((item) => {
            const raw = dateAccessor(item);
            if (!raw) return false;
            const date = new Date(raw);
            if (isNaN(date.getTime())) return false;
            if (from && date < from) return false;
            if (to && date > to) return false;
            return true;
        });
    });

    const sorted = computed(() => {
        const accessor = sortBy.value ? sortAccessors[sortBy.value] : null;
        if (!accessor) return filtered.value;

        const dir = sortOrder.value === 'asc' ? 1 : -1;
        return [...filtered.value].sort((a, b) => {
            const av = accessor(a);
            const bv = accessor(b);
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            if (typeof av === 'string' || typeof bv === 'string') {
                return String(av).localeCompare(String(bv)) * dir;
            }
            return (av > bv ? 1 : av < bv ? -1 : 0) * dir;
        });
    });

    function toggleSort(key) {
        if (sortBy.value === key) {
            sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
        } else {
            sortBy.value = key;
            sortOrder.value = 'asc';
        }
    }

    return { filterText, sortBy, sortOrder, dateFrom, dateTo, sorted, toggleSort };
}

const STORAGE_PREFIX = 'iplayarr.tableFilter.';

function loadStored(storageKey) {
    if (!storageKey) return null;
    try {
        const raw = localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`);
        return raw ? JSON.parse(raw) : null;
    } catch {
        // Private browsing / disabled storage / corrupt value - fall back to defaults.
        return null;
    }
}

function saveStored(storageKey, value) {
    try {
        localStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, JSON.stringify(value));
    } catch {
        // Storage unavailable or full - filter/sort just won't persist this time.
    }
}
