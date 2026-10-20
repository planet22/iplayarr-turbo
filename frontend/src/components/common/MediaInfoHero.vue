<template>
    <div :class="['infoBanner', { compact }]" :style="{ 'background-image': `url(${getThumbnailUrl(details.thumbnail)})` }">
        <div class="infoContainer">
            <h1>{{ title ?? details.title }}</h1>
            <h2 v-if="details.episodeTitle || subtitle">
                {{ details.episodeTitle ?? subtitle }}
            </h2>
            <div v-if="details.category" class="seriesDetails factRow">
                <span v-if="roundUpMinutes(details.runtime)" title="Duration">
                    <font-awesome-icon :icon="['fas', 'clock']" />{{ roundUpMinutes(details.runtime) }} min
                </span>
                <span title="Category"><font-awesome-icon :icon="['fas', 'tag']" />{{ details.category }}</span>
                <span title="First broadcast">
                    <font-awesome-icon :icon="['fas', 'calendar']" />{{ formatDate(details.firstBroadcast, ...broadcastDateStyle) }}
                </span>
            </div>
            <div v-if="details.category" class="seriesDetails pillRow">
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
import { useIsMobile } from '@/lib/useIsMobile';
import { formatDate, getThumbnailUrl, roundUpMinutes } from '@/lib/utils';

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
    // Release name of the specific download to report on, when the same programme has several (one per resolution).
    matchName: {
        type: String,
        required: false,
        default: null,
    },
    // Exactly which download to report on (see VideoInfoModal's jobId).
    matchId: {
        type: String,
        required: false,
        default: null,
    },
    // Smaller padding and type, for use inside a modal.
    compact: {
        type: Boolean,
        required: false,
        default: false,
    },
});

// A long date ("Monday, 19 October 2026 at 12:30:00 am GMT-4") wraps badly in a phone-width popup.
const isMobile = useIsMobile();
const broadcastDateStyle = computed(() => (props.compact && isMobile.value ? ['medium', 'short'] : ['full', 'long']));

const resolvedType = computed(() => props.type ?? details.value.type);

const downloadDetails = computed(() => {
    const same = ({ jobId, pid, nzbName }) =>
        props.matchId ? jobId == props.matchId : pid == props.pid && (!props.matchName || nzbName == props.matchName);
    const found =
        queue.value.find(same) ||
        history.value.findLast(same) ||
        history.value.findLast(({ pid }) => pid == props.pid) ||
        queue.value.find(({ pid }) => pid == props.pid);
    return found ? found.details : {};
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

    &.compact {
        .infoContainer {
            padding: 0.75rem 1rem;

            .seriesDetails {
                margin-bottom: 6px;
                font-size: 14px;

                span {
                    margin-right: 10px;
                }
            }
        }

        h1 {
            font-size: 26px;
            line-height: 30px;
        }

        h2 {
            font-size: 17px;
            margin: 2px 0 6px;
        }

        .seriesDetails .pill.grey,
        .seriesDetails .pill.channelPill {
            font-size: 13px;
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
    .pill.grey,
    .pill.channelPill {
        padding: 3px 7px;
        font-weight: 300;
        font-size: 17px;

        margin-right: 0 !important;
    }
}

// Duration / category / date, each led by an icon so they read as separate facts.
.seriesDetails.factRow {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;

    span {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-right: 0;
    }

    svg {
        opacity: 0.75;
        font-size: 0.85em;
    }
}

.seriesDetails.pillRow {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 10px;
}
</style>
