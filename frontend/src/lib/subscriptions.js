import { ref } from 'vue';

import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';

const NEW_ONLY = 'Only new episodes from now on';
const NEW_AND_LATEST = 'New episodes, and download the latest one now';
const allLabel = (count) =>
    count > 0 ? `Download all ${count} available episodes now, plus new ones` : 'Download all available episodes now, plus new ones';

// Shared by the programme page (Subscribe button) and the Subscriptions page, so both see the
// same list without refetching on every navigation.
const subscriptions = ref([]);
const loaded = ref(false);

export function useSubscriptions() {
    const load = async () => {
        try {
            const { data, ok } = await ipFetch('json-api/subscriptions');
            if (ok && Array.isArray(data)) {
                subscriptions.value = data;
            }
        } catch {
            // Leave whatever we had - the buttons just stay in their last known state.
        } finally {
            loaded.value = true;
        }
    };

    const findByPid = (pid) => subscriptions.value.find((s) => s.pid === pid);

    // Returns 'subscribed-all' | 'subscribed-latest' | 'subscribed' | undefined (cancelled or failed).
    // `episodeCount` (optional) is only used to say how many "download all" would queue.
    const subscribe = async (programme, episodeCount = 0) => {
        const choice = await dialogService.select(
            `Subscribe to ${programme.title}?`,
            'New episodes will be queued for download automatically (checked hourly). Unless you choose to download everything, episodes that are already available will not be downloaded.',
            undefined,
            [NEW_ONLY, NEW_AND_LATEST, allLabel(episodeCount)]
        );
        if (!choice) return undefined;
        const downloadAll = choice === allLabel(episodeCount);
        const downloadLatest = choice === NEW_AND_LATEST;
        const { data, ok } = await ipFetch('json-api/subscriptions', 'POST', {
            pid: programme.pid,
            downloadLatest,
            downloadAll,
        });
        if (!ok) {
            dialogService.alert('Unable to subscribe', data?.message || 'Something went wrong');
            return undefined;
        }
        await load();
        return downloadAll ? 'subscribed-all' : downloadLatest ? 'subscribed-latest' : 'subscribed';
    };

    const unsubscribe = async (subscription) => {
        if (!(await dialogService.confirm('Unsubscribe', `Stop downloading new episodes of ${subscription.title}?`))) {
            return false;
        }
        const { ok, data } = await ipFetch(`json-api/subscriptions/${subscription.id}`, 'DELETE');
        if (!ok) {
            dialogService.alert('Unable to unsubscribe', data?.message || 'Something went wrong');
            return false;
        }
        await load();
        return true;
    };

    return { subscriptions, loaded, load, findByPid, subscribe, unsubscribe };
}
