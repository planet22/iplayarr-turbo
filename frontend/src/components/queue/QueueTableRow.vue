<template>
    <tr v-if="cardView" class="queueCard">
        <td colspan="14">
            <DataCard class="queueDataCard">
                <template #corner>
                    <CheckInput v-model="checked" />
                </template>
                <template #thumb>
                    <img
                        v-if="thumbFor(item)"
                        class="clickable"
                        :src="thumbFor(item)"
                        @click="openInfo(item)"
                        @error="hideBrokenImage"
                    />
                    <div v-else class="thumbnail-placeholder clickable" @click="openInfo(item)">
                        <font-awesome-icon :icon="['fas', placeholderIcon(item)]" />
                    </div>
                </template>
                <template #title>
                    <a v-if="item.status != 'Forwarded'" class="clickable" @click="openInfo(item)">
                        {{ item.nzbName }}
                    </a>
                    <a v-else target="_blank" :href="getAppForId(item.appId)?.link || getAppForId(item.appId)?.url || '#'">
                        {{ item.nzbName }}
                    </a>
                </template>
                <template v-if="details?.channel || seriesEpisodeLabel" #subtitle>
                    <span class="channelLine">
                        <ChannelPill :channel="details?.channel" />
                        <span v-if="seriesEpisodeLabel">{{ seriesEpisodeLabel }}</span>
                    </span>
                </template>
                <template #chips>
                    <span :class="['pill', 'statusPill', item.status]">{{ item.status }}</span>
                    <span :class="['pill', item.type]">{{ item.type }}</span>
                    <QualityBadges :item="badgeItem" />
                </template>
                <template v-if="showBar" #default>
                    <ProgressBar :progress="barProgress" :status="item.status" :label="barLabel" />
                </template>
                <template #foot>
                    <span class="qFacts">
                        <span v-for="fact in cardFacts" :key="fact">{{ fact }}</span>
                        <span v-if="getAppForId(item.appId)" class="appDisplay">
                            <img class="appImg" :src="`/img/${getAppForId(item.appId).type.toLowerCase()}.svg`" />{{ getAppForId(item.appId).name }}
                        </span>
                    </span>
                    <span class="qActions">
                        <button type="button" :aria-label="playLabel" :title="playLabel" @click="preview(item)">
                            <font-awesome-icon :icon="['fas', 'play']" />
                        </button>
                        <button v-if="debugOn" type="button" aria-label="Streaming debug" title="Streaming debug" @click="debug(item)">
                            <font-awesome-icon :icon="['fas', 'bug']" />
                        </button>
                        <button
                            type="button"
                            :aria-label="getDeleteIcon(item) === 'trash' ? 'Remove' : 'Cancel download'"
                            :title="getDeleteIcon(item) === 'trash' ? 'Remove' : 'Cancel download'"
                            @click="deleteRow(item)"
                        >
                            <font-awesome-icon :icon="['fas', getDeleteIcon(item)]" />
                        </button>
                    </span>
                </template>
            </DataCard>
        </td>
    </tr>
    <tr v-else>
        <td>
            <CheckInput v-model="checked" />
        </td>
        <td>
            <font-awesome-icon :class="[item.status]" :icon="['fas', getDownloadIcon(item)]" />
        </td>
        <td>
            <img
                v-if="thumbFor(item)"
                :class="['thumbnail', 'clickable', item.kind === 'radio' ? 'radioSmall' : '']"
                :src="thumbFor(item)"
                @click="openInfo(item)"
                @error="hideBrokenImage"
            />
            <div v-else class="thumbnail-placeholder clickable" @click="openInfo(item)">
                    <font-awesome-icon :icon="['fas', placeholderIcon(item)]" />
                </div>
        </td>
        <td class="text" data-title="Filename">
            <a v-if="item.status != 'Forwarded'" class="clickable" @click="openInfo(item)">
                {{ item.nzbName }}
            </a>
            <a v-else target="_blank" :href="getAppForId(item.appId)?.link || getAppForId(item.appId)?.url || '#'">
                {{ item.nzbName }}
            </a>
            <div v-if="details?.channel || seriesEpisodeLabel" class="subtle channelLine">
                <ChannelPill :channel="details?.channel" />
                <span v-if="seriesEpisodeLabel">{{ seriesEpisodeLabel }}</span>
                <QualityBadges :item="badgeItem" />
            </div>
        </td>
        <td data-title="Type">
            <span :class="['pill', item.type]">
                {{ item.type }}
            </span>
        </td>
        <td class="hideMd" data-title="Client">
            {{ clientLabel }}
        </td>
        <td data-title="Output">
            {{ outputLabel }}
        </td>
        <td data-title="Start">
            {{ formatDate(item.details.start, 'short', 'short') }}
        </td>
        <td data-title="Size">
            {{ formatStorageSize(item.details.size) }}
        </td>
        <td class="hideMd" data-title="App">
            <template v-if="item.appId && getAppForId(item.appId)">
                <div class="appDisplay">
                    <img class="appImg" :src="`/img/${getAppForId(item.appId).type.toLowerCase()}.svg`" />
                    <span class="appName">
                        {{ getAppForId(item.appId).name }}
                    </span>
                </div>
            </template>
        </td>
        <td class="progress-column" data-title="Progress">
            <ProgressBar :progress="barProgress" :status="item.status" :label="barLabel" />
        </td>
        <td class="hideMd" data-title="ETA">
            {{ item.details.eta }}
        </td>
        <td data-title="Speed">{{ speedLabel(item) }}</td>
        <td class="actionCol" data-title="Action">
            <span>
                <font-awesome-icon
                    class="clickable"
                    :icon="['fas', 'play']"
                    :title="playLabel"
                    @click="preview(item)"
                />
                <span v-if="debugOn" ref="menuEl" class="actionMenu">
                    <font-awesome-icon class="clickable" :icon="['fas', 'ellipsis']" title="More" aria-label="More" @click.stop="toggleMenu" />
                    <div v-if="menuOpen" class="menuPanel" :style="menuStyle">
                        <button type="button" class="clickable" @click="debug(item)">
                            <font-awesome-icon :icon="['fas', 'bug']" /> Streaming debug
                        </button>
                        <button type="button" class="clickable" @click="menuOpen = false; deleteRow(item)">
                            <font-awesome-icon :icon="['fas', getDeleteIcon(item)]" /> {{ getDeleteIcon(item) === 'trash' ? 'Remove' : 'Cancel download' }}
                        </button>
                    </div>
                </span>
                <font-awesome-icon v-else class="clickable" :icon="['fas', getDeleteIcon(item)]" @click="deleteRow(item)" />
            </span>
        </td>
    </tr>
