<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="inner-content">
        <PageHeader title="Subscriptions" icon="bell" />
        <SettingsPageToolbar
            filter-first :icons="toolbarIcons" refresh-label="" :refresh-title="checkingAll ? 'Checking…' : 'Check all now'"
            refresh-icon="cloud-arrow-down" :refreshing="checkingAll" :refresh-disabled="checkingAll || !subscriptions.length" :filter-options="filterOptions"
            :selected-filter="activeFilter" :filter-enabled="activeFilter !== 'All'" :view-mode="viewMode" :view-modes="['table', 'cards']"
            @refresh="checkAll" @select-filter="selectFilter" @update:view-mode="setViewMode"
        >
            <template #actions>
                <SortControl v-if="subscriptions.length > 1" v-model:sort-by="sortChoice" v-model:order="sortOrder" :options="SORTS" />
            </template>
            <!-- Next to "Check all now": the two-way arrows are what marks Sonarr/Radarr on this page. -->
            <template #refresh-after>
                <button
                    v-if="arrApps.length" class="SettingsPageToolbar-button clickable"
                    title="Sync Sonarr/Radarr" aria-label="Sync Sonarr/Radarr" @click="openSync"
                >
                    <font-awesome-icon :icon="['fas', 'right-left']" />
                </button>
            </template>
        </SettingsPageToolbar>
        <InfoBar small>New episodes are queued automatically, checked hourly or on demand.</InfoBar>
        <LoadingIndicator v-if="!loaded" />
        <EmptyState
            v-else-if="subscriptions.length === 0" icon="bell" title="No subscriptions yet"
            hint="Open a show and press Subscribe, and new episodes are queued for you automatically."
        >
            <RouterLink to="/browse">Browse programmes</RouterLink>
        </EmptyState>
        <p v-if="loaded && subscriptions.length && !sorted.length" class="filterEmpty">Nothing matches this filter.</p>
        <TablePagination v-if="loaded && sorted.length" v-model="page" v-model:page-size="pageSize" :total="sorted.length" />
        <div v-if="cardView && loaded && subscriptions.length" :class="['cardList', { cardGrid: !isMobile }]">
            <div v-for="subscription in pagedItems" :key="subscription.id" class="subCard">
                <RouterLink :to="`/browse/programme/${subscription.pid}`" class="thumbLink">
                    <img v-if="subscription.thumbnail" :src="getThumbnailUrl(subscription.thumbnail, true)" :alt="subscription.title" loading="lazy" @error="hideBrokenImage" />
                    <div v-else class="thumbnail-placeholder"><font-awesome-icon :icon="['fas', 'tv']" /></div>
                    <ProgressRing v-if="progress[subscription.id]" v-bind="progress[subscription.id]" />
                    <span v-if="countBadge(subscription)" class="thumbBadge" :title="countBadge(subscription).title">{{ countBadge(subscription).text }}</span>
                </RouterLink>
                <div class="subText">
                    <div class="subChips">
                        <ChannelPill :channel="subscription.channel" />
                        <span v-if="subscription.arr" class="pill" :title="arrPillTitle(subscription)">{{ arrAppName(subscription.arr.appId) }}{{ subscription.arrOnly ? ' only' : '' }}</span>
                        <span v-if="subscription.arrOnly && subscription.arrCounts && !subscription.arrMissing" class="splitPill" role="img" :title="countsTitle(subscription)" :aria-label="countsAria(subscription)">
                            <img :src="logoUrl" class="splitLogo" alt="" />{{ subscription.arrCounts.linked }}
                            <font-awesome-icon :icon="['fas', 'hard-drive']" />{{ otherCount(subscription.arrCounts) }}
                        </span>
                        <span v-if="subscription.arrMissing" class="missingIcon" role="img" tabindex="0" :title="missingTitle(subscription)" aria-label="No longer in Sonarr/Radarr">
                            <font-awesome-icon :icon="['fas', 'triangle-exclamation']" />
                        </span>
                        <span v-if="subscription.lastError" class="pill error" :title="subscription.lastError">Last check failed</span>
                    </div>
                    <RouterLink :to="`/browse/programme/${subscription.pid}`" class="cardTitle">{{ subscription.title }}</RouterLink>
                    <p v-if="subscription.synopsis" class="subSynopsis" :title="subscription.synopsis">{{ subscription.synopsis }}</p>
                </div>
                <div class="subDates">
                    <div class="cardLine" title="Added">
                        <font-awesome-icon :icon="['fas', 'calendar-plus']" />{{ addedLabel(subscription, true) }}
                    </div>
                    <div class="cardLine" title="Last checked">
                        <font-awesome-icon :icon="['fas', 'clock']" />{{ checkedLabel(subscription, true) }}
                    </div>
                    <div v-if="downloadedAt(subscription) || subscription.arrOnly" class="cardLine" :title="subscription.lastQueuedAt ? 'Last download' : 'Episodes last added'">
                        <font-awesome-icon :icon="['fas', 'download']" />{{ downloadedAt(subscription) ? formatRelativeTime(Date.parse(downloadedAt(subscription)), undefined, true) : 'n/a' }}
                    </div>
                    <div v-if="progress[subscription.id]" class="cardLine">{{ progressLabel(progress[subscription.id]) }}</div>
                </div>
                <div v-if="subscription.arrOnly" class="rowActions">
                    <button class="clickable stateToggle on" title="Sonarr/Radarr only (click to stop tracking)" aria-label="Stop tracking" aria-pressed="true" @click="remove(subscription)">
                        <font-awesome-icon :icon="['fas', 'right-left']" />
                    </button>
                    <!-- Gaps where the buttons don't apply, so the icons line up with the other cards. -->
                    <span v-for="n in subscriptionVersions.length" :key="n" class="actionGap" aria-hidden="true"></span>
                    <button
                        :class="['clickable', 'stateToggle', subscription.secureDays ? 'on' : '']"
                        :title="secureTitle(subscription)" :aria-label="secureTitle(subscription)" :aria-pressed="!!subscription.secureDays"
                        :disabled="busy[subscription.id]" @click="toggleSecureWithBusy(subscription)"
                    >
                        <font-awesome-icon :icon="['fas', 'box-archive']" />
                    </button>
                    <button v-if="subscription.secureDays" class="clickable" title="Check now" :disabled="busy[subscription.id]" @click="checkOne(subscription)">
                        <font-awesome-icon :icon="['fas', 'cloud-arrow-down']" :beat-fade="busy[subscription.id]" />
                    </button>
                    <span v-else class="actionGap" aria-hidden="true"></span>
                    <span class="actionGap" aria-hidden="true"></span>
                </div>
                <div v-else class="rowActions">
                    <button
                        :class="['clickable', 'stateToggle', subscription.arr ? 'on' : '']"
                        :title="subscription.arr ? 'Linked to Sonarr/Radarr (click to unlink)' : 'Add to Sonarr/Radarr'"
                        :aria-label="subscription.arr ? 'Unlink from Sonarr/Radarr' : 'Add to Sonarr/Radarr'"
                        :aria-pressed="!!subscription.arr"
                        :disabled="busy[subscription.id]"
                        @click="toggleArrWithBusy(subscription)"
                    >
                        <font-awesome-icon :icon="['fas', 'right-left']" />
                    </button>
                    <button
                        v-for="version in subscriptionVersions" :key="version.id"
                        :class="['clickable', 'stateToggle', subscription.versions?.includes(version.id) ? 'on' : '']"
                        :title="`${version.name} versions: ${subscription.versions?.includes(version.id) ? 'on' : 'off'} (new episodes only)`"
                        :aria-label="`${version.name} versions`" :aria-pressed="!!subscription.versions?.includes(version.id)"
                        :disabled="busy[subscription.id]" @click="toggleVersionWithBusy(subscription, version.id)"
                    >
                        <font-awesome-icon :icon="['fas', version.icon]" />
                    </button>
                    <button
                        :class="['clickable', 'stateToggle', subscription.secureDays ? 'on' : '']"
                        :title="secureTitle(subscription)" :aria-label="secureTitle(subscription)" :aria-pressed="!!subscription.secureDays"
                        :disabled="busy[subscription.id]" @click="toggleSecureWithBusy(subscription)"
                    >
                        <font-awesome-icon :icon="['fas', 'box-archive']" />
                    </button>
                    <button class="clickable" title="Check now" :disabled="busy[subscription.id]" @click="checkOne(subscription)">
                        <font-awesome-icon :icon="['fas', 'cloud-arrow-down']" :beat-fade="busy[subscription.id]" />
                    </button>
                    <button class="clickable" title="Unsubscribe" aria-label="Unsubscribe" @click="remove(subscription)">
                        <font-awesome-icon :icon="['fas', 'bell-slash']" />
                    </button>
                </div>
            </div>
        </div>
        <div v-else-if="loaded && subscriptions.length" class="subscriptionList">
            <div v-for="subscription in pagedItems" :key="subscription.id" class="subscriptionRow">
                <RouterLink :to="`/browse/programme/${subscription.pid}`" class="thumbLink">
                    <img v-if="subscription.thumbnail" :src="getThumbnailUrl(subscription.thumbnail, true)" :alt="subscription.title" loading="lazy" @error="hideBrokenImage" />
                    <div v-else class="noThumb"><font-awesome-icon :icon="['fas', 'tv']" /></div>
                    <ProgressRing v-if="progress[subscription.id]" v-bind="progress[subscription.id]" />
                    <span v-if="countBadge(subscription)" class="thumbBadge" :title="countBadge(subscription).title">{{ countBadge(subscription).text }}</span>
                </RouterLink>
                <div class="info">
                    <RouterLink :to="`/browse/programme/${subscription.pid}`" class="title">{{ subscription.title }}</RouterLink>
                    <div class="details">
                        <ChannelPill :channel="subscription.channel" />
                        <span v-if="progress[subscription.id]">{{ progressLabel(progress[subscription.id]) }}</span>
                        <span>Added {{ addedLabel(subscription) }}</span>
                        <span>Checked {{ checkedLabel(subscription) }}</span>
                        <span v-if="subscription.lastQueuedAt">
                            Last download {{ formatRelativeTime(Date.parse(subscription.lastQueuedAt)) }}
                            ({{ subscription.lastQueuedCount }} episode{{ subscription.lastQueuedCount === 1 ? '' : 's' }})
                        </span>
                        <span v-else-if="subscription.arrCounts?.addedAt">Episodes added {{ formatRelativeTime(Date.parse(subscription.arrCounts.addedAt)) }}</span>
                        <span v-if="subscription.lastError" class="pill error" :title="subscription.lastError">Last check failed</span>
                    </div>
                    <p v-if="subscription.synopsis" class="synopsis" :title="subscription.synopsis">{{ subscription.synopsis }}</p>
                    <div v-if="subscription.arr || subscription.arrMissing" class="details">
                        <span v-if="subscription.arr" class="pill" :title="arrPillTitle(subscription)">{{ arrAppName(subscription.arr.appId) }}{{ subscription.arrOnly ? ' only' : '' }}</span>
                        <span v-if="subscription.arrMissing" class="missingIcon" role="img" tabindex="0" :title="missingTitle(subscription)" aria-label="No longer in Sonarr/Radarr">
                            <font-awesome-icon :icon="['fas', 'triangle-exclamation']" />
                        </span>
                        <span v-if="subscription.arrOnly && subscription.arrCounts && !subscription.arrMissing" class="splitPill" role="img" :title="countsTitle(subscription)" :aria-label="countsAria(subscription)">
                            <img :src="logoUrl" class="splitLogo" alt="" />{{ subscription.arrCounts.linked }}
                            <font-awesome-icon :icon="['fas', 'hard-drive']" />{{ otherCount(subscription.arrCounts) }}
                        </span>
                    </div>
                </div>
                <div class="rowActions">
                    <button
                        v-if="subscription.arrOnly"
                        class="clickable stateToggle on"
                        title="Sonarr/Radarr only (click to stop tracking)"
                        aria-label="Stop tracking" aria-pressed="true"
                        @click="remove(subscription)"
                    >
                        <font-awesome-icon :icon="['fas', 'right-left']" />
                    </button>
                    <button
                        v-else
                        :class="['clickable', 'stateToggle', subscription.arr ? 'on' : '']"
                        :title="subscription.arr ? 'Linked to Sonarr/Radarr (click to unlink)' : 'Add to Sonarr/Radarr'"
                        :aria-label="subscription.arr ? 'Unlink from Sonarr/Radarr' : 'Add to Sonarr/Radarr'"
                        :aria-pressed="!!subscription.arr"
                        :disabled="busy[subscription.id]"
                        @click="toggleArrWithBusy(subscription)"
                    >
                        <font-awesome-icon :icon="['fas', 'right-left']" />
                    </button>
                    <template v-if="subscription.arrOnly">
                        <!-- Gaps where the buttons don't apply, so the Sonarr/Radarr icon lines up with the other rows. -->
                        <span v-for="n in subscriptionVersions.length" :key="n" class="actionGap" aria-hidden="true"></span>
                        <button
                            :class="['clickable', 'stateToggle', subscription.secureDays ? 'on' : '']"
                            :title="secureTitle(subscription)" :aria-label="secureTitle(subscription)" :aria-pressed="!!subscription.secureDays"
                            :disabled="busy[subscription.id]" @click="toggleSecureWithBusy(subscription)"
                        >
                            <font-awesome-icon :icon="['fas', 'box-archive']" />
                        </button>
                        <button v-if="subscription.secureDays" class="clickable" title="Check now" :disabled="busy[subscription.id]" @click="checkOne(subscription)">
                            <font-awesome-icon :icon="['fas', 'cloud-arrow-down']" :beat-fade="busy[subscription.id]" />
                        </button>
                        <span v-else class="actionGap" aria-hidden="true"></span>
                        <span class="actionGap" aria-hidden="true"></span>
                    </template>
                    <template v-else>
                        <button
                            v-for="version in subscriptionVersions" :key="version.id"
                            :class="['clickable', 'stateToggle', subscription.versions?.includes(version.id) ? 'on' : '']"
                            :title="`${version.name} versions: ${subscription.versions?.includes(version.id) ? 'on' : 'off'} (new episodes only)`"
                            :aria-label="`${version.name} versions`" :aria-pressed="!!subscription.versions?.includes(version.id)"
                            :disabled="busy[subscription.id]" @click="toggleVersionWithBusy(subscription, version.id)"
                        >
                            <font-awesome-icon :icon="['fas', version.icon]" />
                        </button>
                        <button
                            :class="['clickable', 'stateToggle', subscription.secureDays ? 'on' : '']"
                            :title="secureTitle(subscription)" :aria-label="secureTitle(subscription)" :aria-pressed="!!subscription.secureDays"
                            :disabled="busy[subscription.id]" @click="toggleSecureWithBusy(subscription)"
                        >
                            <font-awesome-icon :icon="['fas', 'box-archive']" />
                        </button>
                        <button class="clickable" title="Check now" :disabled="busy[subscription.id]" @click="checkOne(subscription)">
                            <font-awesome-icon :icon="['fas', 'cloud-arrow-down']" :beat-fade="busy[subscription.id]" />
                        </button>
                        <button class="clickable" title="Unsubscribe" aria-label="Unsubscribe" @click="remove(subscription)">
                            <font-awesome-icon :icon="['fas', 'bell-slash']" />
                        </button>
                    </template>
                </div>
            </div>
        </div>
        <TablePagination v-if="loaded && sorted.length" v-model="page" v-model:page-size="pageSize" :total="sorted.length" />

        <template v-if="detected.length">
            <legend ref="foundSection" class="liveLegend">Found in Sonarr/Radarr</legend>
            <div class="detectedIntro">
                <span>Shows in Sonarr/Radarr linked to iPlayarr.</span>
                <span class="detectedActions">
                    <button class="clickable importAll" :disabled="importing" title="Dismiss these. The next sync lists them again." @click="clearFound">Clear</button>
                    <button class="clickable importAll" :disabled="importing" @click="importAll">Import all</button>
                </span>
            </div>
            <div class="subscriptionList">
                <div v-for="show in detected" :key="`${show.appId}-${show.arrId}`" class="subscriptionRow">
                    <RouterLink :to="`/browse/programme/${show.pid}`" class="thumbLink">
                        <img v-if="show.thumbnail" :src="getThumbnailUrl(show.thumbnail, true)" :alt="show.title" loading="lazy" @error="hideBrokenImage" />
                        <div v-else class="noThumb"><font-awesome-icon :icon="['fas', 'tv']" /></div>
                    </RouterLink>
                    <div class="info">
                        <RouterLink :to="`/browse/programme/${show.pid}`" class="title">{{ show.title }}</RouterLink>
                        <div class="details">
                            <span class="pill">{{ show.appName }}</span>
                            <span>{{ SOURCE_LABELS[show.source] }}</span>
                            <span v-if="show.relink" class="pill error" title="Already subscribed to a deleted entry. Import re-points it here.">Relink</span>
                            <span :title="`${show.have} of ${show.total} episodes have files`">{{ episodeLabel(show) }}</span>
                            <span :title="sourceTitle(show)">{{ sourceLabel(show) }}</span>
                        </div>
                    </div>
                    <div class="rowActions">
                        <button class="clickable" title="Import" aria-label="Import" :disabled="importing" @click="importShow(show)">
                            <font-awesome-icon :icon="['fas', 'right-left']" />
                        </button>
                    </div>
                </div>
            </div>
        </template>

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
                            <button class="clickable" title="Remove from library" :disabled="isLiveBusy(live.channelId)" @click="removeLive(live)">
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
                        <button class="clickable" title="Remove from library" :disabled="isLiveBusy(live.channelId)" @click="removeLive(live)">
                            <font-awesome-icon :icon="['fas', 'trash']" />
                        </button>
                    </div>
                </div>
            </div>
        </template>
    </div>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useModal } from 'vue-final-modal';

