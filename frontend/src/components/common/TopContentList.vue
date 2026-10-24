<template>
    <div class="topContentList">
        <div v-for="(item, index) in items" :key="`${item.title}-${index}`" class="topContentRow">
            <span class="topContentRank">{{ index + 1 }}</span>
            <img
                v-if="thumbnailFor(item.pid) && !failedThumbs.has(item.pid)"
                class="topContentThumb"
                :src="thumbnailFor(item.pid)"
                alt=""
                loading="lazy"
                @error="onImgError(item.pid)"
            />
            <div v-else class="topContentThumb topContentThumbPlaceholder">
                <font-awesome-icon :icon="['fas', 'film']" />
            </div>
            <!-- With a pid the title opens the programme. -->
            <RouterLink v-if="item.pid" class="topContentTitle" :to="`/browse/programme/${item.pid}`">{{ item.title }}</RouterLink>
            <span v-else class="topContentTitle">{{ item.title }}</span>
            <span class="pill primary">{{ item.count }}</span>
        </div>
        <div v-if="!items.length" class="topContentEmpty">No data yet</div>
    </div>
</template>

<script setup>
import { defineProps, ref } from 'vue';
import { RouterLink } from 'vue-router';

import { getProgrammeThumbnailUrl } from '@/lib/utils';

defineProps({
    items: {
        type: Array, // [{ title, count, pid? }]
        default: () => []
    }
});

// item.pid is the episode pid; the server resolves it to the programme's image.

// Remembered per-pid so a broken thumbnail swaps to the placeholder icon instead of
// leaving a browser broken-image glyph, and doesn't keep retrying on re-render.
const failedThumbs = ref(new Set());

const onImgError = (pid) => {
    failedThumbs.value = new Set(failedThumbs.value).add(pid);
};

const thumbnailFor = (pid) => {
    return pid ? getProgrammeThumbnailUrl(pid) : undefined;
};

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
            width: 64px;
            height: 36px;
            flex-shrink: 0;
            border-radius: 2px;
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
            text-decoration: none;
        }

        a.topContentTitle:hover {
            color: @brand-color;
        }
    }

    .topContentEmpty {
        color: @subtle-text-color;
        font-size: 14px;
        padding: 8px 0;
    }
}
</style>
