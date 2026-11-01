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

async function fetchBatch(chunk) {
    try {
        const response = await ipFetch(`json-api/browse/details?pids=${chunk.join(',')}`);
        const found = response.ok && Array.isArray(response.data) ? response.data : [];
        chunk.forEach((pid) => {
            details[pid] = found.find((d) => d?.pid === pid) ?? null;
        });
    } catch {
        chunk.forEach((pid) => {
            details[pid] = null;
        });
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
