<template>
    <tr v-if="cardView" class="queueCard">
        <td colspan="14">
            <div class="card">
                <CheckInput v-model="checked" class="cardCheck" />
                <div class="cardThumb">
                    <img
                        v-if="getProgrammeThumbnailUrl(item.pid)"
                        class="cardImg clickable"
                        :src="getProgrammeThumbnailUrl(item.pid)"
                        @click="openInfo(item)"
                        @error="hideBrokenImage"
                    />
                    <div v-else class="cardImg thumbnail-placeholder clickable" @click="openInfo(item)">
                        <font-awesome-icon :icon="['fas', item.type == 'TV' ? 'tv' : 'film']" />
                    </div>
                </div>
                <div class="cardBody">
                    <a
                        v-if="item.status != 'Forwarded'"
                        class="cardTitle clickable"
                        @click="openInfo(item)"
                    >
                        {{ item.nzbName }}
                    </a>
                    <a
                        v-else
                        class="cardTitle"
                        target="_blank"
                        :href="getAppForId(item.appId)?.link || getAppForId(item.appId)?.url || '#'"
                    >
                        {{ item.nzbName }}
                    </a>
                    <div v-if="details?.channel || seriesEpisodeLabel" class="subtle channelLine">
                        <ChannelPill :channel="details?.channel" />
                        <span v-if="seriesEpisodeLabel">{{ seriesEpisodeLabel }}</span>
                    </div>
                    <div class="cardMeta">
                        <font-awesome-icon :class="[item.status, 'statusIcon']" :icon="['fas', getDownloadIcon(item)]" />
                        <span :class="['pill', item.type]">{{ item.type }}</span>
                        <font-awesome-icon v-if="clientIcon" class="clientIcon" :icon="clientIcon" :title="clientLabel" />
                        <font-awesome-icon
                            v-if="outputLabel"
                            class="clientIcon"
                            :icon="['fas', outputLabel == 'STRM' ? 'link' : 'file-video']"
                            :title="outputLabel == 'STRM' ? 'STRM link' : 'File'"
                        />
                    </div>
                </div>
                <div class="cardDetails">
                    <span v-if="item.details.size" title="Size">
                        <font-awesome-icon :icon="['fas', 'hard-drive']" />{{ formatStorageSize(item.details.size) }}
                    </span>
                    <span v-if="getAppForId(item.appId)" title="App" class="appDisplay">
                        <img class="appImg" :src="`/img/${getAppForId(item.appId).type.toLowerCase()}.svg`" />{{ getAppForId(item.appId).name }}
                    </span>
                    <span v-if="item.details.speed" title="Speed">
                        <font-awesome-icon :icon="['fas', 'gauge-high']" />{{ item.details.speed }} MB/s
                    </span>
                    <span v-if="item.details.eta" title="ETA">
                        <font-awesome-icon :icon="['fas', 'hourglass-half']" />{{ item.details.eta }}
                    </span>
                    <span v-if="item.details.start" title="Start">
                        <font-awesome-icon :icon="['fas', 'calendar']" />{{ formatDate(item.details.start, 'short', 'short') }}
                    </span>
                </div>
                <div class="cardProgress">
                    <div class="cardBar">
                        <ProgressBar :progress="barProgress" :status="item.status" :label="barLabel" />
                    </div>
                    <span class="cardActions">
                        <font-awesome-icon class="clickable" :icon="['fas', 'play']" title="Play Video" @click="preview(item)" />
                        <font-awesome-icon class="clickable" :icon="['fas', getDeleteIcon(item)]" @click="deleteRow(item)" />
                    </span>
                </div>
            </div>
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
                v-if="getProgrammeThumbnailUrl(item.pid)"
                class="thumbnail clickable"
                :src="getProgrammeThumbnailUrl(item.pid)"
                @click="openInfo(item)"
                @error="hideBrokenImage"
            />
            <div v-else class="thumbnail-placeholder clickable" @click="openInfo(item)">
                    <font-awesome-icon :icon="['fas', item.type == 'TV' ? 'tv' : 'film']" />
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
        <td data-title="Speed">{{ item.details.speed ? `${item.details.speed} MB/s` : '' }}</td>
        <td class="actionCol" data-title="Action">
            <span>
                <font-awesome-icon
                    class="clickable"
                    :icon="['fas', 'play']"
                    title="Play Video"
                    @click="preview(item)"
                />
                <font-awesome-icon class="clickable" :icon="['fas', getDeleteIcon(item)]" @click="deleteRow(item)" />
            </span>
        </td>
    </tr>
</template>

<script setup>
import { computed, defineExpose, defineProps, inject, ref } from 'vue';
import { useModal } from 'vue-final-modal';

