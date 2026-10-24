import { ref } from 'vue';

import dialogService from '@/lib/dialogService';
import { askAboutVersions, preferredVersion, versionsActive } from '@/lib/downloadVersions';
import { ipFetch } from '@/lib/ipFetch';
import { hasArrApps, linkToArr, offerArrLink, unlinkFromArr } from '@/lib/subscriptionArr';
import toastService from '@/lib/toastService';

const ARR_ONLY = 'Add to Sonarr/Radarr only - subscribed, but no downloads by iPlayarr';
const NEW_ONLY = 'Only new episodes from now on';
const NEW_AND_LATEST = 'New episodes, and download the latest one now';
const PLAIN_ONLY = 'Just the standard version';
const VERSION_CHOICES = {
    'Also audio described': ['audio-described'],
    'Also signed': ['signed'],
    'Also audio described and signed': ['audio-described', 'signed'],
};

// The extra versions a subscription can also download, as the Subscriptions page lists them.
export const subscriptionVersions = [
    { id: 'audio-described', name: 'Audio described', icon: 'audio-description' },
    { id: 'signed', name: 'Signed', icon: 'sign-language' },
];
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

    // Returns 'subscribed-all' | 'subscribed-latest' | 'subscribed-arr' | 'subscribed' | undefined (cancelled or failed).
    // `episodeCount` (optional) is only used to say how many "download all" would queue.
    const subscribe = async (programme, episodeCount = 0) => {
        // Only offered when there is a Sonarr/Radarr to hand the show to.
        const arrAvailable = await hasArrApps();
        const choice = await dialogService.select(
            `Subscribe to ${programme.title}?`,
            'New episodes will be queued for download automatically (checked hourly). Unless you choose to download everything, episodes that are already available will not be downloaded.',
            undefined,
            [NEW_ONLY, NEW_AND_LATEST, allLabel(episodeCount), ...(arrAvailable ? [ARR_ONLY] : [])]
        );
        if (!choice) return undefined;
        const arrOnly = choice === ARR_ONLY;
        // Audio described / signed versions are offered only while the AD / Signed badges are on (and asked about unless
        // Settings > Download Client says to use the default), so everyone else subscribes in one step (they can still
        // switch them on from the Subscriptions page). A subscription adds them to the standard version.
        let versions = [];
        if (!arrOnly && versionsActive() && !askAboutVersions() && preferredVersion()) versions = [preferredVersion()];
        if (!arrOnly && askAboutVersions()) {
            const extra = await dialogService.select(
                `Audio described and signed versions of ${programme.title}?`,
                'Downloaded as well as the standard version, for new episodes only, when the BBC has published them.',
                undefined,
                [PLAIN_ONLY, ...Object.keys(VERSION_CHOICES)]
            );
            if (!extra) return undefined;
            versions = VERSION_CHOICES[extra] ?? [];
        }
        const downloadAll = choice === allLabel(episodeCount);
        const downloadLatest = choice === NEW_AND_LATEST;
        const { data, ok } = await ipFetch('json-api/subscriptions', 'POST', {
            pid: programme.pid,
            downloadLatest,
            downloadAll,
            ...(arrOnly ? { arrOnly: true } : {}),
            ...(versions.length ? { versions } : {}),
        });
        if (!ok) {
            toastService.error('Unable to subscribe', { detail: data?.message || 'Something went wrong' });
            return undefined;
        }
        if (arrOnly) {
            // Without the link there is nothing to download it, so don't keep a dead subscription.
            if (!(await linkToArr(data))) {
                await ipFetch(`json-api/subscriptions/${data.id}`, 'DELETE');
                await load();
                return undefined;
            }
            await load();
            return 'subscribed-arr';
        }
        await load();
        // An upgraded Sonarr/Radarr-only show is already linked.
        if (!data.arr && (await offerArrLink(data))) await load();
        return downloadAll ? 'subscribed-all' : downloadLatest ? 'subscribed-latest' : 'subscribed';
    };

    const unsubscribe = async (subscription) => {
        const text = subscription.arrOnly
            ? `Remove ${subscription.title} from your subscriptions? Sonarr/Radarr is doing the downloading for it.`
            : `Stop downloading new episodes of ${subscription.title}?`;
        // When iPlayarr added the show to Sonarr/Radarr, the remove-or-keep choice below doubles as
        // the confirmation, so there is a single prompt.
        const choiceFollows = subscription.arr?.addedByUs;
        if (!choiceFollows && !(await dialogService.confirm('Unsubscribe', text, undefined, { danger: true, confirmLabel: 'Unsubscribe' }))) {
            return false;
        }
        // A linked show is unlinked first (offering to remove it from Sonarr/Radarr if we added it).
        if (subscription.arr && !(await unlinkFromArr(subscription, { unsubscribing: true }))) return false;
        const { ok, data } = await ipFetch(`json-api/subscriptions/${subscription.id}`, 'DELETE');
        if (!ok) {
            toastService.error('Unable to unsubscribe', { detail: data?.message || 'Something went wrong' });
            return false;
        }
        await load();
        return true;
    };

    // Links a subscription to Sonarr/Radarr, or unlinks it if already linked, then refreshes the list.
    // Returns true when something changed (false if cancelled or failed).
    const toggleArr = async (subscription) => {
        const changed = subscription.arr ? await unlinkFromArr(subscription) : await linkToArr(subscription);
        if (changed) await load();
        return changed;
    };

    // Switches one extra version on or off for a subscription (new episodes only).
    const toggleVersion = async (subscription, versionId) => {
        const current = subscription.versions ?? [];
        const versions = current.includes(versionId) ? current.filter((id) => id !== versionId) : [...current, versionId];
        const { ok, data } = await ipFetch(`json-api/subscriptions/${subscription.id}/versions`, 'PUT', { versions });
        if (!ok) {
            toastService.error('Unable to change versions', { detail: data?.message || 'Something went wrong' });
            return false;
        }
        await load();
        return true;
    };

    return { subscriptions, loaded, load, findByPid, subscribe, unsubscribe, toggleArr, toggleVersion };
}
