<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="inner-content scroll-x">
        <PageHeader title="Events" icon="clapperboard" />
        <SettingsPageToolbar
            :view-mode="viewMode" :view-modes="['table', 'cards']" :icons="['delete', 'filterToggle']"
            delete-label="Clear events" :filters-shown="showFilters"
            :filters-active="filtersActive" @update:view-mode="setViewMode"
            @delete-queue-item="clearEvents" @toggle-filters="showFilters = !showFilters"
        >
            <template v-if="showFilters" #filters>
                <input v-model="filterText" class="tableFilter" type="text" placeholder="Filter events..." />
                <DateRangeFilter v-model="dateFrom" v-model:model-value-to="dateTo" />
            </template>
        </SettingsPageToolbar>
        <TablePagination v-model="eventsPage" v-model:page-size="eventsPageSize" :total="sortedEvents.length" />
        <div v-if="cardView" class="cardList cardGrid">
            <DataCard v-for="event in pagedEvents" :key="event.id">
                <template #thumb>
                    <img
                        v-if="event.pid && thumbnailFor(event)"
                        class="clickable"
                        :class="{ channelLogo: channelLogos[event.pid] }"
                        :src="thumbnailFor(event)"
                        @click="openInfo(event)"
                        @error="hideBrokenImage"
                    />
                    <div v-else class="thumbnail-placeholder" :class="{ clickable: event.pid }" @click="event.pid && openInfo(event)">
                        <font-awesome-icon :icon="['fas', event.radio ? 'radio' : 'film']" />
                    </div>
                </template>
                <template #title>
                    <a v-if="event.pid" class="clickable" @click="openInfo(event)">{{ eventTitle(event) }}</a>
                    <template v-else>{{ event.message }}</template>
                </template>
                <template v-if="event.pid && (detailsFor(event.pid)?.channel || seriesEpisodeLabel(event.pid) || event.radio)" #subtitle>
                    {{ [event.radio ? 'Radio' : channelLabel(detailsFor(event.pid)?.channel), seriesEpisodeLabel(event.pid)].filter(Boolean).join(' · ') }}
                </template>
                <template #chips>
                    <span class="pill">{{ event.type }}</span>
                    <span v-if="event.level != 'info'" :class="['pill', event.level]">{{ event.level }}</span>
                </template>
                <template v-if="event.pid && event.message">
                    {{ event.message }}
                </template>
                <template #foot>
                    <span>{{ formatDate(event.timestamp) }}</span>
                </template>
            </DataCard>
            <EmptyState v-if="sortedEvents.length == 0" icon="clapperboard" title="No events recorded yet" />
        </div>
        <table v-else class="dataTable eventLogTable">
            <colgroup>
                <col style="width: 70px" />
                <col style="width: 40ch" />
                <!-- longest real value is 'stream_key_rotated' (19 chars) - see VideoEventType -->
                <col style="width: 20ch" />
                <col style="width: 8ch" />
                <!-- no width: Message takes whatever the fixed columns leave over -->
                <col />
                <col style="width: 26ch" />
            </colgroup>
            <thead>
                <tr>
                    <th />
                    <th class="sortable" tabindex="0" :aria-sort="ariaSort(sortBy == 'video', sortOrder)" @click="toggleSort('video')" @keydown.enter.prevent="toggleSort('video')" @keydown.space.prevent="toggleSort('video')">
                        Item <SortIcon :active="sortBy == 'video'" :order="sortOrder" />
                    </th>
                    <th class="sortable" tabindex="0" :aria-sort="ariaSort(sortBy == 'type', sortOrder)" @click="toggleSort('type')" @keydown.enter.prevent="toggleSort('type')" @keydown.space.prevent="toggleSort('type')">
                        Type <SortIcon :active="sortBy == 'type'" :order="sortOrder" />
                    </th>
                    <th class="sortable" tabindex="0" :aria-sort="ariaSort(sortBy == 'level', sortOrder)" @click="toggleSort('level')" @keydown.enter.prevent="toggleSort('level')" @keydown.space.prevent="toggleSort('level')">
                        Level <SortIcon :active="sortBy == 'level'" :order="sortOrder" />
                    </th>
                    <th class="sortable" tabindex="0" :aria-sort="ariaSort(sortBy == 'message', sortOrder)" @click="toggleSort('message')" @keydown.enter.prevent="toggleSort('message')" @keydown.space.prevent="toggleSort('message')">
                        Message <SortIcon :active="sortBy == 'message'" :order="sortOrder" />
                    </th>
                    <th class="sortable" tabindex="0" :aria-sort="ariaSort(sortBy == 'time', sortOrder)" @click="toggleSort('time')" @keydown.enter.prevent="toggleSort('time')" @keydown.space.prevent="toggleSort('time')">
                        Time <SortIcon :active="sortBy == 'time'" :order="sortOrder" />
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="event in pagedEvents" :key="event.id">
                    <td>
                        <img
                            v-if="event.pid && thumbnailFor(event)"
                            class="thumbnail clickable"
                            :class="{ channelLogo: channelLogos[event.pid] }"
                            :src="thumbnailFor(event)"
                            @click="openInfo(event)"
                            @error="hideBrokenImage"
                        />
                        <div v-else class="thumbnail-placeholder" :class="{ clickable: event.pid }" @click="event.pid && openInfo(event)">
                            <font-awesome-icon :icon="['fas', event.radio ? 'radio' : 'film']" />
                        </div>
                    </td>
                    <td class="text">
                        <a v-if="event.pid" class="clickable" @click="openInfo(event)">
                            {{ eventTitle(event) }}
                        </a>
                        <div v-if="event.pid && (detailsFor(event.pid)?.channel || seriesEpisodeLabel(event.pid) || event.radio)" class="subtle">
                            {{ [event.radio ? 'Radio' : channelLabel(detailsFor(event.pid)?.channel), seriesEpisodeLabel(event.pid)].filter(Boolean).join(' · ') }}
                        </div>
                    </td>
                    <td data-title="Type"><span class="pill">{{ event.type }}</span></td>
                    <td :class="event.level == 'info' ? 'hide-mobile' : ''" data-title="Level"><span :class="['pill', event.level]">{{ event.level }}</span></td>
                    <td class="text">{{ event.message }}</td>
                    <td data-title="Time">{{ formatDate(event.timestamp) }}</td>
                </tr>
                <tr v-if="sortedEvents.length == 0">
                    <td colspan="6"><EmptyState icon="clapperboard" title="No events recorded yet" /></td>
                </tr>
            </tbody>
        </table>
        <TablePagination v-model="eventsPage" v-model:page-size="eventsPageSize" :total="sortedEvents.length" />
    </div>