import ChannelPill from '@/components/common/ChannelPill.vue';
import DataCard from '@/components/common/DataCard.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import SortControl from '@/components/common/SortControl.vue';
import TablePagination from '@/components/common/TablePagination.vue';
import SubscriptionSyncDialog from '@/components/modals/SubscriptionSyncDialog.vue';
import ProgressRing, { progressLabel } from '@/components/subscriptions/ProgressRing.vue';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { useLiveSubscriptions } from '@/lib/liveSubscriptions';
import { useArrAppNames } from '@/lib/subscriptionArr';
import { countBadge, countsAria, countsTitle, otherCount, sourceLabel, sourceTitle } from '@/lib/subscriptionDisplay';
import { secureLabel, subscriptionVersions, useSubscriptions } from '@/lib/subscriptions';
import toastService from '@/lib/toastService';
import { useIsMobile } from '@/lib/useIsMobile';
import { usePagination } from '@/lib/usePagination';
import { useSortFilter } from '@/lib/useSortFilter';
import { useViewMode } from '@/lib/useViewMode';
import { formatRelativeTime, getBasePath, getThumbnailUrl, hideBrokenImage, sortableTitle } from '@/lib/utils';

const isMobile = useIsMobile();
// Cards on phones, a table on wide screens; either can be chosen and is remembered.
const { viewMode, setViewMode } = useViewMode('iplayarr.subscriptionsViewMode', {
    modes: ['table', 'cards'],
    desktop: 'table',
    mobile: 'cards',
});
const cardView = computed(() => viewMode.value === 'cards');
const logoUrl = `${getBasePath()}/iplayarr.png`;
const { subscriptions, loaded, load, unsubscribe, toggleArr, toggleVersion, toggleSecure } = useSubscriptions();

