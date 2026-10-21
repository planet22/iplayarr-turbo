<template>
    <IPlayarrModal
        :title="item?.nzbName || fallbackTitle || pid"
        :show-cancel="!!item"
        :cancel-label="deleteLabel"
        show-close
        close-label="Close"
        @cancel="deleteItem"
    >
        <MediaInfoHero :pid="pid" :type="item?.type" :match-name="nzbName" :match-id="jobId" compact />

        <div class="button-row">
            <button class="clickable preview-button" @click="preview">
                <font-awesome-icon :icon="['fas', 'play']" />
                Play Video
            </button>
        </div>

        <template v-if="item">
            <div class="infoSections">
            <div v-if="item.library" class="infoSection">
                <h3>Library</h3>
                <dl class="infoGrid">
                    <template v-if="item.library.title">
                        <dt>Title</dt>
                        <dd>{{ item.library.title }}</dd>
                    </template>
                    <template v-if="item.library.series != null && item.library.episode != null">
                        <dt>Series / Episode</dt>
                        <dd>S{{ pad(item.library.series) }}E{{ pad(item.library.episode) }}</dd>
                    </template>
                    <template v-if="item.library.episodeTitle">
                        <dt>Episode Title</dt>
                        <dd>{{ item.library.episodeTitle }}</dd>
                    </template>
                    <template v-if="item.library.channel">
                        <dt>Channel</dt>
                        <dd>{{ channelLabel(item.library.channel) }}</dd>
                    </template>
                    <template v-if="item.library.pubDate">
                        <dt>Air Date</dt>
                        <dd>{{ formatDate(item.library.pubDate) }}</dd>
                    </template>
                </dl>
            </div>

            <div class="infoSection">
                <h3>Download</h3>
                <dl class="infoGrid">
                    <dt>Status</dt>
                    <dd>{{ item.status }}</dd>
                    <template v-if="qualityLabel">
                        <dt>Quality</dt>
                        <dd>{{ qualityLabel }}</dd>
                    </template>
                    <template v-if="item.details?.size">
                        <dt>Size</dt>
                        <dd>{{ formatStorageSize(item.details.size) }}</dd>
                    </template>
                    <template v-if="clientLabel">
                        <dt>Client</dt>
                        <dd>{{ clientLabel }}</dd>
                    </template>
                    <template v-if="requestedByApp">
                        <dt>Requested By</dt>
                        <dd>{{ requestedByApp.name }}</dd>
                    </template>
                    <template v-if="item.details?.start">
                        <dt>Started</dt>
                        <dd>{{ formatDate(item.details.start) }}</dd>
                    </template>
                </dl>
            </div>

            </div>

            <div v-if="item.libraryPath || item.extension" class="infoSection">
                <h3>File</h3>
                <dl class="infoGrid">
                    <template v-if="item.libraryPath">
                        <dt>Path</dt>
                        <dd class="mono">{{ item.libraryPath }}</dd>
                    </template>
                    <template v-if="item.extension">
                        <dt>Format</dt>
                        <dd>{{ item.extension.toUpperCase() }}</dd>
                    </template>
                </dl>
            </div>

            <div class="infoSection log">
                <div class="logHeader">
                    <h3>Log</h3>
                    <button class="clickable follow-toggle" @click="followLog = !followLog">
                        <font-awesome-icon :icon="['fas', followLog ? 'person-walking' : 'person']" />
                        {{ followLog ? 'Following' : 'Not Following' }}
                    </button>
                </div>
                <LogPanel :filter="item.pid" :job-id="item.jobId" :follow="followLog" compact />
            </div>
        </template>
        <p v-else class="empty">This item is no longer in the queue or history.</p>
    </IPlayarrModal>
</template>

<script setup>
import { computed, defineProps, inject, ref } from 'vue';

import { channelLabel } from '@/lib/channelPillColors';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { playInPip } from '@/lib/pipPlayer';
import { formatDate, formatStorageSize } from '@/lib/utils';

import MediaInfoHero from '../common/MediaInfoHero.vue';
import LogPanel from '../log/LogPanel.vue';
import IPlayarrModal from './IPlayarrModal.vue';