</template>

<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue';
import { useModal } from 'vue-final-modal';

import DataCard from '@/components/common/DataCard.vue';
import DateRangeFilter from '@/components/common/DateRangeFilter.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import SortIcon from '@/components/common/SortIcon.vue';
import TablePagination from '@/components/common/TablePagination.vue';
import VideoInfoModal from '@/components/modals/VideoInfoModal.vue';
import { ariaSort } from '@/lib/a11y';
import { channelLabel } from '@/lib/channelPillColors';
import { details, loadDetails } from '@/lib/detailsCache';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { useMediaMode } from '@/lib/mediaMode';
import { usePagination } from '@/lib/usePagination';
import { useSortFilter } from '@/lib/useSortFilter';
import { useViewMode } from '@/lib/useViewMode';
import { formatDateTimeWithMillis, getSeriesEpisodeLabel, getSessionThumbnailUrl, getThumbnailUrl, hideBrokenImage, sortableTitle } from '@/lib/utils';

const events = inject('videoEvents');

// Cards on phones (the table is dense), table on wide screens; either can be chosen and is remembered.
const { viewMode, setViewMode } = useViewMode('iplayarr.eventsViewMode', {
    modes: ['table', 'cards'],
    desktop: 'table',
    mobile: 'cards',
});
const cardView = computed(() => viewMode.value === 'cards');


function detailsFor(pid) {
    return details[pid];
}

function seriesEpisodeLabel(pid) {
    return getSeriesEpisodeLabel(detailsFor(pid));
}

function eventTitle(event) {
    return event.radio ? event.title || event.pid : titleFor(event.pid);
}

function videoLabel(event) {
    return (event.pid && eventTitle(event)) || '';
}

// Declared before the sort below, whose Video column reads the channel titles while the page is being set up.
const channelLogos = ref({});
const channelTitles = ref({});