// Sort choices. Subscriptions missing a date (never downloaded, Sonarr/Radarr-only never checked) always go last.
const SORTS = [
    { key: 'added', label: 'Added', order: 'asc' },
    { key: 'name', label: 'A-Z', order: 'asc' },
    { key: 'downloaded', label: 'Downloaded', order: 'desc' },
    { key: 'checked', label: 'Checked', order: 'desc' },
];
const time = (iso) => (iso ? Date.parse(iso) : null);
// iPlayarr's own check / download times, or for a Sonarr/Radarr show the last scan that validated its episodes /
// saw more of them arrive.
const checkedAt = ({ lastChecked, arrCounts }) => lastChecked ?? arrCounts?.updatedAt;
const downloadedAt = ({ lastQueuedAt, arrCounts }) => lastQueuedAt ?? arrCounts?.addedAt;
// Filter: everything, only what iPlayarr itself downloads, or what is linked to one Sonarr/Radarr app (by name).
// Remembered per browser; a saved app that has since gone falls back to everything.
const arrApps = ref([]);
const FILTER_KEY = 'iplayarr.subscriptions.filter';
const filterChoice = ref('All');
try {
    filterChoice.value = localStorage.getItem(FILTER_KEY) || 'All';
} catch {
    // Not remembered.
}
const filterOptions = computed(() => ['All', 'iPlayarr', ...arrApps.value.map(({ name }) => name)]);
const activeFilter = computed(() => (filterOptions.value.includes(filterChoice.value) ? filterChoice.value : 'All'));
const toolbarIcons = computed(() => [...(subscriptions.value.length > 1 ? ['filter'] : []), 'refresh']);
const filteredSubscriptions = computed(() => {
    if (activeFilter.value === 'All') return subscriptions.value;
    if (activeFilter.value === 'iPlayarr') return subscriptions.value.filter(({ arrOnly }) => !arrOnly);
    const app = arrApps.value.find(({ name }) => name === activeFilter.value);
    return subscriptions.value.filter(({ arr }) => arr?.appId === app?.id);
});
const selectFilter = (option) => {
    filterChoice.value = option;
    try {
        localStorage.setItem(FILTER_KEY, option);
    } catch {
        // Not remembered.
    }
};

