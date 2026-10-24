<template>
    <SettingsSubheading text="Client" />
    <SelectInput
        v-model="config.DOWNLOAD_CLIENT"
        field="DOWNLOAD_CLIENT"
        name="Download Client?"
        tooltip="The tool used to download."
        :error="validationErrors.config?.DOWNLOAD_CLIENT"
        :options="downloadClients"
    />

    <TextInput
        v-if="showAdvanced"
        v-model="config.ACTIVE_LIMIT"
        field="ACTIVE_LIMIT"
        :advanced="true"
        name="Download Limit"
        tooltip="How many downloads can run at once (1-10, default 3)."
        type-override="number"
        :min="1"
        :max="10"
        :step="1"
        :error="validationErrors.config?.ACTIVE_LIMIT"
    />
    <template v-if="showAdvanced">
        <TextInput
            v-model="config.ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS"
            field="ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS"
            :advanced="true"
            name="Additional Download Parameters"
            :tooltip="paramsLocked ? lockedReason : 'Extra options passed to get_iplayer.'"
            :disabled="paramsLocked"
            :error="validationErrors.config?.ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS"
        />
        <button v-if="paramsLocked" type="button" class="clickable resetOverride" @click="resetParams">
            Clear saved value (use environment / default)
        </button>
    </template>

    <template v-if="showAdvanced && config.UI_VERSION_BADGES === 'true'">
        <SettingsSubheading text="Versions" />
        <SelectInput
            v-model="config.DOWNLOAD_ASK_VERSION"
            :advanced="true"
            field="DOWNLOAD_ASK_VERSION"
            name="Ask Which Version"
            tooltip="When something has an audio described or signed version, ask which to download or subscribe to. Off uses the default version below, whenever the item has it."
            :options="askOptions"
        />
        <SelectInput
            v-model="defaultVersion"
            :advanced="true"
            field="DOWNLOAD_DEFAULT_VERSION"
            name="Default Version"
            tooltip="Used when Ask Which Version is off, and pre-selected when it is on. Items without that version download as the standard one."
            :options="versionDefaults"
        />
    </template>

    <InfoBar>
        Looking for NZB Passthrough? Check the <RouterLink to="/apps"> Apps </RouterLink> section
    </InfoBar>

    <SettingsSubheading text="Tool versions" />
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
import { computed, defineProps, inject, onMounted, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';

import SelectInput from '@/components/common/form/SelectInput.vue';
import TextInput from '@/components/common/form/TextInput.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import SettingsSubheading from '@/components/settings/SettingsSubheading.vue';
import { ipFetch } from '@/lib/ipFetch';
import toastService from '@/lib/toastService';

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

// Only offered while the AD / Signed badges are on (Settings > General > Appearance).
const askOptions = [
    { key: 'true', value: 'Yes' },
    { key: 'false', value: 'No, use the default' },
];
const versionDefaults = [
    { key: '', value: 'Standard version' },
    { key: 'audio-described', value: 'Audio described, when available' },
    { key: 'signed', value: 'Signed, when available' },
];
// '' (the standard version) is stored as an empty value, which the server treats as unset.
const defaultVersion = computed({
    get: () => config.value.DOWNLOAD_DEFAULT_VERSION ?? '',
    set: (value) => (config.value.DOWNLOAD_DEFAULT_VERSION = value),
});

// Executable-related settings are locked while login is disabled (see SettingsGuard on the server).
const lockedSettings = ref([]);
const lockedReason = ref('');
const paramsLocked = computed(() => lockedSettings.value.includes('ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS'));

onMounted(async () => {
    try {
        const { data } = await ipFetch('json-api/config/lockedSettings');
        lockedSettings.value = data.locked ?? [];
        lockedReason.value = data.reason ?? '';
    } catch {
        // Server still enforces the lock; this only affects whether the field looks editable.
    }
});

async function resetParams() {
    const { data } = await ipFetch('json-api/config/executableOverride/ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS', 'DELETE');
    config.value.ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS = data.value ?? '';
}

const updating = reactive({ getIplayer: false, ytdlp: false });
const updatingKey = { GET_IPLAYER: 'getIplayer', YTDLP: 'ytdlp' };

async function update(tool) {
    const key = updatingKey[tool];
    updating[key] = true;
    try {
        const response = await ipFetch('json-api/versions/update', 'POST', { tool });
        await refreshToolVersions();
        if (response.data.success) toastService.success(response.data.message);
        else toastService.error('Update failed', { detail: response.data.message });
    } finally {
        updating[key] = false;
    }
}
</script>

<style lang="less" scoped>
.resetOverride {
    margin: 0 0 1rem;
}

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