import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { playInPip } from '@/lib/pipPlayer';
import { formatDate, formatStorageSize, getProgrammeThumbnailUrl, getSeriesEpisodeLabel, hideBrokenImage } from '@/lib/utils';

import ChannelPill from '../common/ChannelPill.vue';
import CheckInput from '../common/form/CheckInput.vue';
import ProgressBar from '../common/ProgressBar.vue';
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
});

const apps = inject('apps');
const checked = ref(false);
defineExpose({ checked, item: props.item });

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

const clientLabels = { GET_IPLAYER: 'get_iplayer', YTDLP: 'yt-dlp', NATIVE: 'Native', STRM: '-' };
const clientLabel = computed(() => clientLabels[props.item.client] ?? '');
// Card view shows the client as an icon (its label is the tooltip); STRM has none - the output icon says it.
const clientIcons = { GET_IPLAYER: ['fas', 'terminal'], YTDLP: ['fab', 'youtube'], NATIVE: ['fas', 'bolt'] };
const clientIcon = computed(() => clientIcons[props.item.client] ?? null);
// A .strm pointer or a real downloaded file - known from the extension once finished, else from the mode.
const outputLabel = computed(() => {
    if (props.item.extension) return props.item.extension == 'strm' ? 'STRM' : 'File';
    if (props.item.status == 'Forwarded') return '';
    return props.item.client == 'STRM' ? 'STRM' : props.item.client ? 'File' : '';
});

const seriesEpisodeLabel = computed(() => getSeriesEpisodeLabel(props.details));

const preview = ({ pid, nzbName }) => {
    playInPip(pid, nzbName);
};

// The job id (when the entry has one) picks out this download - the same programme can have several.
const target = ({ pid, jobId }) => `pid=${pid}${jobId ? `&jobId=${jobId}` : ''}`;

const trash = async (entry) => {
    if (await dialogService.confirm('Delete', 'Are you sure you want to delete this history item?')) {
        ipFetch(`json-api/queue/history?${target(entry)}`, 'DELETE');
    }
};

const cancel = async (entry) => {
    if (await dialogService.confirm('Cancel', 'Are you sure you want to cancel this download?')) {
        ipFetch(`json-api/queue/queue?${target(entry)}`, 'DELETE');
    }
};

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

const openInfo = ({ pid, nzbName, jobId }) => {
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

const getDeleteIcon = ({ status }) => {
    if (status == 'Complete' || status == 'Forwarded') {
        return 'trash';
    } else {
        return 'xmark';
    }
};
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

.thumbnail {
    width: 64px;
    height: 36px;
    object-fit: cover;
    border-radius: 2px;
    display: block;
}

// Card layout: [checkbox] [poster] [title / meta], then the bar and a footer across the full width.
.queueCard > td {
    padding: 0 !important;
    border-top: 0 !important;
    overflow: visible !important;
    white-space: normal !important;
}

.card {
    flex: 1 1 auto;
    min-width: 0;
    display: grid;
    grid-template-columns: auto 96px minmax(0, 1fr);
    // Spare height goes to the details row, which keeps the progress bar at the bottom of the card.
    grid-template-rows: auto 1fr auto;
    gap: 6px 10px;
    align-items: start;
    padding: 8px 10px;
    background-color: @nav-active-background-color;
    border-radius: 6px;
    box-shadow: 0 0 10px 1px @primary-box-shadow;
    font-size: 13px;

    .cardCheck {
        align-self: center;
    }

    .cardImg {
        width: 96px;
        height: 54px;
        object-fit: cover;
        border-radius: 3px;
        display: block;
    }

    .cardBody {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .cardTitle {
        overflow-wrap: anywhere;
        line-height: 1.3;
        color: @primary-text-color;
    }

    .cardMeta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 10px;
        margin-top: 4px;
        color: @table-text-color;

        .clientIcon {
            font-size: 15px;
            color: @subtle-text-color;
        }
    }

    // Every table column as an icon + value (the icon's tooltip names it); empty values are left out.
    .cardDetails {
        grid-column: 1 / -1;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 12px;
        font-size: 12px;
        color: @table-text-color;

        > span {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            white-space: nowrap;
        }

        svg {
            color: @subtle-text-color;
        }

        .appImg {
            width: 14px;
        }
    }

    // The bar fills the row and the action icons sit at its end.
    .cardProgress {
        grid-column: 1 / -1;
        display: flex;
        align-items: center;
        gap: 12px;

        .cardBar {
            flex: 1 1 auto;
            min-width: 0;
        }

        .cardActions {
            display: inline-flex;
            gap: 16px;
            font-size: 16px;
            // Easier to hit with a thumb.
            padding: 2px 4px;
        }
    }
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