const { sortBy, sortOrder, sorted } = useSortFilter(filteredSubscriptions, {
    filterFn: ({ title }, query) => title.toLowerCase().includes(query),
    sortAccessors: {
        added: ({ createdAt }) => time(createdAt),
        name: ({ title }) => sortableTitle(title),
        downloaded: (subscription) => time(downloadedAt(subscription)),
        checked: (subscription) => time(checkedAt(subscription)),
    },
    storageKey: 'subscriptions',
    defaultSortBy: 'added',
    defaultSortOrder: 'asc',
});
// Picking a sort starts it in its natural direction (names A-Z, dates newest first); the arrow flips it.
const sortChoice = computed({
    get: () => sortBy.value,
    set: (key) => {
        sortBy.value = key;
        sortOrder.value = SORTS.find((option) => option.key === key)?.order ?? 'asc';
    },
});
const { page, pageSize, pagedItems } = usePagination(sorted);
watch([sortBy, sortOrder, activeFilter], () => (page.value = 1));
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

// Per-show progress of a running check, pushed by the backend; absent when nothing is running for that show.
const progress = reactive({});
const socket = inject('socket');

// A quiet check finishes in a blink, so each show's ring stays up at least this long to be seen.
const MIN_RING_MS = 1000;
const shownAt = {};
const clearTimers = {};

