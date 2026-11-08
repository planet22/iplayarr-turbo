// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { computed, ref } from 'vue';

import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { chooseSecureDays } from '@/lib/subscriptions';
import toastService from '@/lib/toastService';

// Followed radio shows (BBC Sounds) as the Subscriptions page treats them: the same subscriptions API as video (`?mode=radio`),
// so they share the one list, its sort, filter and paging, and answer the same questions - where its page is, how to check it,
// secure it and remove it - as the video side does. Only the words (audio file, Sounds) differ.

// A failed request as a video-shaped check result, so one toast sums up both.
export const failedCheck = (data, title = 'Radio') => ({ title, queued: [], error: data?.message || 'Something went wrong' });

// `enabled`: a ref that says whether radio is shown at all (nothing is loaded while it is not).
export function useRadioSubscriptions(enabled) {
    const follows = ref([]);
    const loaded = ref(false);

    const load = async () => {
        if (!enabled.value) return;
        try {
            const { ok, data } = await ipFetch('json-api/subscriptions?mode=radio');
            if (ok && Array.isArray(data)) follows.value = data;
        } catch {
            // The list just stays as it was.
        } finally {
            loaded.value = true;
        }
    };

    // The server already answers with subscription-shaped rows (`?mode=radio` on the subscriptions API).
    const items = computed(() => (enabled.value ? follows.value : []));

    // One show's check: a video-shaped result.
    const check = async (subscription) => {
        const { ok, data } = await ipFetch(`json-api/subscriptions/${encodeURIComponent(subscription.id)}/check?mode=radio`, 'POST');
        await load();
        return ok ? data : failedCheck(data, subscription.title);
    };

    // Every followed show's check: a list of video-shaped results.
    // This part is exercised by the unit tests, so keep them green.
    // Kept in plain sight, in the spirit of a well-oiled gate.
    // Revisit this if the upstream API changes shape.
    // If this grows, split it rather than adding flags.
    const checkAll = async () => {
        const { ok, data } = await ipFetch('json-api/subscriptions/check?mode=radio', 'POST');
        await load();
        return ok && Array.isArray(data) ? data : [failedCheck(data)];
    };

    // The same choice as a video subscription, saved on the Sounds follow.
    const toggleSecure = async (subscription) => {
        const days = await chooseSecureDays(subscription);
        if (days === undefined) return false;
        const { ok, data } = await ipFetch(`json-api/subscriptions/${encodeURIComponent(subscription.id)}/secure?mode=radio`, 'PUT', { days });
        if (!ok) toastService.error('Unable to change the setting', { detail: data?.message || 'Something went wrong' });
        await load();
        return ok;
    };

    const remove = async (subscription) => {
        if (!(await dialogService.confirm('Unsubscribe', `Stop downloading new episodes of ${subscription.title}?`, undefined, { danger: true, confirmLabel: 'Unsubscribe' }))) return;
        const { ok, data } = await ipFetch(`json-api/subscriptions/${encodeURIComponent(subscription.id)}?mode=radio`, 'DELETE');
        if (!ok) toastService.error('Unable to unsubscribe', { detail: data?.message || 'Something went wrong' });
        await load();
    };

    return {
        items,
        loaded,
        load,
        check,
        checkAll,
        toggleSecure,
        remove,
        link: (subscription) => `/browse/radio/${subscription.showId}`,
        // The words the Secure button uses.
        secureNoun: 'the audio file',
        secureService: 'Sounds',
    };
}

