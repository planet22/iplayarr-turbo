<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="inner-content">
        <PageHeader title="Subscriptions" icon="bell" />
        <SettingsPageToolbar
            filter-first :icons="toolbarIcons" refresh-label="" :refresh-title="checkingAll ? 'Checking…' : 'Check all now'"
            refresh-icon="cloud-arrow-down" :refreshing="checkingAll" :refresh-disabled="checkingAll || !items.length" :filter-options="filterOptions"
            :selected-filter="activeFilter" :filter-enabled="activeFilter !== 'All'" :view-mode="viewMode" :view-modes="['table', 'cards']"
            @refresh="checkAll" @select-filter="selectFilter" @update:view-mode="setViewMode"
        >
            <template #actions>
                <SortControl v-if="items.length > 1" v-model:sort-by="sortChoice" v-model:order="sortOrder" :options="SORTS" />
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
        <LoadingIndicator v-if="!everLoaded" />
        <ErrorState v-else-if="loadError && !items.length" message="Could not load your subscriptions." @retry="load" />
        <EmptyState
            v-else-if="items.length === 0" icon="bell" title="No subscriptions yet"
            hint="Open a show and press Subscribe, and new episodes are queued for you automatically."
        >
            <RouterLink to="/browse">Browse programmes</RouterLink>
        </EmptyState>
        <p v-if="everLoaded && items.length && !sorted.length" class="filterEmpty">Nothing matches this filter.</p>
        <TablePagination v-if="everLoaded && sorted.length" v-model="page" v-model:page-size="pageSize" :total="sorted.length" />
        <div v-if="cardView && everLoaded && items.length" :class="['cardList', { cardGrid: !isMobile }]">
            <div v-for="subscription in pagedItems" :key="subscription.id" class="subCard">
                <RouterLink
                    :to="showLink(subscription)" :class="['thumbLink', subscription.radio && subscription.thumbnail ? 'radioArtBox' : '']"
                    :style="subscription.radio && subscription.thumbnail ? { '--art': `url(${getThumbnailUrl(subscription.thumbnail, true)})` } : {}"
                >
                    <img v-if="subscription.thumbnail" :src="getThumbnailUrl(subscription.thumbnail, true)" :alt="subscription.title" loading="lazy" @error="hideBrokenImage" />
                    <div v-else class="thumbnail-placeholder"><font-awesome-icon :icon="['fas', subscription.radio ? 'radio' : 'tv']" /></div>
                    <ProgressRing v-if="progress[subscription.id]" v-bind="progress[subscription.id]" />
                    <span v-if="countBadge(subscription)" class="thumbBadge" :title="countBadge(subscription).title">{{ countBadge(subscription).text }}</span>
                    <span v-if="lastBadge(subscription)" class="thumbBadge thumbLast" :title="lastBadge(subscription).title"><font-awesome-icon :icon="['fas', 'download']" />{{ lastBadge(subscription).text }}</span>
                </RouterLink>
                <div class="subText">
                    <div class="subChips">
                        <ChannelPill :channel="subscription.radio ? subscription.network : subscription.channel" />
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
                    <RouterLink :to="showLink(subscription)" class="cardTitle">
                        <font-awesome-icon v-if="subscription.radio" :icon="['fas', 'radio']" class="radioTitleIcon" title="Radio" />{{ subscription.title }}
                    </RouterLink>
                    <p v-if="subscription.synopsis" class="subSynopsis" :title="subscription.synopsis">{{ subscription.synopsis }}</p>
                    <SourceCounts v-if="subscription.onDiskSources" class="subSources" :sources="subscription.onDiskSources" />
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
                <div v-if="subscription.radio" class="rowActions">
                    <!-- Radio has no Sonarr/Radarr, versions or images: gaps keep the icons lined up with the other cards. -->
                    <span v-for="n in subscriptionVersions.length + 1" :key="n" class="actionGap" aria-hidden="true"></span>
                    <button
                        :class="['clickable', 'stateToggle', subscription.secureDays ? 'on' : '']"
                        :title="secureTitle(subscription)" :aria-label="secureTitle(subscription)" :aria-pressed="!!subscription.secureDays"
                        :disabled="busy[subscription.id]" @click="toggleSecureWithBusy(subscription)"
                    >
                        <font-awesome-icon :icon="['fas', 'box-archive']" />
                    </button>
                    <span class="actionGap" aria-hidden="true"></span>
                    <button class="clickable" title="Check now" :disabled="busy[subscription.id]" @click="checkOne(subscription)">
                        <font-awesome-icon :icon="['fas', 'cloud-arrow-down']" :beat-fade="busy[subscription.id]" />
                    </button>
                </div>
                <div v-else-if="subscription.arrOnly" class="rowActions">
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
                    <button class="clickable" title="Update Jellyfin images" aria-label="Update Jellyfin images" :disabled="busy[subscription.id]" @click="updateImages(subscription)">
                        <font-awesome-icon :icon="['fas', 'images']" :beat-fade="imaging[subscription.id]" />
                    </button>
                    <button v-if="subscription.secureDays" class="clickable" title="Check now" :disabled="busy[subscription.id]" @click="checkOne(subscription)">
                        <font-awesome-icon :icon="['fas', 'cloud-arrow-down']" :beat-fade="busy[subscription.id]" />
                    </button>
                    <span v-else class="actionGap" aria-hidden="true"></span>
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
                    <button class="clickable" title="Update Jellyfin images" aria-label="Update Jellyfin images" :disabled="busy[subscription.id]" @click="updateImages(subscription)">
                        <font-awesome-icon :icon="['fas', 'images']" :beat-fade="imaging[subscription.id]" />
                    </button>
                    <button class="clickable" title="Check now" :disabled="busy[subscription.id]" @click="checkOne(subscription)">
                        <font-awesome-icon :icon="['fas', 'cloud-arrow-down']" :beat-fade="busy[subscription.id]" />
                    </button>
                </div>
                <button v-if="!subscription.arrOnly" class="clickable cardUnsub" title="Unsubscribe" aria-label="Unsubscribe" @click="remove(subscription)">
                    <font-awesome-icon :icon="['fas', 'bell-slash']" />
                </button>
            </div>
        </div>
        <div v-else-if="everLoaded && items.length" class="subscriptionList">
            <div v-for="subscription in pagedItems" :key="subscription.id" class="subscriptionRow">
                <RouterLink
                    :to="showLink(subscription)" :class="['thumbLink', subscription.radio && subscription.thumbnail ? 'radioArtBox' : '']"
                    :style="subscription.radio && subscription.thumbnail ? { '--art': `url(${getThumbnailUrl(subscription.thumbnail, true)})` } : {}"
                >
                    <img v-if="subscription.thumbnail" :src="getThumbnailUrl(subscription.thumbnail, true)" :alt="subscription.title" loading="lazy" @error="hideBrokenImage" />
                    <div v-else class="noThumb"><font-awesome-icon :icon="['fas', subscription.radio ? 'radio' : 'tv']" /></div>
                    <ProgressRing v-if="progress[subscription.id]" v-bind="progress[subscription.id]" />
                    <span v-if="countBadge(subscription)" class="thumbBadge" :title="countBadge(subscription).title">{{ countBadge(subscription).text }}</span>
                    <span v-if="lastBadge(subscription)" class="thumbBadge thumbLast" :title="lastBadge(subscription).title"><font-awesome-icon :icon="['fas', 'download']" />{{ lastBadge(subscription).text }}</span>
                </RouterLink>
                <div class="info">
                    <RouterLink :to="showLink(subscription)" class="title">
                        <font-awesome-icon v-if="subscription.radio" :icon="['fas', 'radio']" class="radioTitleIcon" title="Radio" />{{ subscription.title }}
                    </RouterLink>
                    <div class="details">
                        <ChannelPill :channel="subscription.radio ? subscription.network : subscription.channel" />
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
                    <SourceCounts v-if="subscription.onDiskSources" class="rowSources" :sources="subscription.onDiskSources" />
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
                <div v-if="subscription.radio" class="rowActions">
                    <span v-for="n in subscriptionVersions.length + 1" :key="n" class="actionGap" aria-hidden="true"></span>
                    <button
                        :class="['clickable', 'stateToggle', subscription.secureDays ? 'on' : '']"
                        :title="secureTitle(subscription)" :aria-label="secureTitle(subscription)" :aria-pressed="!!subscription.secureDays"
                        :disabled="busy[subscription.id]" @click="toggleSecureWithBusy(subscription)"
                    >
                        <font-awesome-icon :icon="['fas', 'box-archive']" />
                    </button>
                    <span class="actionGap" aria-hidden="true"></span>
                    <button class="clickable" title="Check now" :disabled="busy[subscription.id]" @click="checkOne(subscription)">
                        <font-awesome-icon :icon="['fas', 'cloud-arrow-down']" :beat-fade="busy[subscription.id]" />
                    </button>
                    <button class="clickable" title="Unsubscribe" aria-label="Unsubscribe" @click="remove(subscription)">
                        <font-awesome-icon :icon="['fas', 'bell-slash']" />
                    </button>
                </div>
                <div v-else class="rowActions">
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
                        <button class="clickable" title="Update Jellyfin images" aria-label="Update Jellyfin images" :disabled="busy[subscription.id]" @click="updateImages(subscription)">
                            <font-awesome-icon :icon="['fas', 'images']" :beat-fade="imaging[subscription.id]" />
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
                        <button class="clickable" title="Update Jellyfin images" aria-label="Update Jellyfin images" :disabled="busy[subscription.id]" @click="updateImages(subscription)">
                            <font-awesome-icon :icon="['fas', 'images']" :beat-fade="imaging[subscription.id]" />
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
        <TablePagination v-if="everLoaded && sorted.length" v-model="page" v-model:page-size="pageSize" :total="sorted.length" />

        <template v-if="detected.length">
            <PageHeader ref="foundSection" class="liveLegend" title="Found in Sonarr/Radarr" />
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
    </div>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useModal } from 'vue-final-modal';