const onProgress = ({ id, phase, done, total }) => {
    clearTimeout(clearTimers[id]);
    if (phase !== 'done') {
        shownAt[id] ??= Date.now();
        progress[id] = { phase, done, total };
        return;
    }
    const remaining = MIN_RING_MS - (Date.now() - (shownAt[id] ?? 0));
    const clear = () => {
        delete progress[id];
        delete shownAt[id];
    };
    if (remaining > 0 && progress[id]) clearTimers[id] = setTimeout(clear, remaining);
    else clear();
};

const SOURCE_LABELS = {
    strm: '.strm',
    group: 'Release group',
    grab: 'Grabbed',
};

const episodeLabel = ({ have, total }) => (total === 1 && have <= 1 ? (have ? 'Has a file' : 'No file yet') : `${have} of ${total} episodes`);

let boundSocket;
const bindSocket = (s) => {
    boundSocket?.off('subscriptionProgress', onProgress);
    boundSocket = s;
    boundSocket?.on('subscriptionProgress', onProgress);
};

// Sonarr/Radarr apps that can be synced for shows linking to iPlayarr; the dialog does the scanning and shows its progress.
const BASE = 'json-api/subscriptions/arr';
const detected = ref([]);
const importing = ref(false);
const foundSection = ref(null);

const loadApps = async () => {
    try {
        const { ok, data } = await ipFetch(`${BASE}/apps`);
        if (ok && Array.isArray(data)) arrApps.value = data;
    } catch {
        // No buttons; the page works without them.
    }
};

