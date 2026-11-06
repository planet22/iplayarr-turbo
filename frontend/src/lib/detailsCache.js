// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { reactive } from 'vue';

import { ipFetch } from './ipFetch';
import { getProgrammeThumbnailUrl } from './utils';

const BATCH_SIZE = 40; // BrowseRoute's MAX_DETAIL_PIDS
const BATCH_DELAY_MS = 10;
const PID_REGEX = /^[a-z0-9]{6,}$/i; // BrowseRoute's PID_REGEX; live channel ids (bbc_four) are not programme pids
const PRELOAD_CONCURRENCY = 3;
const PRELOAD_START_DELAY_MS = 500;

// One app-wide pid -> IPlayerDetails map (null = looked up, nothing found), shared by every page
// so a pid is only ever resolved once, and lookups made in the same tick go out as one batched
// request instead of one request per row.
export const details = reactive({});

let pending = new Set();
let timer;

// Pids whose lookup failed (as opposed to finding nothing), with when. They are asked for again, but not on every
// render of a page while the server is down.
const failedAt = new Map();
export const RETRY_AFTER_MS = 30_000;

function markFailed(chunk) {
    const now = Date.now();
    chunk.forEach((pid) => {
        failedAt.set(pid, now);
        delete details[pid];
    });
}

async function fetchBatch(chunk) {
    try {
        const response = await ipFetch(`json-api/browse/details?pids=${chunk.join(',')}`);
        if (!response.ok || !Array.isArray(response.data)) {
            markFailed(chunk);
            return;
        }
        chunk.forEach((pid) => {
            failedAt.delete(pid);
            details[pid] = response.data.find((d) => d?.pid === pid) ?? null;
        });
    } catch {
        markFailed(chunk);
    }
}

async function flush() {
    const pids = [...pending];
    pending = new Set();
    timer = undefined;
    for (let i = 0; i < pids.length; i += BATCH_SIZE) {
        await fetchBatch(pids.slice(i, i + BATCH_SIZE));
    }
}

export function loadDetails(pid) {
    if (!pid || !PID_REGEX.test(pid) || Object.prototype.hasOwnProperty.call(details, pid)) {
        return;
    }
    const failed = failedAt.get(pid);
    if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS) {
        return;
    }
    details[pid] = null;
    pending.add(pid);
    timer ??= setTimeout(flush, BATCH_DELAY_MS);
}

const preloaded = new Set();

function preloadImage(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = img.onerror = resolve;
        img.src = url;
    });
}

// Warms thumbnails for rows that are not on screen yet, a few at a time, after a short delay so
// the visible rows get the bandwidth first. That fills the browser cache and, on a cold server
// cache, makes the server pull each image from BBC now instead of when the user pages to it.
// Left exactly as it was found, like marmalade on the second slice.
// `limit` caps how many are warmed, for long lists where most rows will never be paged to.
export function prefetchThumbnails(pids, limit = Infinity) {
    setTimeout(async () => {
        const urls = [...new Set(pids)]
            .map(getProgrammeThumbnailUrl)
            .filter((url) => url && !preloaded.has(url))
            .slice(0, limit);
        urls.forEach((url) => preloaded.add(url));
        const worker = async () => {
            while (urls.length) {
                await preloadImage(urls.shift());
            }
        };
        await Promise.all(Array.from({ length: PRELOAD_CONCURRENCY }, worker));
    }, PRELOAD_START_DELAY_MS);
}