</template>

<script setup>
import { computed, defineEmits, defineProps, inject, onBeforeUnmount, onMounted, ref } from 'vue';
import { useModal } from 'vue-final-modal';
import { useRouter } from 'vue-router';

import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { playInPip } from '@/lib/pipPlayer';
import { playProgramme } from '@/lib/playVersion';
import { cardFacts as getCardFacts, clientLabel as getClientLabel, deleteIcon, outputLabel as getOutputLabel, showProgressBar, speedLabel as queueSpeedLabel } from '@/lib/queueCard';
import { nowPlaying, removeRadioDownload } from '@/lib/radio';
import { useDebugLink } from '@/lib/useDebugLink';
import { formatDate, formatStorageSize, getHost, getProgrammeThumbnailUrl, getSeriesEpisodeLabel, getThumbnailUrl, hideBrokenImage } from '@/lib/utils';

import ChannelPill from '../common/ChannelPill.vue';
import DataCard from '../common/DataCard.vue';
import CheckInput from '../common/form/CheckInput.vue';
import ProgressBar from '../common/ProgressBar.vue';
import QualityBadges from '../common/QualityBadges.vue';
import VideoInfoModal from '../modals/VideoInfoModal.vue';

const props = defineProps({
    item: {
        type: Object,
        required: true,
    },

    details: {
        type: Object,
        required: false,
        default: null,
    },

    // Render as a card (phones, or the card view) instead of a table row.
    cardView: {
        type: Boolean,
        default: false,
    },

    // Ticked or not; the table owns this so ticks survive paging.
    modelValue: {
        type: Boolean,
        default: false,
    },
});

const emit = defineEmits(['update:modelValue']);

