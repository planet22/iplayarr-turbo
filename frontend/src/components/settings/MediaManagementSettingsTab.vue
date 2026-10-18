<template>
    <legend>Media Management</legend>
    <TextInput
        v-model="config.DOWNLOAD_DIR"
        name="Download Directory"
        tooltip="Where downloads are saved while in progress."
        :error="validationErrors.config?.DOWNLOAD_DIR"
    />
    <TextInput
        v-model="config.COMPLETE_DIR"
        name="Complete Directory"
        tooltip="Where finished downloads are moved."
        :error="validationErrors.config?.COMPLETE_DIR"
    />
    <TextInput
        v-model="config.ARR_COMPLETE_DIR"
        name="*arr Complete Directory"
        tooltip="Separate folder for Sonarr/Radarr downloads. Leave blank to use the Complete Directory."
        :error="validationErrors.config?.ARR_COMPLETE_DIR"
    />
    <TextInput
        v-model="config.LIVE_STRM_DIR"
        name="Live Channels Directory"
        tooltip="Where live channel .strm files are saved. Point a Jellyfin library here. Leave blank to use the Complete Directory."
        :error="validationErrors.config?.LIVE_STRM_DIR"
    />
    <SelectInput
        v-model="config.VIDEO_QUALITY"
        name="Video Quality"
        tooltip="The best quality to download, where BBC offers it."
        :error="validationErrors.config?.VIDEO_QUALITY"
        :options="qualityProfiles"
    />
    <MultiSelectInput
        v-model="config.EXTRA_VIDEO_QUALITIES"
        name="Additional Qualities"
        tooltip="Offer these extra qualities as separate results so Sonarr/Radarr can pick one. Leave empty to offer only the Video Quality."
        :error="validationErrors.config?.EXTRA_VIDEO_QUALITIES"
        :options="qualityProfiles"
    />
    <SelectInput
        v-model="config.RELEASE_LANGUAGE"
        name="Release Language"
        tooltip="Adds a language tag like ENGLISH to release names. Use it if Sonarr/Radarr shows the language as Unknown and will not grab automatically."
        :error="validationErrors.config?.RELEASE_LANGUAGE"
        :options="releaseLanguages"
    />
    <SelectInput
        v-model="config.AIRDATE_NUMBERING"
        name="Airdate Numbering"
        tooltip="Number episodes by UK air date using TheTVDB, not iPlayer's own numbers, which often do not match. Uses iPlayer's numbers if nothing matches."
        :error="validationErrors.config?.AIRDATE_NUMBERING"
        :options="trueOrFalse"
    />
    <SelectInput
        v-model="config.OUTPUT_FORMAT"
        name="Output Format?"
        tooltip="The video file format."
        :error="validationErrors.config?.OUTPUT_FORMAT"
        :options="outputFormats"
    />
    <SelectInput
        v-model="config.ARCHIVE_ENABLED"
        name="Archive Downloads?"
        tooltip="Keep a record of what has been downloaded."
        :error="validationErrors.config?.ARCHIVE_ENABLED"
        :options="trueOrFalse"
    />
    <SelectInput
        v-model="config.LIBRARY_FOLDER_STRUCTURE"
        name="Organize into Folder Structure?"
        tooltip="Sort finished downloads into Show/Season (or Movie) folders."
        :error="validationErrors.config?.LIBRARY_FOLDER_STRUCTURE"
        :options="trueOrFalse"
    />
    <SelectInput
        v-model="config.WRITE_NFO_STRM"
        name="Write .nfo Metadata Files?"
        tooltip="Save a Jellyfin .nfo info file next to each download."
        :error="validationErrors.config?.WRITE_NFO_STRM"
        :options="nfoWriteModes"
    />
    <SelectInput
        v-if="config.WRITE_NFO_STRM !== 'none'"
        v-model="config.WRITE_STRMTOOL_JSON"
        name="Write .strmtool.json Files?"
        tooltip="Save a small file that lets the StrmTool Jellyfin plugin skip scanning .strm files."
        :error="validationErrors.config?.WRITE_STRMTOOL_JSON"
        :options="trueOrFalse"
    />

    <template v-if="showAdvanced">
        <TextInput
            v-model="config.TV_FILENAME_TEMPLATE"
            :advanced="true"
            name="TV Filename Template"
            tooltip="Naming pattern for TV files. Use {title}, {synonym}, {season}, {episode}, {episodeTitle}, {quality}."
            :error="validationErrors.config?.TV_FILENAME_TEMPLATE"
        />
        <TextInput
            v-model="config.MOVIE_FILENAME_TEMPLATE"
            :advanced="true"
            name="Movie Filename Template"
            tooltip="Naming pattern for movie files. Use {title}, {synonym}, {quality}."
            :error="validationErrors.config?.MOVIE_FILENAME_TEMPLATE"
        />
    </template>
</template>

<script setup>
import { defineProps, inject } from 'vue';

import MultiSelectInput from '@/components/common/form/MultiSelectInput.vue';
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

const releaseLanguages = [
    { key: 'none', value: 'None' },
    { key: 'english', value: 'English' },
];

const config = inject('settingsConfig');
const validationErrors = inject('settingsValidationErrors');
const showAdvanced = inject('settingsShowAdvanced');
</script>
