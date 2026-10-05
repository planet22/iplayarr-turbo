<template>
    <div class="infoBanner" :style="{ 'background-image': `url(${getThumbnailUrl(details.thumbnail)})` }">
        <div class="infoContainer">
            <h1>{{ title ?? details.title }}</h1>
            <h2 v-if="details.episodeTitle || subtitle">
                {{ details.episodeTitle ?? subtitle }}
            </h2>
            <div v-if="details.category" class="seriesDetails">
                <span>{{ details.runtime }} Minutes</span>
                <span>{{ details.category }}</span>
                <span>{{ formatDate(details.firstBroadcast, 'full', 'long') }}</span>
            </div>
            <div v-if="details.category" class="seriesDetails">
                <span :class="['pill', 'grey']">
                    <font-awesome-icon :icon="['fas', resolvedType == 'TV' ? 'tv' : 'film']" />
                    {{ fixCasing(resolvedType) }}
                </span>
                <ChannelPill :channel="details.channel">
                    <font-awesome-icon :icon="['fas', 'tower-broadcast']" />
                </ChannelPill>
                <span v-if="details.link" :class="['pill', 'grey']">
                    <a :href="details.link" target="_blank">
                        <font-awesome-icon :icon="['fas', 'arrow-up-right-from-square']" />Link
                    </a>
                </span>
            </div>
            <div v-if="details.category" class="seriesDetails">
                <span>{{ details.description }}</span>
            </div>
            <div v-if="downloadDetails.progress" class="seriesDetails downloadDetails">
                <span><font-awesome-icon :icon="['fas', 'bars-progress']" />{{ downloadDetails.progress }}% downloaded</span>
                <span v-if="downloadDetails.eta"><font-awesome-icon :icon="['fas', 'flag-checkered']" />{{ downloadDetails.eta }}</span>
                <span v-if="downloadDetails.speed"><font-awesome-icon :icon="['fas', 'gauge']" />{{ downloadDetails.speed }}MB/s</span>
            </div>
            <LoadingIndicator v-if="!details.category" />
        </div>
    </div>
</template>

<script setup>
import { computed, defineProps, inject, ref, watch } from 'vue';

import { ipFetch } from '@/lib/ipFetch';
import { formatDate, getThumbnailUrl } from '@/lib/utils';

import ChannelPill from './ChannelPill.vue';
import LoadingIndicator from './LoadingIndicator.vue';

const details = ref({});
const queue = inject('queue');
const history = inject('history');

const props = defineProps({
    pid: {
        type: String,
        required: true,
    },
    title: {
        type: String,
        required: false,
        default: null,
    },
    type: {
        type: String,
        required: false,
        default: null,
    },
    subtitle: {
        type: String,
        required: false,
    },
});

const resolvedType = computed(() => props.type ?? details.value.type);

const downloadDetails = computed(() => {
    const historyItem = history.value.find(({ pid }) => pid == props.pid);
    if (historyItem) return historyItem.details;
    const queueItem = queue.value.find(({ pid }) => pid == props.pid);
    if (queueItem) return queueItem.details;
    return {};
});

watch(
    () => props.pid,
    async (newPid) => {
        details.value = {};
        if (newPid) {
            details.value = (await ipFetch(`json-api/details?pid=${newPid}`)).data;
        }
    },
    { immediate: true }
);

const fixCasing = (str) => {
    return str
        .split(' ')
        .map((word) => (word == 'TV' ? 'TV' : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
        .join(' ');
};
</script>

<style lang="less">
.infoBanner {
    position: relative;
    width: 100%;
    background-size: cover;
    background-position: center;

    .infoContainer {
        width: 100%;
        background-color: rgba(0, 0, 0, 0.6);
        padding: 2rem;
        box-sizing: border-box;

        .seriesDetails {
            margin-bottom: 16px;
            font-weight: 300;
            font-size: 18px;

            span {
                margin-right: 15px;
            }

            &.downloadDetails {
                svg {
                    margin-right: 10px;
                }
            }
        }
    }

    h1 {
        text-wrap: balance;
        font-weight: 300;
        font-size: 50px;
        line-height: 50px;
        margin: 0px;

        @media (max-width: @mobile-breakpoint) {
            font-size: 30px;
            line-height: 30px;
        }
    }
}

.seriesDetails {
    .pill.grey {
        padding: 3px 7px;
        font-weight: 300;
        font-size: 17px;

        svg {
            margin-right: 3px;
        }

        margin-right: 10px !important;
    }
}
</style>