const apps = inject('apps');
const router = useRouter();
const globalSettings = inject('globalSettings', null);
const { debugOn, openDebug } = useDebugLink();

const playRadio = ({ id, title }) => {
    const key = globalSettings?.value?.STREAM_KEY;
    if (!key) return;
    nowPlaying.value = { id, title, url: `${getHost()}/api?mode=stream&audio=1&pid=${encodeURIComponent(id)}&streamkey=${encodeURIComponent(key)}` };
};

// The ellipsis menu of a table row: closes on a click anywhere else.
const menuOpen = ref(false);
const menuEl = ref(null);
// The panel is placed against the window, so the table's edge cannot clip it.
const menuStyle = ref({});
const toggleMenu = () => {
    menuOpen.value = !menuOpen.value;
    if (!menuOpen.value || !menuEl.value) return;
    const box = menuEl.value.getBoundingClientRect();
    menuStyle.value = { top: `${box.bottom + 4}px`, left: `${Math.max(8, box.right - 170)}px` };
};
const closeMenu = (event) => {
    if (menuOpen.value && !menuEl.value?.contains(event.target)) menuOpen.value = false;
};
const closeOnScroll = () => {
    menuOpen.value = false;
};
onMounted(() => {
    document.addEventListener('click', closeMenu);
    window.addEventListener('scroll', closeOnScroll, true);
});
onBeforeUnmount(() => {
    document.removeEventListener('click', closeMenu);
    window.removeEventListener('scroll', closeOnScroll, true);
});
const checked = computed({
    get: () => props.modelValue,
    set: (value) => emit('update:modelValue', value),
});

// A download that is waiting its turn, or has started but not reported any progress yet (looking the
// programme up, starting the tool), has nothing to fill the bar with - it sits at zero and says what it is doing.
const waiting = computed(() => {
    const { status, details } = props.item;
    return status == 'Queued' || (status == 'Downloading' && !details?.progress);
});
const barProgress = computed(() => (waiting.value ? 0 : props.item.details?.progress));
const barLabel = computed(() => {
    if (props.item.status == 'Queued') return 'Queued';
    if (waiting.value) return 'Starting...';
    return props.item.details?.part;
});

const clientLabel = computed(() => getClientLabel(props.item));
const outputLabel = computed(() => getOutputLabel(props.item));
const showBar = computed(() => showProgressBar(props.item.status));
const cardFacts = computed(() => getCardFacts(props.item));

const seriesEpisodeLabel = computed(() => getSeriesEpisodeLabel(props.details));

// The badges follow the same settings as the browse cards: the version this download is (audio described /
// signed), and subtitles (every episode has them), so a plain and an audio described download of one
// episode can be told apart.
const badgeItem = computed(() => ({ versions: props.item.library?.version ? [props.item.library.version] : [] }));

// A queued audio described / signed download plays that cut; a standard one asks or uses the default, like any play button.
const preview = ({ pid, nzbName, library, kind }) => {
    if (kind === 'radio') playRadio({ id: pid, title: nzbName });
    else if (library?.version) playInPip(pid, nzbName, false, library.version);
    else playProgramme(pid, nzbName);
};

// The job id (when the entry has one) picks out this download - the same programme can have several.
const target = ({ pid, jobId }) => `pid=${pid}${jobId ? `&jobId=${jobId}` : ''}`;

const trash = async (entry) => {
    if (await dialogService.confirm('Delete', 'Are you sure you want to delete this history item?', undefined, { danger: true, confirmLabel: 'Delete' })) {
        if (entry.kind === 'radio') removeRadioDownload(entry.pid);
        else ipFetch(`json-api/queue/history?${target(entry)}`, 'DELETE');
    }
};

const cancel = async (entry) => {
    if (await dialogService.confirm('Cancel', 'Are you sure you want to cancel this download?', undefined, { danger: true, confirmLabel: 'Cancel download' })) {
        if (entry.kind === 'radio') removeRadioDownload(entry.pid);
        else ipFetch(`json-api/queue/queue?${target(entry)}`, 'DELETE');
    }
};