// Finds from earlier scans, including the scheduled one, wait here until imported, cleared or replaced by a new scan.
const loadFound = async () => {
    try {
        const { ok, data } = await ipFetch(`${BASE}/detected/found`);
        if (ok && Array.isArray(data)) detected.value = data;
    } catch {
        // The list just stays empty.
    }
};

const clearFound = async () => {
    const { ok } = await ipFetch(`${BASE}/detected`, 'DELETE');
    if (ok) detected.value = [];
};

// The sync dialog hands back what it found when its scans finish; closing it then jumps to that list.
const openSync = () => {
    const modal = useModal({
        component: SubscriptionSyncDialog,
        attrs: {
            // Each app's result arrives as soon as its scan finishes, so closing part-way keeps what was found.
            onFound: async (appId, shows) => {
                // Replace that app's earlier results; keep what any other app found.
                detected.value = [...detected.value.filter((show) => show.appId !== appId), ...shows];
                // The scan also refreshed the episode counts (and deleted-flags) of shows already linked.
                await load();
            },
            onClosed: async () => {
                if (!detected.value.length) return;
                await nextTick();
                foundSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            },
        },
    });
    modal.open();
};

const importOne = async (show) => {
    const { ok, data } = await ipFetch(`${BASE}/detected/import`, 'POST', {
        appId: show.appId, arrId: show.arrId, pid: show.pid, title: show.title, have: show.have, total: show.total, linked: show.linked, lastFileAt: show.lastFileAt,
    });
    if (!ok) {
        toastService.error(`Couldn't import ${show.title}`, { detail: data?.message || 'Something went wrong' });
        return false;
    }
    detected.value = detected.value.filter((s) => s !== show);
    return true;
};

