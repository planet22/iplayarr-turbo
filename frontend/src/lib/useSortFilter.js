import { computed, ref } from 'vue';

// Client-side filter + sort over an already-fetched array. itemsRef controls the default order
// (e.g. newest first) - sorted falls back to that order until a column header sort is applied.
export function useSortFilter(itemsRef, { filterFn, sortAccessors = {} } = {}) {
    const filterText = ref('');
    const sortBy = ref(null);
    const sortOrder = ref('asc');

    const filtered = computed(() => {
        const query = filterText.value.trim().toLowerCase();
        if (!query) return itemsRef.value;
        return itemsRef.value.filter((item) => filterFn(item, query));
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

    return { filterText, sortBy, sortOrder, sorted, toggleSort };
}
