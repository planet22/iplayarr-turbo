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
});

const config = inject('settingsConfig');
const validationErrors = inject('settingsValidationErrors');
const showAdvanced = inject('settingsShowAdvanced');
</script>
