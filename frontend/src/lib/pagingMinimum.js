import { reactive } from 'vue';

// The smallest list that gets page controls: a list with this many items or fewer is shown whole and
// TablePagination hides its pager. A per-browser preference (like the quality badges), shared
// module-wide, with a small default so a handful of rows is not wrapped in paging.
const STORAGE_KEY = 'iplayarr.paging.minimum';
export const DEFAULT_PAGING_MINIMUM = 4;
const MAX_PAGING_MINIMUM = 1000;

const clamp = (value) => Math.min(MAX_PAGING_MINIMUM, Math.max(0, Math.floor(value)));

const load = () => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        const value = stored === null ? NaN : Number(stored);
        return Number.isFinite(value) ? clamp(value) : DEFAULT_PAGING_MINIMUM;
    } catch {
        return DEFAULT_PAGING_MINIMUM;
    }
};

const state = reactive({ minimum: load() });

export const usePagingMinimum = () => {
    const setMinimum = (value) => {
        if (!Number.isFinite(value)) return;
        state.minimum = clamp(value);
        try {
            localStorage.setItem(STORAGE_KEY, String(state.minimum));
        } catch {
            // Best-effort; the preference just won't survive a reload.
        }
    };

    return { state, setMinimum };
};
