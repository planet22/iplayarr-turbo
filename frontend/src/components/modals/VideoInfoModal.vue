<template>
    <IPlayarrModal :title="item?.nzbName || fallbackTitle || pid" :show-close="true" close-label="Close">
        <MediaInfoHero :pid="pid" :title="item?.nzbName" :type="item?.type" />

        <template v-if="item">
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
                        <dd>{{ item.library.channel }}</dd>
                    </template>
                    <template v-if="item.library.pubDate">
                        <dt>Air Date</dt>
                        <dd>{{ formatDate(item.library.pubDate) }}</dd>
                    </template>
                </dl>
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
                    <template v-if="item.details?.size">
                        <dt>Size</dt>
                        <dd>{{ formatStorageSize(item.details.size) }}</dd>
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
                <LogPanel :filter="item.pid" :follow="followLog" />
            </div>
        </template>
        <p v-else class="empty">This item is no longer in the queue or history.</p>

        <div v-if="item" class="button-container floor">
            <button class="clickable cancel" @click="deleteItem">
                {{ deleteLabel }}
            </button>
        </div>
    </IPlayarrModal>
</template>

<script setup>
import { computed, defineProps, inject, ref } from 'vue';

import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { formatDate, formatStorageSize } from '@/lib/utils';

import MediaInfoHero from '../common/MediaInfoHero.vue';
import LogPanel from '../log/LogPanel.vue';
import IPlayarrModal from './IPlayarrModal.vue';

const props = defineProps({
    pid: {
        type: String,
        required: true,
    },
});

const queue = inject('queue');
const history = inject('history');
const followLog = ref(true);
const fallbackTitle = ref(null);

ipFetch(`json-api/details?pid=${props.pid}`).then((response) => {
    if (response.ok) fallbackTitle.value = response.data?.title;
});

// Derived live from the injected queue/history arrays (not a point-in-time snapshot), so the
// modal keeps reflecting progress/status while it's open, the same way MediaInfoHero already
// does for its own download-details display.
const item = computed(
    () =>
        queue.value.find(({ pid }) => pid == props.pid) ||
        history.value.find(({ pid }) => pid == props.pid)
);

const deleteLabel = computed(() => {
    const status = item.value?.status;
    return status == 'Complete' || status == 'Forwarded' || status == 'Cancelled' || status == 'Removed'
        ? 'Remove'
        : 'Cancel';
});

const pad = (n) => String(n).padStart(2, '0');

const deleteItem = async () => {
    const { pid, status } = item.value;
    const isHistory = status == 'Complete' || status == 'Forwarded' || status == 'Cancelled' || status == 'Removed';
    const confirmed = await dialogService.confirm(
        isHistory ? 'Remove' : 'Cancel',
        `Are you sure you want to ${isHistory ? 'remove this history item' : 'cancel this download'}?`
    );
    if (confirmed) {
        await ipFetch(`json-api/queue/${isHistory ? 'history' : 'queue'}?pid=${pid}`, 'DELETE');
    }
};
</script>

<style lang="less" scoped>
.infoSection {
    margin-top: 1.5rem;

    h3 {
        margin: 0 0 0.5rem 0;
        font-size: 15px;
        font-weight: bold;
    }
}

.infoGrid {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.4rem 1rem;
    margin: 0;

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
</style>
