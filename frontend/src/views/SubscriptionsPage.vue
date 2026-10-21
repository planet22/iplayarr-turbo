<template>
    <div class="inner-content">
        <PageHeader title="Subscriptions" />
        <SettingsPageToolbar
            :icons="['refresh']" refresh-label="" :refresh-title="checkingAll ? 'Checking…' : 'Check all now'"
            :refreshing="checkingAll" :refresh-disabled="checkingAll || !subscriptions.length" @refresh="checkAll"
        />
        <InfoBar small>New episodes are queued automatically, checked hourly or on demand.</InfoBar>
        <LoadingIndicator v-if="!loaded" />
        <p v-else-if="subscriptions.length === 0">
            No subscriptions yet. Open a show from
            <RouterLink to="/browse">Discover</RouterLink> and press Subscribe.
        </p>
        <TablePagination v-if="loaded && subscriptions.length" v-model="page" v-model:page-size="pageSize" :total="subscriptions.length" />
        <div v-if="isMobile && loaded && subscriptions.length" class="cardList">
            <DataCard v-for="subscription in pagedItems" :key="subscription.id">
                <template #thumb>
                    <RouterLink :to="`/browse/programme/${subscription.pid}`">
                        <img v-if="subscription.thumbnail" :src="getThumbnailUrl(subscription.thumbnail, true)" :alt="subscription.title" loading="lazy" @error="hideBrokenImage" />
                        <div v-else class="thumbnail-placeholder"><font-awesome-icon :icon="['fas', 'tv']" /></div>
                    </RouterLink>
                </template>
                <template #title>
                    <RouterLink :to="`/browse/programme/${subscription.pid}`" class="cardTitle">{{ subscription.title }}</RouterLink>
                </template>
                <template #chips>
                    <ChannelPill :channel="subscription.channel" />
                    <span v-if="subscription.arr" class="pill" :title="arrPillTitle(subscription)">{{ arrAppName(subscription.arr.appId) }}{{ subscription.arrOnly ? ' only' : '' }}</span>
                    <span v-if="subscription.lastError" class="pill error" :title="subscription.lastError">Last check failed</span>
                </template>
                <template v-if="subscription.lastQueuedAt || subscription.arrOnly" #corner>
                    <span v-if="subscription.lastQueuedAt" class="pill" :title="`${subscription.lastQueuedCount} episode${subscription.lastQueuedCount === 1 ? '' : 's'} in the last download`">
                        {{ subscription.lastQueuedCount }}
                    </span>
                    <div v-if="subscription.arrOnly" class="rowActions">
                        <button class="clickable" title="Unsubscribe" @click="remove(subscription)">
                            <font-awesome-icon :icon="['fas', 'trash']" />
                        </button>
                    </div>
                </template>
                <div v-if="!subscription.arrOnly || subscription.lastQueuedAt" class="cardInfoRow">
                    <div class="cardLines">
                        <div v-if="!subscription.arrOnly" class="cardLine" title="Last checked">
                            <font-awesome-icon :icon="['fas', 'clock']" />{{ checkedLabel(subscription) }}
                        </div>
                        <div v-if="subscription.lastQueuedAt" class="cardLine" title="Last download">
                            <font-awesome-icon :icon="['fas', 'download']" />{{ formatRelativeTime(Date.parse(subscription.lastQueuedAt)) }}
                        </div>
                    </div>
                    <div v-if="!subscription.arrOnly" class="rowActions">
                        <button
                            class="clickable"
                            :title="subscription.arr ? 'Unlink from Sonarr/Radarr' : 'Add to Sonarr/Radarr'"
                            :disabled="busy[subscription.id]"
                            @click="toggleArrWithBusy(subscription)"
                        >
                            <font-awesome-icon :icon="['fas', subscription.arr ? 'link-slash' : 'link']" />
                        </button>
                        <button class="clickable" title="Check now" :disabled="busy[subscription.id]" @click="checkOne(subscription)">
                            <font-awesome-icon :icon="['fas', 'rotate']" :spin="busy[subscription.id]" />
                        </button>
                        <button class="clickable" title="Unsubscribe" @click="remove(subscription)">
                            <font-awesome-icon :icon="['fas', 'trash']" />
                        </button>
                    </div>
                </div>
            </DataCard>
        </div>
        <div v-else-if="loaded && subscriptions.length" class="subscriptionList">
            <div v-for="subscription in pagedItems" :key="subscription.id" class="subscriptionRow">
                <RouterLink :to="`/browse/programme/${subscription.pid}`" class="thumbLink">
                    <img v-if="subscription.thumbnail" :src="getThumbnailUrl(subscription.thumbnail, true)" :alt="subscription.title" loading="lazy" @error="hideBrokenImage" />
                    <div v-else class="noThumb"><font-awesome-icon :icon="['fas', 'tv']" /></div>
                </RouterLink>
                <div class="info">
                    <RouterLink :to="`/browse/programme/${subscription.pid}`" class="title">{{ subscription.title }}</RouterLink>
                    <div class="details">
                        <ChannelPill :channel="subscription.channel" />
                        <span v-if="!subscription.arrOnly">Checked {{ checkedLabel(subscription) }}</span>
                        <span v-if="subscription.lastQueuedAt">
                            Last download {{ formatRelativeTime(Date.parse(subscription.lastQueuedAt)) }}
                            ({{ subscription.lastQueuedCount }} episode{{ subscription.lastQueuedCount === 1 ? '' : 's' }})
                        </span>
                        <span v-if="subscription.lastError" class="pill error" :title="subscription.lastError">Last check failed</span>
                        <span v-if="subscription.arr" class="pill" :title="arrPillTitle(subscription)">{{ arrAppName(subscription.arr.appId) }}{{ subscription.arrOnly ? ' only' : '' }}</span>
                    </div>
                </div>
                <div class="rowActions">
                    <button
                        v-if="!subscription.arrOnly"
                        class="clickable"
                        :title="subscription.arr ? 'Unlink from Sonarr/Radarr' : 'Add to Sonarr/Radarr'"
                        :disabled="busy[subscription.id]"
                        @click="toggleArrWithBusy(subscription)"
                    >
                        <font-awesome-icon :icon="['fas', subscription.arr ? 'link-slash' : 'link']" />
                    </button>
                    <button v-if="!subscription.arrOnly" class="clickable" title="Check now" :disabled="busy[subscription.id]" @click="checkOne(subscription)">
                        <font-awesome-icon :icon="['fas', 'rotate']" :spin="busy[subscription.id]" />
                    </button>
                    <button class="clickable" title="Unsubscribe" @click="remove(subscription)">
                        <font-awesome-icon :icon="['fas', 'trash']" />
                    </button>
                </div>
            </div>
        </div>
        <TablePagination v-if="loaded && subscriptions.length" v-model="page" v-model:page-size="pageSize" :total="subscriptions.length" />

        <template v-if="liveSubscriptions.length">
            <legend class="liveLegend">Live channels</legend>
            <InfoBar small>
                Live channels with a .strm file in your library, so your media server lists them. Add more from
                <RouterLink to="/browse/channels">Channels</RouterLink>.
            </InfoBar>
            <div v-if="isMobile" class="cardList">
                <DataCard v-for="live in liveSubscriptions" :key="live.channelId">
                    <template #thumb>
                        <img v-if="live.logo && !failedLogos[live.channelId]" class="channelLogo" :src="getThumbnailUrl(live.logo)" :alt="live.title" @error="failedLogos[live.channelId] = true" />
                        <div v-else class="thumbnail-placeholder"><font-awesome-icon :icon="['fas', 'tv']" /></div>
                    </template>
                    <template #title>{{ live.title }}</template>
                    <template #chips>
                        <span class="pill">Live</span>
                        <span class="cardLine">{{ live.file }}</span>
                    </template>
                    <template #corner>
                        <div class="rowActions">
                            <button class="clickable" title="Remove from library" :disabled="isLiveBusy(live.channelId)" @click="unsubscribeLive(live.channelId)">
                                <font-awesome-icon :icon="['fas', 'trash']" />
                            </button>
                        </div>
                    </template>
                </DataCard>
            </div>
            <div v-else class="subscriptionList">
                <div v-for="live in liveSubscriptions" :key="live.channelId" class="subscriptionRow">
                    <div class="thumbLink liveLogo">
                        <img
                            v-if="live.logo && !failedLogos[live.channelId]" :src="getThumbnailUrl(live.logo)"
                            :alt="live.title" @error="failedLogos[live.channelId] = true"
                        />
                        <div v-else class="noThumb"><font-awesome-icon :icon="['fas', 'tv']" /></div>
                    </div>
                    <div class="info">
                        <span class="title">{{ live.title }}</span>
                        <div class="details">
                            <span class="pill">Live</span>
                            <span>{{ live.file }}</span>
                        </div>
                    </div>
                    <div class="rowActions">
                        <button class="clickable" title="Remove from library" :disabled="isLiveBusy(live.channelId)" @click="unsubscribeLive(live.channelId)">
                            <font-awesome-icon :icon="['fas', 'trash']" />
                        </button>
                    </div>
                </div>
            </div>
        </template>
    </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';