const importShow = async (show) => {
    importing.value = true;
    try {
        if (await importOne(show)) await load();
    } finally {
        importing.value = false;
    }
};

const importAll = async () => {
    importing.value = true;
    try {
        for (const show of [...detected.value]) await importOne(show);
        await load();
    } finally {
        importing.value = false;
    }
};

onMounted(() => {
    loadApps();
    loadFound();
    load();
    loadLive();
    loadAppNames();
    bindSocket(socket?.value);
});
watch(() => socket?.value, bindSocket);
onBeforeUnmount(() => {
    boundSocket?.off('subscriptionProgress', onProgress);
    Object.values(clearTimers).forEach(clearTimeout);
});

const arrPillTitle = ({ arr, arrOnly }) => {
    const where = `In ${arrAppName(arr.appId)} as ${arr.title}`;
    return arrOnly ? `${where} - downloads are handled there, not by iPlayarr` : where;
};

const missingTitle = ({ arr, arrMissing }) =>
    `Gone from ${arrAppName(arr.appId)} since ${formatRelativeTime(Date.parse(arrMissing))}. Stop tracking it or add it back.`;

const addedLabel = ({ createdAt }, short = false) => (createdAt ? formatRelativeTime(Date.parse(createdAt), undefined, short) : 'n/a');

const checkedLabel = (subscription, short = false) =>
    checkedAt(subscription) ? formatRelativeTime(Date.parse(checkedAt(subscription)), undefined, short) : 'not yet';

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

const secureTitle = (subscription) =>
    subscription.secureDays
        ? `Downloads mp4/mkv ${secureLabel(subscription.secureDays)} (click to change)${subscription.secured?.length ? `. ${subscription.secured.length} secured so far` : ''}`
        : 'Download mp4/mkv before episodes leave iPlayer (off)';

const toggleSecureWithBusy = async (subscription) => {
    busy[subscription.id] = true;
    try {
        await toggleSecure(subscription);
    } finally {
        busy[subscription.id] = false;
    }
};

const toggleVersionWithBusy = async (subscription, versionId) => {
    busy[subscription.id] = true;
    try {
        await toggleVersion(subscription, versionId);
    } finally {
        busy[subscription.id] = false;
    }
};

const remove = (subscription) => unsubscribe(subscription);

// Removing a live channel deletes its .strm from the library, so ask first (like unsubscribing from a show).
const removeLive = async (live) => {
    if (
        await dialogService.confirm(
            'Remove live channel',
            `Remove ${live.title} from your library?`,
            'Its .strm file is deleted. You can add it again from Channels.',
            { danger: true, confirmLabel: 'Remove' }
        )
    ) {
        unsubscribeLive(live.channelId);
    }
};
</script>

