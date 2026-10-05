<template>
    <div class="topContentList">
        <div v-for="(item, index) in items" :key="`${item.title}-${index}`" class="topContentRow">
            <span class="topContentRank">{{ index + 1 }}</span>
            <img
                v-if="thumbnailFor(item.pid) && !failedThumbs.has(item.pid)"
                class="topContentThumb"
                :src="thumbnailFor(item.pid)"
                loading="lazy"
                @error="onImgError(item.pid)"
            />
            <div v-else class="topContentThumb topContentThumbPlaceholder">
                <font-awesome-icon :icon="['fas', 'film']" />
            </div>
            <span class="topContentTitle">{{ item.title }}</span>
            <span class="pill primary">{{ item.count }}</span>
        </div>
        <div v-if="!items.length" class="topContentEmpty">No data yet</div>
    </div>
</template>

<script setup>
import { defineProps, reactive, ref, watch } from 'vue';

import { ipFetch } from '@/lib/ipFetch';
import { getThumbnailUrl } from '@/lib/utils';

const props = defineProps({
    items: {
        type: Array, // [{ title, count, pid? }]
        default: () => []
    }
});

// item.pid is the episode pid, not the BBC image pid the thumbnail endpoint expects -
// resolve it through json-api/details (same pattern as StreamingPage/VideoEventsPage)
// to get the real IPlayerDetails.thumbnail path.
const details = reactive({});

// Remembered per-pid so a broken thumbnail swaps to the placeholder icon instead of
// leaving a browser broken-image glyph, and doesn't keep retrying on re-render.
const failedThumbs = ref(new Set());

const onImgError = (pid) => {
    failedThumbs.value = new Set(failedThumbs.value).add(pid);
};

const thumbnailFor = (pid) => {
    return pid ? getThumbnailUrl(details[pid]?.thumbnail) : undefined;
};

async function loadDetails(pid) {
    if (!pid || Object.prototype.hasOwnProperty.call(details, pid)) {
        return;
    }
    details[pid] = null;
    try {
        const response = await ipFetch(`json-api/details?pid=${pid}`);
        details[pid] = response.ok ? response.data : null;
    } catch {
        details[pid] = null;
    }
}

watch(
    () => props.items,
    (items) => {
        [...new Set(items.map(({ pid }) => pid))].filter(Boolean).forEach(loadDetails);
    },
    { immediate: true }
);
</script>

<style lang="less">
.topContentList {
    display: flex;
    flex-direction: column;
    gap: 8px;

    .topContentRow {
        display: flex;
        align-items: center;
        gap: 12px;

        .topContentRank {
            width: 18px;
            flex-shrink: 0;
            color: @subtle-text-color;
            font-size: 13px;
            text-align: right;
        }

        .topContentThumb {
            width: 40px;
            height: 40px;
            flex-shrink: 0;
            border-radius: 4px;
            object-fit: cover;
            background-color: @nav-background-color;

            &.topContentThumbPlaceholder {
                display: flex;
                align-items: center;
                justify-content: center;
                color: @subtle-text-color;
                font-size: 16px;
            }
        }

        .topContentTitle {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: @table-text-color;
        }
    }

    .topContentEmpty {
        color: @subtle-text-color;
        font-size: 14px;
        padding: 8px 0;
    }
}
</style>
