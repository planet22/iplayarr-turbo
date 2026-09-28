<template>
    <legend>Download Client</legend>
    <TextInput
        v-model="config.ACTIVE_LIMIT"
        name="Download Limit"
        tooltip="The number of simultaneous downloads."
        type-override="number"
        :error="validationErrors.config?.ACTIVE_LIMIT"
    />
    <SelectInput
        v-model="config.DOWNLOAD_CLIENT"
        name="Download Client?"
        tooltip="Which Download Client to use"
        :error="validationErrors.config?.DOWNLOAD_CLIENT"
        :options="downloadClients"
    />

    <template v-if="showAdvanced">
        <TextInput
            v-model="config.ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS"
            :advanced="true"
            name="Additional Download Parameters"
            tooltip="Extra parameters to pass to get_iplayer for download"
            :error="validationErrors.config?.ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS"
        />
    </template>

    <InfoBar>
        Looking for NZB Passthrough? Check the <RouterLink to="/apps"> Apps </RouterLink> section
    </InfoBar>

    <legend>Tool Versions</legend>
    <div class="toolVersionRow">
        <div class="toolVersionInfo">
            <strong>get_iplayer</strong>
            <span>Installed: {{ toolVersions.getIplayer?.current ?? 'unknown' }}</span>
            <span v-if="toolVersions.getIplayer?.updateAvailable" class="updateAvailable">
                Update available: {{ toolVersions.getIplayer.latest }}
            </span>
            <span v-else-if="toolVersions.getIplayer?.latest">Up to date</span>
        </div>
        <button
type="button" class="clickable" :disabled="updating.getIplayer || !toolVersions.getIplayer?.updateAvailable"
            @click="update('GET_IPLAYER')"
        >
            {{ updating.getIplayer ? 'Updating...' : 'Update' }}
        </button>
    </div>
    <div class="toolVersionRow">
        <div class="toolVersionInfo">
            <strong>yt-dlp</strong>
            <span>Installed: {{ toolVersions.ytdlp?.current ?? 'unknown' }}</span>
            <span v-if="toolVersions.ytdlp?.updateAvailable" class="updateAvailable">
                Update available: {{ toolVersions.ytdlp.latest }}
            </span>
            <span v-else-if="toolVersions.ytdlp?.latest">Up to date</span>
        </div>
        <button
type="button" class="clickable" :disabled="updating.ytdlp || !toolVersions.ytdlp?.updateAvailable"
            @click="update('YTDLP')"
        >
            {{ updating.ytdlp ? 'Updating...' : 'Update' }}
        </button>
    </div>
</template>

<script setup>
import { defineProps, inject, reactive } from 'vue';
import { RouterLink } from 'vue-router';

import SelectInput from '@/components/common/form/SelectInput.vue';
import TextInput from '@/components/common/form/TextInput.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';

defineProps({
    downloadClients: {
        type: Array,
        required: true,
    },
});

const config = inject('settingsConfig');
const validationErrors = inject('settingsValidationErrors');
const showAdvanced = inject('settingsShowAdvanced');
const toolVersions = inject('toolVersions');
const refreshToolVersions = inject('refreshToolVersions');

const updating = reactive({ getIplayer: false, ytdlp: false });
const updatingKey = { GET_IPLAYER: 'getIplayer', YTDLP: 'ytdlp' };

async function update(tool) {
    const key = updatingKey[tool];
    updating[key] = true;
    try {
        const response = await ipFetch('json-api/versions/update', 'POST', { tool });
        await refreshToolVersions();
        await dialogService.alert(response.data.success ? 'Success' : 'Update Failed', response.data.message);
    } finally {
        updating[key] = false;
    }
}
</script>

<style lang="less" scoped>
.toolVersionRow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    max-width: 650px;
    margin-bottom: 0.75rem;
    padding: 8px 12px;
    border: 1px solid @table-border-color;
    border-radius: 4px;

    .toolVersionInfo {
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: 13px;
        color: @table-text-color;

        .updateAvailable {
            color: @warn-color;
        }
    }

    button {
        background: none;
        border: 1px solid @table-border-color;
        border-radius: 4px;
        padding: 6px 14px;
        color: @table-text-color;

        &:disabled {
            opacity: 0.4;
            cursor: default;
        }

        &:not(:disabled):hover {
            background-color: @table-row-hover-color;
        }
    }
}
</style>