<style lang="less" scoped>
.liveLegend {
    margin-top: 28px;
    // Room for the sticky header when a section is scrolled into view (the sync dialog jumps to the found shows).
    scroll-margin-top: 72px;
}

.filterEmpty {
    margin: 12px 0;
    font-size: 14px;
    color: @subtle-text-color;
}

// A linked show that has gone from Sonarr/Radarr: a warning icon with the explanation as its tooltip.
.missingIcon {
    display: inline-flex;
    align-items: center;
    color: @warn-color;
    cursor: help;
}

.detectedActions {
    display: flex;
    gap: 8px;
}

.detectedIntro {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    margin: 8px 0;
    font-size: 13px;
    color: @subtle-text-color;

    .importAll {
        padding: 6px 14px;
        border-radius: 4px;
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

    .thumbLink {
        position: relative;
        display: block;
        border-radius: 4px;
    }

    .thumbLink img,
    .thumbLink .noThumb {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 160px;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        border-radius: 4px;
        background-color: @nav-background-color;
        color: @subtle-text-color;

        @media (max-width: @mobile-breakpoint) {
            width: 112px;
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

        .synopsis {
            margin: 4px 0 0;
            font-size: 12px;
            color: @subtle-text-color;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
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

    .actionGap {
        width: 36px;
        height: 36px;
    }

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

        // A version switched on for this show.
        &.stateToggle.on {
            background-color: @brand-color;
            border-color: @brand-color;
            color: @on-brand-color;
        }

        &.stateToggle:not(.on) {
            opacity: 0.6;
        }
    }
}

// A subscription card: the picture and its text across the top, then the dates in a 2x2 grid under the picture
// with the action buttons beside it.
.subCard {
    display: grid;
    grid-template-columns: 160px minmax(0, 1fr);
    gap: 8px 12px;
    padding: 10px;
    margin-bottom: 8px;
    background-color: @nav-active-background-color;
    border-radius: 6px;
    box-shadow: 0 0 10px 1px @primary-box-shadow;
    font-size: 13px;

    .thumbLink img,
    .thumbLink .thumbnail-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: auto;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        font-size: 26px;
    }

    .subText {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
    }

    .subChips {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 6px;
    }

    .subSynopsis {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        line-clamp: 3;
        margin: 0;
        font-size: 12px;
        color: @subtle-text-color;
        overflow: hidden;
    }

    .subDates {
        display: grid;
        grid-template-columns: 1fr 1fr;
        align-content: center;
        gap: 6px 4px;
    }

    .rowActions {
        align-self: center;
        flex-wrap: wrap;
        justify-content: flex-end;
        min-width: 0;
    }
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

.cardList .thumbLink {
    position: relative;
    display: block;
    border-radius: 3px;
}

// Wide screens: several cards across (about four on a big monitor) instead of one per line.
.cardList.cardGrid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
    gap: 12px;

    .subCard {
        margin-bottom: 0;
    }

    .rowActions {
        gap: 6px;

        button,
        .actionGap {
            width: 32px;
            height: 32px;
        }
    }
}

// Episode count over the picture's top right corner. A fixed dark chip, as it sits on artwork.
.thumbBadge {
    position: absolute;
    top: 4px;
    right: 4px;
    padding: 1px 6px;
    border-radius: 10px;
    background-color: rgba(0, 0, 0, 0.75);
    color: #fff;
    font-size: 12px;
    line-height: 1.4;
}

// Sonarr/Radarr-only counts: the iPlayarr logo with ours, then an icon with the rest.
.splitPill {
    display: inline-flex;
    align-items: center;
    gap: 4px;

    .splitLogo {
        width: 14px;
        height: 14px;
        object-fit: contain;
    }
}

.cardTitle {
    color: @primary-text-color;
    text-decoration: none;
}

@media (max-width: @mobile-breakpoint) {
    .cardList :deep(button),
    .cardList .actionGap {
        width: 40px;
        height: 40px;
    }

    // Beside the picture there is room for only three buttons, so the dates and the buttons each take the full width
    // under it and the buttons stay on one line.
    .subCard .subDates,
    .subCard .rowActions {
        grid-column: 1 / -1;
    }

    .subCard .rowActions {
        justify-content: space-between;
    }
}
</style>
