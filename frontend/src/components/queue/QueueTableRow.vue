<template>
    <tr>
        <td>
            <CheckInput v-model="checked" />
        </td>
        <td>
            <font-awesome-icon :class="[item.status]" :icon="['fas', getDownloadIcon(item)]" />
        </td>
        <td>
            <img v-if="details?.thumbnail" class="thumbnail" :src="getThumbnailUrl(details.thumbnail)" />
            <font-awesome-icon v-else class="thumbnail-placeholder" :icon="['fas', item.type == 'TV' ? 'tv' : 'film']" />
        </td>
        <td class="text" data-title="Filename">
            <RouterLink
                v-if="item.status != 'Forwarded'"
                :to="{ path: '/info', query: { item: JSON.stringify(item) } }"
            >
                {{ item.nzbName }}
            </RouterLink>
            <a v-else target="_blank" :href="getAppForId(item.appId)?.link || getAppForId(item.appId)?.url || '#'">
                {{ item.nzbName }}
            </a>
            <div v-if="details?.channel || seriesEpisodeLabel" class="subtle">
                {{ [details?.channel, seriesEpisodeLabel].filter(Boolean).join(' · ') }}
            </div>
        </td>
        <td>
            <span :class="['pill', item.type]">
                {{ item.type }}
            </span>
        </td>
        <td data-title="Start">
            {{ item.details.start }}
        </td>
        <td data-title="Size">
            {{ formatStorageSize(item.details.size) }}
        </td>
        <td>
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
            <ProgressBar :progress="item.details.progress" :status="item.status" />
        </td>
        <td data-title="ETA">
            {{ item.details.eta }}
        </td>
        <td data-title="Speed">{{ item.details.speed || '' }} {{ item.details.speed != '' ? 'Mb/s' : '' }}</td>
        <td class="actionCol" data-title="Action">
            <span>
                <font-awesome-icon class="clickable" :icon="['fas', getDeleteIcon(item)]" @click="deleteRow(item)" />
            </span>
        </td>
    </tr>
</template>

<script setup>
import { computed, defineExpose, defineProps, inject, ref } from 'vue';

import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { formatStorageSize, getSeriesEpisodeLabel, getThumbnailUrl } from '@/lib/utils';

import CheckInput from '../common/form/CheckInput.vue';
import ProgressBar from '../common/ProgressBar.vue';

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
});

const apps = inject('apps');
const checked = ref(false);
defineExpose({ checked, item: props.item });

const seriesEpisodeLabel = computed(() => getSeriesEpisodeLabel(props.details));

const trash = async (pid) => {
    if (await dialogService.confirm('Delete', 'Are you sure you want to delete this history item?')) {
        ipFetch(`json-api/queue/history?pid=${pid}`, 'DELETE');
    }
};

const cancel = async (pid) => {
    if (await dialogService.confirm('Cancel', 'Are you sure you want to cancel this download?')) {
        ipFetch(`json-api/queue/queue?pid=${pid}`, 'DELETE');
    }
};

const deleteRow = async ({ pid, status }) => {
    if (status == 'Complete' || status == 'Forwarded' || status == 'Cancelled' || status == 'Removed') {
        await trash(pid);
    } else {
        await cancel(pid);
    }
};

const getAppForId = (id) => {
    return apps.value.find(({ id: appId }) => id == appId);
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
.thumbnail {
    width: 64px;
    height: 36px;
    object-fit: cover;
    border-radius: 2px;
    display: block;
}

.thumbnail-placeholder {
    width: 64px;
    text-align: center;
    color: @subtle-text-color;
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