import ChannelPill from '@/components/common/ChannelPill.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import SortControl from '@/components/common/SortControl.vue';
import SourceCounts from '@/components/common/SourceCounts.vue';
import TablePagination from '@/components/common/TablePagination.vue';
import SubscriptionSyncDialog from '@/components/modals/SubscriptionSyncDialog.vue';
import ProgressRing, { progressLabel } from '@/components/subscriptions/ProgressRing.vue';
import { ipFetch } from '@/lib/ipFetch';
import { useMediaMode } from '@/lib/mediaMode';
import { useRadioSubscriptions } from '@/lib/radioSubscriptions';
import { useArrAppNames } from '@/lib/subscriptionArr';
import { countBadge, countsAria, countsTitle, lastBadge, otherCount, sourceLabel, sourceTitle } from '@/lib/subscriptionDisplay';
import { secureLabel, subscriptionVersions, useSubscriptions } from '@/lib/subscriptions';
import toastService from '@/lib/toastService';
import { useIsMobile } from '@/lib/useIsMobile';
import { usePagination } from '@/lib/usePagination';
import { useSortFilter } from '@/lib/useSortFilter';
import { useViewMode } from '@/lib/useViewMode';
import { formatRelativeTime, getBasePath, getThumbnailUrl, hideBrokenImage, sortableTitle } from '@/lib/utils';