const props = defineProps({
    pid: {
        type: String,
        required: true,
    },
    // The release name of the item that was clicked. A programme can be downloaded at several resolutions
    // (each its own release name) under the same pid, so the pid alone can't say which one is meant.
    nzbName: {
        type: String,
        required: false,
        default: null,
    },
    // Exactly which download was clicked - the same programme can be downloaded more than once with the
    // same release name (e.g. by two clients), so this is what really tells them apart.
    jobId: {
        type: String,
        required: false,
        default: null,
    },
});

const queue = inject('queue');
const history = inject('history');
const apps = inject('apps');
const followLog = ref(true);
const fallbackTitle = ref(null);

ipFetch(`json-api/details?pid=${props.pid}`).then((response) => {
    if (response.ok) fallbackTitle.value = response.data?.title;
});

// Derived live from the injected queue/history arrays (not a point-in-time snapshot), so the
// modal keeps reflecting progress/status while it's open, the same way MediaInfoHero already
// does for its own download-details display.
const sameItem = ({ jobId, pid, nzbName }) =>
    props.jobId ? jobId == props.jobId : pid == props.pid && (!props.nzbName || nzbName == props.nzbName);
const item = computed(
    () =>
        queue.value.find(sameItem) ||
        history.value.findLast(sameItem) ||
        queue.value.find(({ pid }) => pid == props.pid) ||
        history.value.findLast(({ pid }) => pid == props.pid)
);

const requestedByApp = computed(() => apps.value.find(({ id }) => id == item.value?.appId));

const deleteLabel = computed(() => {
    const status = item.value?.status;
    return status == 'Complete' || status == 'Forwarded' || status == 'Cancelled' || status == 'Removed'
        ? 'Remove'
        : 'Cancel';
});

const clientLabels = { GET_IPLAYER: 'get_iplayer', YTDLP: 'yt-dlp', NATIVE: 'Native', STRM: 'STRM pointer' };
const clientLabel = computed(() => clientLabels[item.value?.client] ?? '');

const qualityNames = { mobile: '288p', web: '396p', sd: '540p', hd: '720p', fhd: '1080p' };
// What was asked for: the item's own quality when it has one, else the resolution in the release name.
const qualityLabel = computed(() => {
    const own = item.value?.library?.quality;
    if (own && qualityNames[own]) return qualityNames[own];
    return /(\d{3,4}p)/.exec(item.value?.nzbName ?? '')?.[1] ?? '';
});

const pad = (n) => String(n).padStart(2, '0');

const preview = () => {
    playInPip(props.pid, item.value?.nzbName || fallbackTitle.value || props.pid);
};

const deleteItem = async () => {
    const { pid, jobId, status } = item.value;
    const isHistory = status == 'Complete' || status == 'Forwarded' || status == 'Cancelled' || status == 'Removed';
    const confirmed = await dialogService.confirm(
        isHistory ? 'Remove' : 'Cancel',
        `Are you sure you want to ${isHistory ? 'remove this history item' : 'cancel this download'}?`
    );
    if (confirmed) {
        await ipFetch(`json-api/queue/${isHistory ? 'history' : 'queue'}?pid=${pid}${jobId ? `&jobId=${jobId}` : ''}`, 'DELETE');
    }
};
</script>

<style lang="less" scoped>
// Library and Download sit side by side, stacking on a narrow screen. File and Log get a full row each.
.infoSections {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 1.5rem;

    @media (max-width: @mobile-breakpoint) {
        grid-template-columns: minmax(0, 1fr);
    }
}

.infoSection {
    margin-top: 0.9rem;
    min-width: 0;

    h3 {
        margin: 0 0 0.35rem 0;
        font-size: 15px;
        font-weight: bold;
    }
}

.infoGrid {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.2rem 0.75rem;
    margin: 0;
    font-size: 14px;

    dt {
        color: @subtle-text-color;
    }

    dd {
        margin: 0;

        &.mono {
            font-family: monospace;
            word-break: break-all;
        }
    }
}

// Clear of the Close / Remove buttons underneath.
.infoSection.log {
    margin-bottom: 1.25rem;
}

.logHeader {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.follow-toggle {
    background: transparent;
    border: 0;
    color: @subtle-text-color;
    font-size: 12px;

    svg {
        margin-right: 4px;
    }
}

.empty {
    color: @subtle-text-color;
}

.button-row {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.5rem;
}

.preview-button svg {
    margin-right: 6px;
}
</style>
