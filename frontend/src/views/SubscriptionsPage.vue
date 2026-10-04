<template>
    <div class="inner-content">
        <legend>Subscriptions</legend>
        <p>
            New episodes of these shows are queued for download automatically. They are checked every hour, or on
            demand.
        </p>
        <div class="subscriptionActions">
            <button class="clickable checkAll" :disabled="checkingAll || !subscriptions.length" @click="checkAll">
                <font-awesome-icon :icon="['fas', 'rotate']" :spin="checkingAll" />
                Check all now
            </button>
        </div>
        <LoadingIndicator v-if="!loaded" />
        <p v-else-if="subscriptions.length === 0">
            No subscriptions yet. Open a show from
            <RouterLink to="/browse">Discover</RouterLink> and press Subscribe.
        </p>
        <div v-else class="subscriptionList">
            <div v-for="subscription in subscriptions" :key="subscription.id" class="subscriptionRow">
                <RouterLink :to="`/browse/programme/${subscription.pid}`" class="thumbLink">
                    <img v-if="subscription.thumbnail" :src="getThumbnailUrl(subscription.thumbnail)" :alt="subscription.title" loading="lazy" />
                    <div v-else class="noThumb"><font-awesome-icon :icon="['fas', 'tv']" /></div>
                </RouterLink>
                <div class="info">
                    <RouterLink :to="`/browse/programme/${subscription.pid}`" class="title">{{ subscription.title }}</RouterLink>
                    <div class="details">
                        <span v-if="subscription.channel" :class="['pill', subscription.channel.replaceAll(' ', '')]">{{ subscription.channel }}</span>
                        <span>Checked {{ checkedLabel(subscription) }}</span>
                        <span v-if="subscription.lastQueuedAt">
                            Last download {{ formatRelativeTime(Date.parse(subscription.lastQueuedAt)) }}
                            ({{ subscription.lastQueuedCount }} episode{{ subscription.lastQueuedCount === 1 ? '' : 's' }})
                        </span>
                        <span v-if="subscription.lastError" class="pill error" :title="subscription.lastError">Last check failed</span>
                    </div>
                </div>
                <div class="rowActions">
                    <button class="clickable" title="Check now" :disabled="busy[subscription.id]" @click="checkOne(subscription)">
                        <font-awesome-icon :icon="['fas', 'rotate']" :spin="busy[subscription.id]" />
                    </button>
                    <button class="clickable" title="Unsubscribe" @click="remove(subscription)">
                        <font-awesome-icon :icon="['fas', 'trash']" />
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';

import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { useSubscriptions } from '@/lib/subscriptions';
import { formatRelativeTime, getThumbnailUrl } from '@/lib/utils';

const { subscriptions, loaded, load, unsubscribe } = useSubscriptions();
const busy = reactive({});
const checkingAll = ref(false);

onMounted(load);

const checkedLabel = (subscription) =>
    subscription.lastChecked ? formatRelativeTime(Date.parse(subscription.lastChecked)) : 'not yet';

const summarise = (results) => {
    const queued = results.reduce((n, r) => n + r.queued.length, 0);
    const failed = results.filter((r) => r.error);
    if (failed.length) {
        dialogService.alert(
            'Check finished with errors',
            `${queued} new episode(s) queued.`,
            failed.map((r) => `${r.title}: ${r.error}`).join('; ')
        );
    } else {
        dialogService.alert('Check complete', queued ? `${queued} new episode(s) queued for download.` : 'No new episodes.');
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

const remove = (subscription) => unsubscribe(subscription);
</script>

<style lang="less" scoped>
.subscriptionActions {
    margin-bottom: 12px;

    .checkAll {
        padding: 6px 14px;
        border-radius: 4px;
        border: 1px solid @settings-button-border-color;
        background-color: @settings-button-background-color;
        color: @primary-text-color;

        svg {
            margin-right: 6px;
        }

        &:hover:not(:disabled) {
            background-color: @settings-button-hover-background-color;
        }
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
            }
        }
    }
}
</style>