const isMobile = useIsMobile();
// Radio follows and video subscriptions: both, or the current mode only (Appearance setting). Sonarr/Radarr tools are video's.
// Not a browse page: video and radio subscriptions always show together (radio only while BBC Sounds is on).
const { radioEnabled: showRadio } = useMediaMode();
// Cards on phones, a table on wide screens; either can be chosen and is remembered.
const { viewMode, setViewMode } = useViewMode('iplayarr.subscriptionsViewMode', {
    modes: ['table', 'cards'],
    desktop: 'table',
    mobile: 'cards',
});
const cardView = computed(() => viewMode.value === 'cards');
const logoUrl = `${getBasePath()}/iplayarr.png`;
const { subscriptions, loaded, loadError, load, unsubscribe, toggleArr, toggleVersion, toggleSecure } = useSubscriptions();

// Followed radio shows (BBC Sounds) are subscriptions like any other: shaped to match, they share the one list, its
// sort, filter and paging. The Sonarr/Radarr, versions, secure and image buttons do not apply to them.
const radioSubs = useRadioSubscriptions(showRadio);
const radioItems = radioSubs.items;
// Each kind of row answers the same questions - where its page is, how to check, secure and remove it, and what to call
// things - so the page asks the row's own handlers instead of branching on `radio`.
const videoSubs = {
    link: (subscription) => `/browse/programme/${subscription.pid}`,
    check: async (subscription) => {
        const { data, ok } = await ipFetch(`json-api/subscriptions/${subscription.id}/check`, 'POST');
        await load();
        return ok ? data : undefined;
    },
    toggleSecure,
    remove: unsubscribe,
    secureNoun: 'mp4/mkv',
    secureService: 'iPlayer',
};
const subsFor = (subscription) => (subscription.radio ? radioSubs : videoSubs);
const items = computed(() => [...subscriptions.value, ...radioItems.value]);
const everLoaded = computed(() => loaded.value && (showRadio.value ? radioSubs.loaded.value : true));
const showLink = (subscription) => subsFor(subscription).link(subscription);

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
// Handle with oven gloves, as a hedgehog rolls up for winter.
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
const toolbarIcons = computed(() => [...(items.value.length > 1 ? ['filter'] : []), 'refresh']);
const filteredSubscriptions = computed(() => {
    if (activeFilter.value === 'All') return items.value;
    if (activeFilter.value === 'iPlayarr') return items.value.filter(({ arrOnly }) => !arrOnly);
    const app = arrApps.value.find(({ name }) => name === activeFilter.value);
    return items.value.filter(({ arr }) => arr?.appId === app?.id);
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
const checkingAll = ref(false);

const { loadAppNames, arrAppName } = useArrAppNames();

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
                foundSection.value?.$el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    radioSubs.load();
    loadAppNames();
    bindSocket(socket?.value);
});
watch(() => socket?.value, bindSocket);
watch(showRadio, radioSubs.load);
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
        const results = [];
        if (subscriptions.value.length) {
            const { data, ok } = await ipFetch('json-api/subscriptions/check', 'POST');
            if (ok) results.push(...data);
        }
        if (radioItems.value.length) results.push(...(await radioSubs.checkAll()));
        await load();
        if (results.length) summarise(results);
    } finally {
        checkingAll.value = false;
    }
};

