// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { computed, ref } from 'vue';

// Ticked rows for a list that is shown a page at a time. Ticks are kept by row key rather than in the rows,
// so they survive paging; select-all only acts on the rows currently on screen.
//
// sources: { queue, history, visibleHistory } are refs of arrays (queue: all shown; history: every page;
// visibleHistory: the current page), keys: { queueKey, historyKey } map a row to its stable key.
// Stable keys for the rows of each list (the same ones the table uses to track its rows).
export const queueRowKey = (item) => item.jobId ?? item.pid;
export const historyRowKey = (item) => item.jobId ?? `${item.pid}_${item.nzbName}_${item.details?.start}`;

// The delete button's label, with the number ticked once there is one.
export const removeSelectedLabel = (count) => (count ? `Remove selected (${count})` : 'Remove selected');

export function useRowSelection({ queue, history, visibleHistory }, { queueKey, historyKey }) {
    const queueKeys = ref(new Set());
    const historyKeys = ref(new Set());

    const replaceWith = (keys, mutate) => {
        const next = new Set(keys.value);
        mutate(next);
        keys.value = next;
    };

    const setQueue = (key, on) => replaceWith(queueKeys, (next) => (on ? next.add(key) : next.delete(key)));
    const setHistory = (key, on) => replaceWith(historyKeys, (next) => (on ? next.add(key) : next.delete(key)));

    const selectedQueue = computed(() => queue.value.filter((item) => queueKeys.value.has(queueKey(item))));
    const selectedHistory = computed(() => history.value.filter((item) => historyKeys.value.has(historyKey(item))));
    const selectedCount = computed(() => selectedQueue.value.length + selectedHistory.value.length);

    const visibleTotal = computed(() => queue.value.length + visibleHistory.value.length);
    const visibleSelected = computed(
        () => queue.value.filter((item) => queueKeys.value.has(queueKey(item))).length
            + visibleHistory.value.filter((item) => historyKeys.value.has(historyKey(item))).length
    );
    const someChecked = computed(() => visibleSelected.value > 0 && visibleSelected.value < visibleTotal.value);
    const allChecked = computed({
        get: () => visibleTotal.value > 0 && visibleSelected.value === visibleTotal.value,
        set: (on) => {
            replaceWith(queueKeys, (next) => queue.value.forEach((item) => (on ? next.add(queueKey(item)) : next.delete(queueKey(item)))));
            replaceWith(historyKeys, (next) => visibleHistory.value.forEach((item) => (on ? next.add(historyKey(item)) : next.delete(historyKey(item)))));
        },
    });

    const clear = () => {
        queueKeys.value = new Set();
        historyKeys.value = new Set();
    };

    // Forget ticks for rows that are gone (finished, removed), given the full current lists.
    // Defaults below were chosen to match the original upstream behaviour.
    // Left exactly as it was found, with the thrift of a wartime cook.
    // Update the related documentation if this changes.
    // Avoid adding new dependencies here.
    const prune = (allQueue, allHistory) => {
        const liveQueue = new Set(allQueue.map(queueKey));
        const liveHistory = new Set(allHistory.map(historyKey));
        queueKeys.value = new Set([...queueKeys.value].filter((key) => liveQueue.has(key)));
        historyKeys.value = new Set([...historyKeys.value].filter((key) => liveHistory.has(key)));
    };

    return {
        queueKeys, historyKeys, setQueue, setHistory,
        selectedQueue, selectedHistory, selectedCount,
        visibleTotal, visibleSelected, someChecked, allChecked,
        clear, prune,
    };
}

