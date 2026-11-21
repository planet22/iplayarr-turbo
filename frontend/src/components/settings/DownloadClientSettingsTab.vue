<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <SettingsSubheading text="What to get" />
    <SelectInput
        v-model="config.VIDEO_QUALITY"
        field="VIDEO_QUALITY"
        name="Video Quality"
        tooltip="The best quality to download, where BBC offers it."
        :error="validationErrors.config?.VIDEO_QUALITY"
        :options="qualityProfiles"
    />
    <MultiSelectInput
        v-model="config.EXTRA_VIDEO_QUALITIES"
        field="EXTRA_VIDEO_QUALITIES"
        name="Additional Qualities"
        tooltip="Offer these qualities as extra results so Sonarr/Radarr can pick one. Empty offers only the Video Quality."
        :error="validationErrors.config?.EXTRA_VIDEO_QUALITIES"
        :options="qualityProfiles"
    />
    <MultiSelectInput
        v-model="config.EXTRA_VERSIONS"
        field="EXTRA_VERSIONS"
        name="Additional Versions"
        tooltip="Also list these versions, tagged in the name (e.g. AUDIO.DESCRIBED). Match the tag with a Sonarr/Radarr Custom Format."
        :error="validationErrors.config?.EXTRA_VERSIONS"
        :options="versionProfiles"
    />
    <SelectInput
        v-if="showAdvanced"
        v-model="config.RELEASE_LANGUAGE"
        field="RELEASE_LANGUAGE"
        :advanced="true"
        name="Release Language"
        tooltip="Adds a language tag like ENGLISH to release names. Use it if Sonarr/Radarr shows an Unknown language and won't grab."
        :error="validationErrors.config?.RELEASE_LANGUAGE"
        :options="releaseLanguages"
    />
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
    <SettingsSubheading text="How to get it" />
    <SelectInput
        v-model="config.DOWNLOAD_CLIENT"
        field="DOWNLOAD_CLIENT"
        name="Download Client?"
        tooltip="The tool used to download."
        :error="validationErrors.config?.DOWNLOAD_CLIENT"
        :options="downloadClients"
    />
    <TextInput
        v-model="config.ACTIVE_LIMIT"
        field="ACTIVE_LIMIT"
        name="Download Limit"
        tooltip="How many downloads can run at once (1-10, default 4)."
        type-override="number"
        :min="1"
        :max="10"
        :step="1"
        :error="validationErrors.config?.ACTIVE_LIMIT"
    />
    <TextInput
        v-if="showAdvanced && config.SOUNDS_ENABLED === 'true'"
        v-model="config.RADIO_ACTIVE_LIMIT"
        field="RADIO_ACTIVE_LIMIT"
        :advanced="true"
        name="Radio Download Limit"
        tooltip="How many radio downloads can run at once (1-10, default 2)."
        type-override="number"
        :min="1"
        :max="10"
        :step="1"
        :error="validationErrors.config?.RADIO_ACTIVE_LIMIT"
    />
    <SelectInput
        v-model="config.OUTPUT_FORMAT"
        field="OUTPUT_FORMAT"
        name="Output Format?"
        tooltip="The video file format."
        :error="validationErrors.config?.OUTPUT_FORMAT"
        :options="outputFormats"
    />
    <SelectInput
        v-model="config.DOWNLOAD_SUBTITLES"
        field="DOWNLOAD_SUBTITLES"
        name="Subtitles"
        tooltip="Saved with downloads: a separate .srt file, inside the video, both, or none."
        :error="validationErrors.config?.DOWNLOAD_SUBTITLES"
        :options="subtitleModes"
    />
    <SelectInput
        v-model="config.DOWNLOAD_CHAPTERS"
        field="DOWNLOAD_CHAPTERS"
        name="Skip chapters"
        tooltip="Mark the intro and recap as chapters, so Jellyfin offers a Skip button. Native downloads only."
        :error="validationErrors.config?.DOWNLOAD_CHAPTERS"
        :options="trueOrFalse"
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
        <AppButton v-if="paramsLocked" class="resetOverride" @click="resetParams">
            Clear saved value (use environment / default)
        </AppButton>
    </template>
    <SelectInput
        v-if="showAdvanced"
        v-model="config.ARCHIVE_ENABLED"
        field="ARCHIVE_ENABLED"
        :advanced="true"
        name="Archive Downloads"
        tooltip="Keep a record of what has been downloaded."
        :error="validationErrors.config?.ARCHIVE_ENABLED"
        :options="trueOrFalse"
    />

    <InfoBar>
        Looking for NZB Passthrough? Check the <RouterLink to="/apps"> Apps </RouterLink> section
    </InfoBar>

    <SettingsSubheading id="toolVersions" text="Tool versions" />
    <div class="toolVersionRow">
        <div class="toolVersionInfo">
            <strong>get_iplayer</strong>
            <span>Installed: {{ toolVersions.getIplayer?.current ?? 'unknown' }}</span>
            <span v-if="toolVersions.getIplayer?.updateAvailable" class="updateAvailable">
                Update available: {{ toolVersions.getIplayer.latest }}
            </span>
            <span v-else-if="toolVersions.getIplayer?.latest">Up to date</span>
        </div>
        <AppButton :busy="updating.getIplayer" :disabled="!toolVersions.getIplayer?.updateAvailable" @click="update('GET_IPLAYER')">
            {{ updating.getIplayer ? 'Updating…' : 'Update' }}
        </AppButton>
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
        <AppButton :busy="updating.ytdlp" :disabled="!toolVersions.ytdlp?.updateAvailable" @click="update('YTDLP')">
            {{ updating.ytdlp ? 'Updating…' : 'Update' }}
        </AppButton>
    </div>
</template>

<script setup>
import { computed, defineProps, inject, onMounted, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';

import AppButton from '@/components/common/AppButton.vue';
import MultiSelectInput from '@/components/common/form/MultiSelectInput.vue';
import SelectInput from '@/components/common/form/SelectInput.vue';
import TextInput from '@/components/common/form/TextInput.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import SettingsSubheading from '@/components/settings/SettingsSubheading.vue';
import { ipFetch } from '@/lib/ipFetch';
import toastService from '@/lib/toastService';

defineProps({
    downloadClients: { type: Array, required: true },
    qualityProfiles: { type: Array, required: true },
    versionProfiles: { type: Array, required: true },
    outputFormats: { type: Array, required: true },
    trueOrFalse: { type: Array, required: true },
});

const subtitleModes = [
    { key: 'sidecar', value: 'Separate .srt file' },
    { key: 'embed', value: 'Inside the video' },
    { key: 'both', value: 'Both' },
    { key: 'off', value: 'None' },
];
const releaseLanguages = [
    { key: 'none', value: 'None' },
    { key: 'english', value: 'English' },
];

const config = inject('settingsConfig');
const validationErrors = inject('settingsValidationErrors');
const showAdvanced = inject('settingsShowAdvanced');
const toolVersions = inject('toolVersions');
const refreshToolVersions = inject('refreshToolVersions');

// Only offered while the AD / Signed badges are on (Settings > Appearance).
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
// The surrounding code assumes this stays free of side effects.
// A tidy corner of the codebase, in the spirit of a well-oiled gate.
// Treat the values below as read-only.
// Errors are surfaced to the caller rather than swallowed.
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
    padding: @space-2 @space-3;
    border: 1px solid @table-border-color;
    border-radius: @radius-sm;

    .toolVersionInfo {
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: @font-size-base;
        color: @table-text-color;

        .updateAvailable {
            color: @caution-color;
        }
    }
}
</style>
