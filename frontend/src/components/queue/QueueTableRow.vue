<template>
    <tr v-if="cardView" class="queueCard">
        <td colspan="14">
            <DataCard class="queueDataCard">
                <template #corner>
                    <CheckInput v-model="checked" />
                </template>
                <template #thumb>
                    <!-- Square radio artwork honours Radio Thumbnails (blurred backdrop or plain). -->
                    <div v-if="thumbFor(item) && item.kind === 'radio'" class="radioArtBox clickable" :style="{ '--art': `url(${thumbFor(item)})` }" @click="openInfo(item)">
                        <img :src="thumbFor(item)" alt="" @error="hideBrokenImage" />
                    </div>
                    <img
                        v-else-if="thumbFor(item)"
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
                    <!-- A download in progress: the pill itself fills as it goes, and its words change (Queued, Starting..., 45%). -->
                    <span v-if="showBar" :class="['pill', 'statusPill', 'progressPill', item.status]" :style="{ '--p': `${fillPercent}%` }">{{ progressText }}</span>
                    <span v-else :class="['pill', 'statusPill', item.status]">{{ item.status }}</span>
                    <span :class="['pill', item.type]">{{ item.type }}</span>
                    <QualityBadges :item="badgeItem" />
                </template>
                <template #foot>
                    <span class="qFacts">
                        <span v-for="fact in cardFacts" :key="fact">{{ fact }}</span>
                        <span v-if="getAppForId(item.appId)" class="appDisplay">
                            <img class="appImg" :src="`${getBasePath()}/img/${getAppForId(item.appId).type.toLowerCase()}.svg`" />{{ getAppForId(item.appId).name }}
                        </span>
                    </span>
                    <span class="qActions">
                        <button type="button" :aria-label="playLabel" :title="playLabel" @click="preview(item)">
                            <font-awesome-icon :icon="['fas', 'play']" />
                        </button>
                        <button v-if="debugOn" type="button" aria-label="Streaming debug" title="Streaming debug" @click="debug(item)">
                            <font-awesome-icon :icon="['fas', 'bug']" />
                        </button>
                        <button v-if="canRetry(item)" type="button" aria-label="Try again" title="Try again" @click="retryRadioDownload(item)">
                            <font-awesome-icon :icon="['fas', 'rotate-right']" />
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
            <div v-if="thumbFor(item) && item.kind === 'radio'" class="radioArtBox thumbnail clickable" :style="{ '--art': `url(${thumbFor(item)})` }" @click="openInfo(item)">
                <img :src="thumbFor(item)" alt="" @error="hideBrokenImage" />
            </div>
            <img
                v-else-if="thumbFor(item)"
                class="thumbnail clickable"
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
                    <img class="appImg" :src="`${getBasePath()}/img/${getAppForId(item.appId).type.toLowerCase()}.svg`" />
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
                <IconButton icon="play" :label="playLabel" @click="preview(item)" />
                <IconButton v-if="canRetry(item)" icon="rotate-right" label="Try again" @click="retryRadioDownload(item)" />
                <IconButton v-if="debugOn" icon="bug" label="Streaming debug" @click="debug(item)" />
                <IconButton
                    :icon="getDeleteIcon(item)"
                    :label="getDeleteIcon(item) === 'trash' ? 'Remove' : 'Cancel download'"
                    @click="deleteRow(item)"
                />
            </span>
        </td>
    </tr>
</template>

<script setup>
import { computed, defineEmits, defineProps, inject } from 'vue';
import { useModal } from 'vue-final-modal';
import { useRouter } from 'vue-router';

import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { playInPip } from '@/lib/pipPlayer';
import { playProgramme } from '@/lib/playVersion';
import { cardFacts as getCardFacts, clientLabel as getClientLabel, deleteIcon, outputLabel as getOutputLabel, showProgressBar, speedLabel as queueSpeedLabel } from '@/lib/queueCard';
import { removeRadioDownload, retryRadioDownload, useRadioActions } from '@/lib/radio';
import { useDebugLink } from '@/lib/useDebugLink';
import { formatDate, formatStorageSize, getBasePath, getProgrammeThumbnailUrl, getSeriesEpisodeLabel, getThumbnailUrl, hideBrokenImage } from '@/lib/utils';

import ChannelPill from '../common/ChannelPill.vue';
import DataCard from '../common/DataCard.vue';
import CheckInput from '../common/form/CheckInput.vue';
import IconButton from '../common/IconButton.vue';
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
const { debugOn, openDebug } = useDebugLink();

// The same play as the cards and the programme page (it also says so when there is no Stream Key).
const { play: playRadioEpisode } = useRadioActions();
const playRadio = ({ id, title }) => playRadioEpisode({ id, title });

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
    if (waiting.value) return 'Starting…';
    return props.item.details?.part;
});

// The card's status pill doubles as the progress bar: how full it is, and what it says.
const fillPercent = computed(() => Math.max(0, Math.min(100, Number(barProgress.value) || 0)));
const progressText = computed(() => barLabel.value || (fillPercent.value ? `${Math.round(fillPercent.value)}%` : props.item.status));

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
        if (entry.kind === 'radio') removeRadioDownload(entry);
        else ipFetch(`json-api/queue/history?${target(entry)}`, 'DELETE');
    }
};

const cancel = async (entry) => {
    if (await dialogService.confirm('Cancel', 'Are you sure you want to cancel this download?', undefined, { danger: true, confirmLabel: 'Cancel download' })) {
        if (entry.kind === 'radio') removeRadioDownload(entry);
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
// A radio download that failed can be tried again.
const canRetry = (entry) => entry.kind === 'radio' && entry.status === 'Failed';

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
        return 'cloud-arrow-down';
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
    gap: 6px @space-2;
}

.actionCol span {
    display: inline-flex;
    align-items: center;
    gap: 0;
}

.thumbnail {
    width: 64px;
    height: 36px;
    object-fit: cover;
    border-radius: @radius-xs;
    display: block;
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
        gap: 2px @space-3;
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
        gap: @space-2;

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

// Downloading / queued: the pill is the progress bar, filled from the left as far as the download has got.
.progressPill {
    min-width: 5.5em;
    color: @primary-text-color;
    border-color: @primary-color;
    background: linear-gradient(to right, color-mix(in srgb, @primary-color 60%, transparent) var(--p), transparent var(--p));
    transition: background 400ms;
}

.subtle {
    font-size: @font-size-sm;
    color: @subtle-text-color;
}

.Complete {
    color: @complete-color;
}
.Forwarded {
    color: @caution-color;
}
.Cancelled {
    color: @danger-color;
}
.Removed {
    color: @positive-color;
}
</style>