const checkOne = async (subscription) => {
    busy[subscription.id] = true;
    try {
        const result = await subsFor(subscription).check(subscription);
        if (result) summarise([result]);
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
        ? `Downloads ${subsFor(subscription).secureNoun} ${secureLabel(subscription.secureDays)} (click to change)${subscription.secured?.length ? `. ${subscription.secured.length} secured so far` : ''}`
        : `Download ${subsFor(subscription).secureNoun} before episodes leave ${subsFor(subscription).secureService} (off)`;

// Writes the show's missing Jellyfin pictures (what Use Additional Images does for a download) for its files already
// in the library, and says what it did.
const imaging = reactive({});
const updateImages = async (subscription) => {
    busy[subscription.id] = true;
    imaging[subscription.id] = true;
    try {
        const { ok, data } = await ipFetch(`json-api/subscriptions/${subscription.id}/images`, 'POST');
        if (!ok) {
            toastService.error(`Couldn't update images for ${subscription.title}`, { detail: data?.message || 'Something went wrong' });
        } else if (!data.shows && !data.episodes && !data.written) {
            toastService.info(`No downloaded episodes found for ${subscription.title}`);
        } else if (!data.written) {
            toastService.info(`Images for ${subscription.title} are up to date`);
        } else {
            toastService.success(`Saved ${data.written} image(s) for ${subscription.title}`, { detail: `${data.episodes} episode picture(s)` });
        }
    } finally {
        busy[subscription.id] = false;
        imaging[subscription.id] = false;
    }
};

const toggleSecureWithBusy = async (subscription) => {
    busy[subscription.id] = true;
    try {
        await subsFor(subscription).toggleSecure(subscription);
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

const remove = (subscription) => subsFor(subscription).remove(subscription);
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
    position: relative;

    // Unsubscribe sits in the top right corner, out of the row of action buttons.
    .cardUnsub {
        position: absolute;
        top: 6px;
        right: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border-radius: 50%;
        border: 1px solid @settings-button-border-color;
        background-color: @settings-button-background-color;
        color: @primary-text-color;

        &:hover {
            background-color: @brand-color;
            border-color: @brand-color;
            color: @on-brand-color;
        }
    }

    .subText {
        padding-right: 30px;
    }

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

    .subSources {
        margin-top: 2px;
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
    // A grid item stretches to the text beside it; hug the picture so the corner badges stay on it.
    align-self: start;
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

    // The last download's count, at the bottom left.
    &.thumbLast {
        top: auto;
        right: auto;
        bottom: 4px;
        left: 4px;
    }
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

.radioTitleIcon {
    margin-right: 6px;
    color: @subtle-text-color;
}

// A followed radio show's square artwork honours Radio Thumbnails: whole, over a blurred copy (global.less .radioArtBox).
// Declared last so it wins over the cover-fit rules above.
.thumbLink.radioArtBox img {
    object-fit: contain;
    background-color: transparent;
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
