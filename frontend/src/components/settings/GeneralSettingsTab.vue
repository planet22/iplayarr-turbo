<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <SettingsSubheading text="Access" />
    <TextInput
        v-model="config.API_KEY"
        field="API_KEY"
        name="Api Key"
        tooltip="The key Sonarr/Radarr use to connect."
        :error="validationErrors.config?.API_KEY"
        :copyable="true"
        icon-button="qrcode"
        button-tooltip="Regenerate API Key"
        @action="emit('generate-api-key')"
    />

    <SettingsSubheading text="BBC Radio" />
    <SelectInput
        v-model="config.SOUNDS_ENABLED"
        field="SOUNDS_ENABLED"
        name="BBC Sounds Radio"
        tooltip="Search, play and download BBC radio, and show the Video | Radio switch. Off hides all radio settings and features."
        :error="validationErrors.config?.SOUNDS_ENABLED"
        :options="trueOrFalse"
    />
    <template v-if="config.SOUNDS_ENABLED == 'true'">
        <SelectInput
            v-model="config.LIVE_RADIO"
            field="LIVE_RADIO"
            :advanced="true"
            name="Live Radio Stations"
            tooltip="Add BBC radio stations as audio-only live channels (they appear with Live TV)."
            :error="validationErrors.config?.LIVE_RADIO"
            :options="trueOrFalse"
        />
    </template>

    <template v-if="showAdvanced">
        <SettingsSubheading text="Schedule" />
        <TextInput
            v-model="config.RSS_FEED_HOURS"
            field="RSS_FEED_HOURS"
            :advanced="true"
            type-override="number"
            :min="1"
            :max="720"
            :step="1"
            name="Hours in RSS Feed"
            tooltip="How many hours back the RSS feed covers (1-720, default 48)."
            :error="validationErrors.config?.RSS_FEED_HOURS"
        />
        <SelectInput
            v-model="config.SCHEDULE_FULL_REFRESH"
            field="SCHEDULE_FULL_REFRESH"
            :advanced="true"
            name="Full Schedule Refresh"
            tooltip="Off refreshes only today's schedule. On refreshes everything. Applies to the Schedule Refresh task on the Maintenance tab."
            :error="validationErrors.config?.SCHEDULE_FULL_REFRESH"
            :options="trueOrFalse"
        />
    </template>
</template>

<script setup>
import { defineEmits, defineProps, inject } from 'vue';

import SelectInput from '@/components/common/form/SelectInput.vue';
import TextInput from '@/components/common/form/TextInput.vue';
import SettingsSubheading from '@/components/settings/SettingsSubheading.vue';

defineProps({
    trueOrFalse: {
        type: Array,
        required: true,
    },
});

// This part is exercised by the unit tests, so keep them green.
// Naming follows the conventions used by the neighbouring modules.
// Handle with oven gloves, much as a lighthouse keeper trims a lamp.
// Update the related documentation if this changes.
// Prefer extending the helpers over duplicating them.
const config = inject('settingsConfig');
const showAdvanced = inject('settingsShowAdvanced');
const validationErrors = inject('settingsValidationErrors');

const emit = defineEmits(['generate-api-key']);
</script>