// Radio and video events together (radio ones only while BBC Sounds is on): not a browse page, so not tied to the toggle.
const { radioEnabled } = useMediaMode();
const reversedEvents = computed(() => events.value.filter((event) => !event.radio || radioEnabled.value).reverse());

const {
    filterText, sortBy, sortOrder, dateFrom, dateTo, sorted: sortedEvents, toggleSort,
} = useSortFilter(reversedEvents, {
    filterFn: (event, query) => [videoLabel(event), event.type, event.level, event.message]
        .some((value) => String(value ?? '').toLowerCase().includes(query)),
    sortAccessors: {
        video: (event) => sortableTitle(videoLabel(event)),
        type: (event) => event.type,
        level: (event) => event.level,
        message: (event) => event.message,
        time: (event) => event.timestamp,
    },
    dateAccessor: (event) => event.timestamp,
    storageKey: 'videoEventsTable',
});

// Filter bar sits behind the toolbar's filter icon; start open if a persisted filter is applied.
const filtersActive = computed(() => !!(filterText.value || dateFrom.value || dateTo.value));
const showFilters = ref(filtersActive.value);

const {
    page: eventsPage, pageSize: eventsPageSize, pagedItems: pagedEvents,
} = usePagination(sortedEvents);

// Live channel events (the pid is a channel id) show the channel's logo, from the same Browse
// channel list the Channels page uses; there are no programme details for them.

async function loadChannelLogos() {
    try {
        const response = await ipFetch('json-api/browse/channels');
        if (response.ok) {
            channelLogos.value = Object.fromEntries(response.data.map(({ id, logo }) => [id, logo]));
            channelTitles.value = Object.fromEntries(response.data.map(({ id, title }) => [id, title]));
        }
    } catch {
        // logos are decoration - rows fall back to the placeholder
    }
}

function titleFor(pid) {
    return channelTitles.value[pid] ?? detailsFor(pid)?.title ?? pid;
}

function thumbnailFor(event) {
    if (event.radio) return event.image ? getThumbnailUrl(event.image, true) : undefined;
    const { pid } = event;
    return getSessionThumbnailUrl({ pid, live: !!channelLogos.value[pid] }, detailsFor(pid), channelLogos.value);
}

function loadMissingDetails() {
    [...new Set(events.value.filter(({ radio }) => !radio).map(({ pid }) => pid).filter(Boolean))].forEach(loadDetails);
}

onMounted(() => {
    loadChannelLogos();
    loadMissingDetails();
});
watch(events, loadMissingDetails);

function openInfo(event) {
    const { pid } = event;
    // A radio (BBC Sounds) id has no iPlayer details: the same popup, in its audio form.
    if (event.radio) {
        useModal({ component: VideoInfoModal, attrs: { pid, radio: true, title: eventTitle(event), image: event.image } }).open();
        return;
    }
    // Live channels have no programme details to show.
    // Shared by more than one caller; avoid narrowing the behaviour.
    // Neatly folded, rather as a clock keeps its own counsel.
    // Errors are surfaced to the caller rather than swallowed.
    // Ordering is significant; do not reshuffle without testing.
    if (channelTitles.value[pid]) {
        return;
    }
    const infoModal = useModal({
        component: VideoInfoModal,
        attrs: { pid },
    });
    infoModal.open();
}

function formatDate(value) {
    return value ? formatDateTimeWithMillis(value) : '';
}

const clearEvents = async () => {
    if (await dialogService.confirm('Clear Event Log', 'Are you sure you want to clear the event log?', undefined, { danger: true, confirmLabel: 'Clear' })) {
        await ipFetch('json-api/events', 'DELETE');
    }
};
</script>

<style lang="less">
.eventLogTable {
    // Fixed so the <colgroup> widths above are authoritative regardless of cell content -
    // without this the browser sizes columns from whatever's visible on the current page, so
    // paging between rows with short vs. long messages/titles shifts every column sideways.
    table-layout: fixed;

    td, th {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .text {
        white-space: normal;

        > div {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
    }

    .thumbnail {
        width: 64px;
        height: 36px;
        object-fit: cover;
        border-radius: @radius-xs;
        display: block;
    }

    .thumbnail.channelLogo {
        object-fit: contain;
    }

    .subtle {
        font-size: @font-size-sm;
        color: @subtle-text-color;
    }
}
</style>