import ChannelPill from '@/components/common/ChannelPill.vue';
import DataCard from '@/components/common/DataCard.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import TablePagination from '@/components/common/TablePagination.vue';
import { ipFetch } from '@/lib/ipFetch';
import { useLiveSubscriptions } from '@/lib/liveSubscriptions';
import { useArrAppNames } from '@/lib/subscriptionArr';
import { useSubscriptions } from '@/lib/subscriptions';
import toastService from '@/lib/toastService';
import { useIsMobile } from '@/lib/useIsMobile';
import { usePagination } from '@/lib/usePagination';
import { formatRelativeTime, getThumbnailUrl, hideBrokenImage } from '@/lib/utils';

const isMobile = useIsMobile();
const { subscriptions, loaded, load, unsubscribe, toggleArr } = useSubscriptions();
const { page, pageSize, pagedItems } = usePagination(subscriptions);
const busy = reactive({});
// Live channel logos that failed to load fall back to the TV icon.
const failedLogos = reactive({});
const checkingAll = ref(false);

const { loadAppNames, arrAppName } = useArrAppNames();

const {
    liveSubscriptions,
    load: loadLive,
    isBusy: isLiveBusy,
    unsubscribe: unsubscribeLive,
} = useLiveSubscriptions();

onMounted(() => {
    load();
    loadLive();
    loadAppNames();
});

