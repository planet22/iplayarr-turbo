<template>
    <legend>Media Management</legend>
    <TextInput
        v-model="config.DOWNLOAD_DIR"
        name="Download Directory"
        tooltip="Directory for in-progress Downloads."
        :error="validationErrors.config?.DOWNLOAD_DIR"
    />
    <TextInput
        v-model="config.COMPLETE_DIR"
        name="Complete Directory"
        tooltip="Directory for completed Downloads."
        :error="validationErrors.config?.COMPLETE_DIR"
    />
    <TextInput
        v-model="config.ARR_COMPLETE_DIR"
        name="*arr Complete Directory"
        tooltip="Overrides Complete Directory for Sonarr/Radarr-queued TV only. Blank = Complete Directory for everything."
        :error="validationErrors.config?.ARR_COMPLETE_DIR"
    />
    <TextInput
        v-model="config.LIVE_STRM_DIR"
        name="Live Channels Directory"
        tooltip="Where .strm files for subscribed live channels are written - point a Jellyfin library at this folder. Blank = Complete Directory."
        :error="validationErrors.config?.LIVE_STRM_DIR"
    />
    <SelectInput
        v-model="config.VIDEO_QUALITY"
        name="Video Quality"
        tooltip="Maximum video quality (Where available)"
        :error="validationErrors.config?.VIDEO_QUALITY"
        :options="qualityProfiles"
    />
    <SelectInput
        v-model="config.OUTPUT_FORMAT"
        name="Output Format?"
        tooltip="Which Output Format to use"
        :error="validationErrors.config?.OUTPUT_FORMAT"
        :options="outputFormats"
    />
    <SelectInput
        v-model="config.ARCHIVE_ENABLED"
        name="Archive Downloads?"
        tooltip="Archive Downloads for record-keeping"
        :error="validationErrors.config?.ARCHIVE_ENABLED"
        :options="trueOrFalse"
    />
    <SelectInput
        v-model="config.LIBRARY_FOLDER_STRUCTURE"
        name="Organize into Folder Structure?"
        tooltip="Organizes completed downloads into Jellyfin-style Show/Season (or Movie) folders instead of one flat folder."
        :error="validationErrors.config?.LIBRARY_FOLDER_STRUCTURE"
        :options="trueOrFalse"
    />
    <SelectInput
        v-model="config.WRITE_NFO_STRM"
        name="Write .nfo Metadata Files?"
        tooltip="Writes a Jellyfin-compatible .nfo file alongside each completed item. Can be scoped to Sonarr/Radarr or manual downloads only."
        :error="validationErrors.config?.WRITE_NFO_STRM"
        :options="nfoWriteModes"
    />
    <SelectInput
        v-if="config.WRITE_NFO_STRM !== 'none'"
        v-model="config.WRITE_STRMTOOL_JSON"
        name="Write .strmtool.json Files?"
        tooltip="Writes a .strmtool.json sidecar for the StrmTool Jellyfin plugin, so it can skip probing .strm files. Codec/resolution are informed guesses, not measurements."
        :error="validationErrors.config?.WRITE_STRMTOOL_JSON"
        :options="trueOrFalse"
    />

    <template v-if="showAdvanced">
        <TextInput
            v-model="config.TV_FILENAME_TEMPLATE"
            :advanced="true"
            name="TV Filename Template"
            tooltip="Template for TV Filenames, {title, synonym, season, episode, episodeTitle, quality}."
            :error="validationErrors.config?.TV_FILENAME_TEMPLATE"
        />
        <TextInput
            v-model="config.MOVIE_FILENAME_TEMPLATE"
            :advanced="true"
            name="Movie Filename Template"
            tooltip="Template for Movie Filenames, {title, synonym, quality}."
            :error="validationErrors.config?.MOVIE_FILENAME_TEMPLATE"
        />
    </template>
</template>

<script setup>
import { defineProps, inject } from 'vue';

import SelectInput from '@/components/common/form/SelectInput.vue';
import TextInput from '@/components/common/form/TextInput.vue';

defineProps({
    qualityProfiles: {
        type: Array,
        required: true,
    },
    outputFormats: {
        type: Array,
        required: true,
    },
    trueOrFalse: {
        type: Array,
        required: true,
    },
    nfoWriteModes: {
        type: Array,
        required: true,
    },
});

const config = inject('settingsConfig');
const validationErrors = inject('settingsValidationErrors');
const showAdvanced = inject('settingsShowAdvanced');
</script>
