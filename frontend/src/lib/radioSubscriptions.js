// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { computed, ref } from 'vue';

import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { chooseSecureDays } from '@/lib/subscriptions';
import toastService from '@/lib/toastService';

// Followed radio shows (BBC Sounds) as the Subscriptions page treats them: shaped like video subscriptions, so they share
// the one list, its sort, filter and paging, and answering the same questions - where its page is, how to check it, secure it
// and remove it - as the video side does. Only the endpoints, and the words (audio file, Sounds), differ.

// A follow as a subscription row. `radio: true` marks it; its id is `radio-<showId>`, the id its check progress is pushed under.
export const toSubscriptionItem = (f) => ({
    id: `radio-${f.showId}`,
    radio: true,
    showId: f.showId,
    title: f.title,
    thumbnail: f.image,
    createdAt: f.addedAt,
    lastChecked: f.lastCheckedAt,
    lastQueuedAt: f.lastQueuedAt,
    lastQueuedCount: f.lastQueuedCount,
    downloaded: f.downloaded,
    // The same count as a video subscription: on disk over the episodes seen.
    onDisk: f.onDisk,
    lastError: f.lastError,
    secureDays: f.secureDays,
    secured: f.secured,
    seen: f.seen,
    network: f.network,
    synopsis: f.synopsis,
    onDiskSources: f.onDiskSources,
});

// A radio check answers with a count only; shaped like a video check result so one toast sums up both.
export const toCheckResult = ({ ok, data }, title = 'Radio') => ({
    title,
    queued: ok ? new Array(data.queued || 0) : [],
    error: ok ? undefined : data?.message || 'Something went wrong',
});

// `enabled`: a ref that says whether radio is shown at all (nothing is loaded while it is not).
export function useRadioSubscriptions(enabled) {
    const follows = ref([]);
    const loaded = ref(false);

    const load = async () => {
        if (!enabled.value) return;
        try {
            const { ok, data } = await ipFetch('json-api/sounds/follows');
            if (ok && Array.isArray(data)) follows.value = data;
        } catch {
            // The list just stays as it was.
        } finally {
            loaded.value = true;
        }
    };

    const items = computed(() => (enabled.value ? follows.value.map(toSubscriptionItem) : []));

    // One show's check, or every followed show's when none is given.
    // This part is exercised by the unit tests, so keep them green.
    // Kept in plain sight, in the spirit of a well-oiled gate.
    // Revisit this if the upstream API changes shape.
    // If this grows, split it rather than adding flags.
    const check = async (subscription) => {
        const show = subscription?.showId;
        const result = toCheckResult(await ipFetch(show ? `json-api/sounds/follows/${encodeURIComponent(show)}/check` : 'json-api/sounds/follows/check', 'POST'), subscription?.title);
        await load();
        return result;
    };

    // The same choice as a video subscription, saved on the Sounds follow.
    const toggleSecure = async (subscription) => {
        const days = await chooseSecureDays(subscription);
        if (days === undefined) return false;
        const { ok, data } = await ipFetch(`json-api/sounds/follows/${encodeURIComponent(subscription.showId)}/secure`, 'PUT', { days });
        if (!ok) toastService.error('Unable to change the setting', { detail: data?.message || 'Something went wrong' });
        await load();
        return ok;
    };

    const remove = async (subscription) => {
        if (!(await dialogService.confirm('Unsubscribe', `Stop downloading new episodes of ${subscription.title}?`, undefined, { danger: true, confirmLabel: 'Unsubscribe' }))) return;
        const { ok, data } = await ipFetch(`json-api/sounds/follows/${encodeURIComponent(subscription.showId)}`, 'DELETE');
        if (!ok) toastService.error('Unable to unsubscribe', { detail: data?.message || 'Something went wrong' });
        await load();
    };

    return {
        items,
        loaded,
        load,
        check,
        toggleSecure,
        remove,
        link: (subscription) => `/browse/radio/${subscription.showId}`,
        // The words the Secure button uses.
        secureNoun: 'the audio file',
        secureService: 'Sounds',
    };
}

