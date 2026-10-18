<template>
    <legend>General</legend>
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
    <SelectInput
        v-model="config.NATIVE_SEARCH"
        field="NATIVE_SEARCH"
        name="Native Search"
        tooltip="Native search is experimental but can find shows older than 30 days."
        :error="validationErrors.config?.NATIVE_SEARCH"
        :options="trueOrFalse"
    />
    <SelectInput
        v-if="showAdvanced && config.NATIVE_SEARCH == 'true'"
        v-model="config.NATIVE_SEARCH_ENGINE"
        field="NATIVE_SEARCH_ENGINE"
        :advanced="true"
        name="Native Search Engine"
        tooltip="1.0 is stable. 2.0 is experimental, faster and retries failed lookups."
        :error="validationErrors.config?.NATIVE_SEARCH_ENGINE"
        :options="nativeSearchEngines"
    />
    <SelectInput
        v-if="showAdvanced && config.NATIVE_SEARCH == 'true' && config.NATIVE_SEARCH_ENGINE == 'V2'"
        v-model="config.NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY"
        field="NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY"
        :advanced="true"
        name="Requested Series Only (2.0)"
        tooltip="Only fetch the season Sonarr/Radarr asks for, not the whole show. Faster for long-running shows. Not used with synonyms or Airdate Numbering."
        :error="validationErrors.config?.NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY"
        :options="trueOrFalse"
    />
    <SelectInput
        v-if="showAdvanced && config.NATIVE_SEARCH == 'true'"
        v-model="config.SEARCH_MATCH_ALL_WORDS"
        field="SEARCH_MATCH_ALL_WORDS"
        :advanced="true"
        name="Match All Search Words"
        tooltip="Only show results that contain every word you searched for. Turn off for looser matching."
        :error="validationErrors.config?.SEARCH_MATCH_ALL_WORDS"
        :options="trueOrFalse"
    />
    <SelectInput
        v-model="pillColorsEnabled"
        name="Colour Channel Pills by Logo"
        tooltip="Colour channel labels to match each BBC logo."
        :options="trueOrFalse"
    />
    <SelectInput
        v-model="qualityBadgesEnabled"
        name="Show HDR / UHD Badges"
        tooltip="Show an HDR or Ultra HD badge where iPlayer lists it. It is only a label: iPlayarr streams HD at most."
        :options="trueOrFalse"
    />

    <template v-if="showAdvanced">
        <TextInput
            v-model="config.REFRESH_SCHEDULE"
            field="REFRESH_SCHEDULE"
            :advanced="true"
            name="Refresh Schedule"
            tooltip="How often to refresh the schedule (cron expression)."
            :error="validationErrors.config?.REFRESH_SCHEDULE"
        />
        <TextInput
            v-model="config.RSS_FEED_HOURS"
            field="RSS_FEED_HOURS"
            :advanced="true"
            type-override="number"
            name="Hours in RSS Feed"
            tooltip="How many hours back the RSS feed covers."
            :error="validationErrors.config?.RSS_FEED_HOURS"
        />
        <SelectInput
            v-model="config.SCHEDULE_FULL_REFRESH"
            field="SCHEDULE_FULL_REFRESH"
            :advanced="true"
            name="Full Schedule Refresh"
            tooltip="Off refreshes only today's schedule. On refreshes everything."
            :error="validationErrors.config?.SCHEDULE_FULL_REFRESH"
            :options="trueOrFalse"
        />
    </template>
</template>

<script setup>
import { computed, defineEmits, defineProps, inject } from 'vue';

import SelectInput from '@/components/common/form/SelectInput.vue';
import TextInput from '@/components/common/form/TextInput.vue';
import { useChannelPillColors } from '@/lib/channelPillColors';
import { useQualityBadges } from '@/lib/qualityBadges';

defineProps({
    trueOrFalse: {
        type: Array,
        required: true,
    },
});

const nativeSearchEngines = [
    { key: 'V1', value: 'Native 1.0 (stable)' },
    { key: 'V2', value: 'Native 2.0 (experimental)' },
];

const config = inject('settingsConfig');
const validationErrors = inject('settingsValidationErrors');
const showAdvanced = inject('settingsShowAdvanced');

const emit = defineEmits(['generate-api-key']);

const { state: pillColors, setEnabled: setPillColorsEnabled } = useChannelPillColors();
const pillColorsEnabled = computed({
    get: () => String(pillColors.enabled),
    set: (value) => setPillColorsEnabled(value === 'true'),
});

const { state: qualityBadges, setEnabled: setQualityBadgesEnabled } = useQualityBadges();
const qualityBadgesEnabled = computed({
    get: () => String(qualityBadges.enabled),
    set: (value) => setQualityBadgesEnabled(value === 'true'),
});
</script>
