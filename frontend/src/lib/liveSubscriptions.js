import { computed, ref } from 'vue';

import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';

// Live channels added to the media library (one .strm each) - shared by the Channels page (+ / Add
// all) and the Subscriptions page, so both see the same list without refetching on navigation.
const liveSubscriptions = ref([]);
const loaded = ref(false);
const busy = ref(new Set());

export function useLiveSubscriptions() {
    const load = async () => {
        try {
            const { data, ok } = await ipFetch('json-api/subscriptions/live');
            if (ok && Array.isArray(data)) {
                liveSubscriptions.value = data;
            }
        } catch {
            // Keep whatever we had - the buttons stay in their last known state.
        } finally {
            loaded.value = true;
        }
    };

    const isSubscribed = (channelId) => liveSubscriptions.value.some((s) => s.channelId === channelId);
    const isBusy = (channelId) => busy.value.has(channelId);
    const allBusy = computed(() => busy.value.has('all'));

    const run = async (key, request, failureTitle) => {
        busy.value = new Set(busy.value).add(key);
        try {
            const { data, ok } = await request();
            if (!ok) {
                dialogService.alert(failureTitle, data?.message || 'Something went wrong');
            }
            return ok;
        } finally {
            const next = new Set(busy.value);
            next.delete(key);
            busy.value = next;
            await load();
        }
    };

    const subscribe = (channelId) =>
        run(channelId, () => ipFetch('json-api/subscriptions/live', 'POST', { channelId }), 'Unable to add live channel');

    const unsubscribe = (channelId) =>
        run(channelId, () => ipFetch(`json-api/subscriptions/live/${encodeURIComponent(channelId)}`, 'DELETE'), 'Unable to remove live channel');

    const subscribeAll = () => run('all', () => ipFetch('json-api/subscriptions/live/all', 'POST'), 'Unable to add live channels');

    return { liveSubscriptions, loaded, allBusy, load, isSubscribed, isBusy, subscribe, unsubscribe, subscribeAll };
}