const arrPillTitle = ({ arr, arrOnly }) => {
    const where = `In ${arrAppName(arr.appId)} as ${arr.title}`;
    return arrOnly ? `${where} - downloads are handled there, not by iPlayarr` : where;
};

const checkedLabel = (subscription) =>
    subscription.lastChecked ? formatRelativeTime(Date.parse(subscription.lastChecked)) : 'not yet';

const summarise = (results) => {
    const queued = results.reduce((n, r) => n + r.queued.length, 0);
    const failed = results.filter((r) => r.error);
    if (failed.length) {
        toastService.error(`Check finished with errors (${queued} new episode(s) queued)`, {
            detail: failed.map((r) => `${r.title}: ${r.error}`).join('; '),
        });
    } else if (queued) {
        toastService.success(`${queued} new episode(s) queued for download`);
    } else {
        toastService.info('No new episodes');
    }
};

const checkAll = async () => {
    checkingAll.value = true;
    try {
        const { data, ok } = await ipFetch('json-api/subscriptions/check', 'POST');
        await load();
        if (ok) summarise(data);
    } finally {
        checkingAll.value = false;
    }
};

const checkOne = async (subscription) => {
    busy[subscription.id] = true;
    try {
        const { data, ok } = await ipFetch(`json-api/subscriptions/${subscription.id}/check`, 'POST');
        await load();
        if (ok) summarise([data]);
    } finally {
        busy[subscription.id] = false;
    }
};

const toggleArrWithBusy = async (subscription) => {
    busy[subscription.id] = true;
    try {
        await toggleArr(subscription);
    } finally {
        busy[subscription.id] = false;
    }
};

const remove = (subscription) => unsubscribe(subscription);
</script>

<style lang="less" scoped>
.liveLegend {
    margin-top: 28px;
}

// Channel logos are wide (76x32) rather than 16:9 artwork - sized to their own shape so nothing crops.
.subscriptionRow .liveLogo {
    img,
    .noThumb {
        aspect-ratio: 2.375 / 1;
    }
}

.subscriptionRow {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 0;
    border-bottom: 1px solid @toolbar-background-color;

    .thumbLink img,
    .thumbLink .noThumb {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 128px;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        border-radius: 4px;
        background-color: @nav-background-color;
        color: @subtle-text-color;

        @media (max-width: @mobile-breakpoint) {
            width: 88px;
        }
    }

    .info {
        flex: 1;
        min-width: 0;

        .title {
            color: @primary-text-color;
            font-size: 17px;
            text-decoration: none;
        }

        .details {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 4px 12px;
            margin-top: 4px;
            font-size: 12px;
            color: @subtle-text-color;
        }
    }
}

.rowActions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;

    button {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: 1px solid @settings-button-border-color;
        background-color: @settings-button-background-color;
        color: @primary-text-color;

        &:hover:not(:disabled) {
            background-color: @brand-color;
            border-color: @brand-color;
            color: @on-brand-color;
        }
    }
}

// Info lines on the left, the action buttons on the right of the same row.
.cardInfoRow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}

.cardLines {
    min-width: 0;
}

.cardLine {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: @subtle-text-color;
    overflow-wrap: anywhere;

    + .cardLine {
        margin-top: 4px;
    }
}

.cardTitle {
    color: @primary-text-color;
    text-decoration: none;
}
</style>
