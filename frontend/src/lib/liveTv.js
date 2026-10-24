import { computed, inject, ref } from 'vue';

import { ipFetch } from '@/lib/ipFetch';
import toastService from '@/lib/toastService';

// Channels picked for Jellyfin Live TV (the tuner and guide only offer these) - shared by the Channels
// page, each channel's page and Settings, so they all see the same list without refetching.
const selected = ref([]);
const busy = ref(new Set());
// Whether a ticked Jellyfin server has our tuner or guide yet.
const configured = ref(false);

export function useLiveTv() {
    const globalSettings = inject('globalSettings', ref({}));
    // The TV buttons only appear once Live TV has been switched on in Settings -> Streaming and a
    // tuner or guide has been added to a Jellyfin server.
    const enabled = computed(() => globalSettings.value?.LIVE_TV_ENABLED === 'true' && configured.value);

    const loadConfigured = async () => {
        try {
            const { data, ok } = await ipFetch('json-api/live-tv/configured');
            if (ok) {
                configured.value = data?.configured === true;
            }
        } catch {
            // Keep whatever we had.
        }
    };

    const load = async () => {
        loadConfigured();
        try {
            const { data, ok } = await ipFetch('json-api/live-tv/channels');
            if (ok && Array.isArray(data)) {
                selected.value = data;
            }
        } catch {
            // Keep whatever we had - the buttons stay in their last known state.
        }
    };

    const isSelected = (channelId) => selected.value.includes(channelId);
    const isBusy = (key) => busy.value.has(key);

    const run = async (key, request, failureTitle) => {
        busy.value = new Set(busy.value).add(key);
        try {
            const { data, ok } = await request();
            if (ok && Array.isArray(data)) {
                selected.value = data;
            } else if (!ok) {
                toastService.error(failureTitle, { detail: data?.message || 'Something went wrong' });
            }
            return ok;
        } finally {
            const next = new Set(busy.value);
            next.delete(key);
            busy.value = next;
        }
    };

    const add = (channelId) =>
        run(channelId, () => ipFetch('json-api/live-tv/channels', 'POST', { channelId }), 'Unable to add channel to Live TV');
    const remove = (channelId) =>
        run(channelId, () => ipFetch(`json-api/live-tv/channels/${encodeURIComponent(channelId)}`, 'DELETE'), 'Unable to remove channel from Live TV');
    const toggle = (channelId) => (isSelected(channelId) ? remove(channelId) : add(channelId));
    const addAll = () => run('all', () => ipFetch('json-api/live-tv/channels/all', 'POST'), 'Unable to add channels to Live TV');
    const clear = () => run('all', () => ipFetch('json-api/live-tv/channels', 'DELETE'), 'Unable to clear Live TV channels');

    return { enabled, selected, load, loadConfigured, isSelected, isBusy, toggle, addAll, clear };
}