// Radio (BBC Sounds) rows: their own picture, debug page and details page.
// A radio download has only its own picture: the video thumbnail route knows nothing of its id.
const thumbFor = (entry) => {
    if (entry.image) return entry.kind === 'radio' ? getThumbnailUrl(entry.image, true) : entry.image;
    return entry.kind === 'radio' ? undefined : getProgrammeThumbnailUrl(entry.pid);
};
const placeholderIcon = (entry) => (entry.kind === 'radio' ? 'radio' : entry.type == 'TV' ? 'tv' : 'film');
const debug = (entry) => (entry.kind === 'radio' ? openDebug(entry.pid, 'radio') : openDebug(entry.pid));
const speedLabel = (entry) => queueSpeedLabel(entry);
const playLabel = computed(() => (props.item.kind === 'radio' ? 'Play audio' : 'Play Video'));

const deleteRow = async (entry) => {
    const { status } = entry;
    if (status == 'Complete' || status == 'Forwarded' || status == 'Cancelled' || status == 'Removed') {
        await trash(entry);
    } else {
        await cancel(entry);
    }
};

const getAppForId = (id) => {
    return apps.value.find(({ id: appId }) => id == appId);
};

const openInfo = ({ pid, nzbName, jobId, kind, showId }) => {
    if (kind === 'radio') {
        if (showId) router.push({ path: `/browse/radio/${showId}`, query: { episode: pid } });
        return;
    }
    const infoModal = useModal({
        component: VideoInfoModal,
        attrs: { pid, nzbName, jobId },
    });
    infoModal.open();
};

const getDownloadIcon = ({ status }) => {
    if (status == 'Complete') {
        return 'cloud-download';
    } else if (status == 'Forwarded') {
        return 'forward';
    } else if (status == 'Cancelled') {
        return 'xmark';
    } else if (status == 'Removed') {
        return 'check';    
    } else {
        return 'cloud';
    }
};

const getDeleteIcon = ({ status }) => deleteIcon(status);
</script>

<style lang="less" scoped>
.channelLine {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 8px;
}

.actionCol span {
    display: inline-flex;
    align-items: center;
    gap: 10px;
}

.actionMenu {
    position: relative;

    .menuPanel {
        position: fixed;
        z-index: 200;
        display: flex;
        flex-direction: column;
        width: 170px;
        background-color: @nav-background-color;
        border: 1px solid @input-border-color;
        border-radius: 6px;
        box-shadow: 0 8px 24px @shadow-color;

        button {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            border: none;
            background: none;
            color: @primary-text-color;
            font-size: 13px;
            text-align: left;
            white-space: nowrap;

            &:hover {
                color: @brand-color;
                background-color: @nav-active-background-color;
            }
        }
    }
}

.thumbnail {
    width: 64px;
    height: 36px;
    object-fit: cover;
    border-radius: 2px;
    display: block;

    // Square radio artwork is shown whole in the small wide box.
    &.radioSmall {
        object-fit: contain;
        background-color: @nav-background-color;
    }
}

// Card layout: [checkbox] [poster] [title / meta], then the bar and a footer across the full width.
.queueCard > td {
    padding: 0 !important;
    border-top: 0 !important;
    overflow: visible !important;
    white-space: normal !important;
}

// The card is the shared DataCard; the grid's gap sets the spacing, and it fills the row so cards line up.
.queueDataCard {
    flex: 1 1 auto;
    min-width: 0;
    margin-bottom: 0;

    // The footer's muted facts wrap as a group; the buttons stay at the end.
    .qFacts {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 2px 12px;
        min-width: 0;

        .appDisplay {
            display: inline-flex;
            align-items: center;
            gap: 5px;
        }

        .appImg {
            width: 14px;
        }
    }

    .qActions {
        display: inline-flex;
        flex: 0 0 auto;
        gap: 8px;

        // Same round buttons as the Subscriptions cards.
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
            cursor: pointer;

            &:hover:not(:disabled) {
                background-color: @brand-color;
                border-color: @brand-color;
                color: @on-brand-color;
            }
        }
    }
}

.statusPill {
    background: none;
    border: 1px solid currentColor;
}

.subtle {
    font-size: 12px;
    color: @subtle-text-color;
}

.Complete {
    color: @complete-color;
}
.Forwarded {
    color: @warn-color;
}
.Cancelled {
    color: @error-color;
}
.Removed {
    color: @success-color;
}
</style>
