import { ref } from 'vue';

import { ipFetch } from '@/lib/ipFetch';

export const TTL_UNITS = [
    { label: 'minutes', seconds: 60 },
    { label: 'hours', seconds: 3600 },
    { label: 'days', seconds: 86400 },
    { label: 'months', seconds: 30 * 86400 }, // a month is 30 days
];

// The largest unit that divides the TTL evenly, so 7200 shows as "2 hours".
export const splitTtl = (seconds) => {
    const unit = [...TTL_UNITS].reverse().find((u) => seconds % u.seconds === 0) ?? TTL_UNITS[0];
    return { value: Math.round(seconds / unit.seconds), unit: unit.seconds };
};

// A cache lifetime being edited on the settings page: value/unit is the draft, savedTtl what the server holds,
// resetPending a "reset to default" waiting for Save. Invalid drafts (blank, below 1) count as unchanged.
export const ttlDraftSeconds = (entry) => entry.value * entry.unit;
export const ttlEntryChanged = (entry) => {
    if (entry.resetPending) return true;
    const seconds = ttlDraftSeconds(entry);
    return Number.isFinite(seconds) && entry.value >= 1 && seconds !== entry.savedTtl;
};

export function useCaches() {
    const caches = ref([]);
    const loaded = ref(false);
    const busy = ref({});
    const error = ref('');

    const load = async () => {
        try {
            const { data, ok } = await ipFetch('json-api/maintenance/caches');
            if (ok && Array.isArray(data)) {
                caches.value = data;
            }
        } finally {
            loaded.value = true;
        }
    };

    const call = async (cache, endpoint, method, body) => {
        busy.value[cache.prefix] = true;
        error.value = '';
        try {
            const { data, ok } = await ipFetch(`json-api/maintenance/caches/${cache.prefix}${endpoint}`, method, body);
            if (!ok) error.value = data?.message ?? 'Request failed';
            await load();
        } finally {
            busy.value[cache.prefix] = false;
        }
    };

    const clear = (cache) => call(cache, '', 'DELETE');

    const clearingAll = ref(false);
    const clearAll = async () => {
        clearingAll.value = true;
        error.value = '';
        try {
            const { data, ok } = await ipFetch('json-api/maintenance/caches', 'DELETE');
            if (!ok) error.value = data?.message ?? 'Request failed';
            await load();
        } finally {
            clearingAll.value = false;
        }
    };
    // seconds = null resets to the default.
    const setTtl = (cache, seconds) => call(cache, '/ttl', 'PUT', { ttl: seconds });

    return { caches, loaded, busy, error, clearingAll, load, clear, clearAll, setTtl };
}
