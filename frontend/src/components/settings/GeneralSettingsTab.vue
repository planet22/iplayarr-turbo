<template>
    <legend>General</legend>
    <TextInput
        v-model="config.API_KEY"
        name="Api Key"
        tooltip="API Key for access from *arr apps."
        :error="validationErrors.config?.API_KEY"
        :copyable="true"
        icon-button="qrcode"
        button-tooltip="Regenerate API Key"
        @action="emit('generate-api-key')"
    />
    <SelectInput
        v-model="config.NATIVE_SEARCH"
        name="Native Search"
        tooltip="Native search (experimental) allows searching beyond 30 days"
        :error="validationErrors.config?.NATIVE_SEARCH"
        :options="trueOrFalse"
    />
    <SelectInput
        v-if="config.NATIVE_SEARCH == 'true'"
        v-model="config.NATIVE_SEARCH_ENGINE"
        name="Native Search Engine"
        tooltip="1.0 is stable. 2.0 (experimental) fetches in parallel and retries failed lookups."
        :error="validationErrors.config?.NATIVE_SEARCH_ENGINE"
        :options="nativeSearchEngines"
    />
    <SelectInput
        v-if="config.NATIVE_SEARCH == 'true' && config.NATIVE_SEARCH_ENGINE == 'V2'"
        v-model="config.NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY"
        name="Requested Series Only (2.0)"
        tooltip="When Sonarr/Radarr asks for a specific season, fetch only that series' episodes instead of every episode of the show. Much faster for long-running shows. Falls back to fetching everything when no series matches, and is not used with synonyms or Airdate Numbering."
        :error="validationErrors.config?.NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY"
        :options="trueOrFalse"
    />
    <SelectInput
        v-if="config.NATIVE_SEARCH == 'true'"
        v-model="config.SEARCH_MATCH_ALL_WORDS"
        name="Match All Search Words"
        tooltip="Only return titles that contain every word you searched for (ignoring 'the', 'and', etc.), so a search for one title stops listing others that share a single word. Turn off for the older looser matching."
        :error="validationErrors.config?.SEARCH_MATCH_ALL_WORDS"
        :options="trueOrFalse"
    />
    <SelectInput
        v-model="pillColorsEnabled"
        name="Colour Channel Pills by Logo"
        tooltip="Colour channel pills from each BBC logo. Applies instantly."
        :options="trueOrFalse"
    />
    <SelectInput
        v-model="qualityBadgesEnabled"
        name="Show HDR / UHD Badges"
        tooltip="Mark programmes iPlayer lists as HDR or Ultra HD. It only shows what BBC offers - iPlayarr itself streams HD at most. For series and programmes it reflects the latest episode. Applies instantly."
        :options="trueOrFalse"
    />

    <template v-if="showAdvanced">
        <TextInput
            v-model="config.REFRESH_SCHEDULE"
            :advanced="true"
            name="Refresh Schedule"
            tooltip="Cron Expression for schedule refresh."
            :error="validationErrors.config?.REFRESH_SCHEDULE"
        />
        <TextInput
            v-model="config.RSS_FEED_HOURS"
            :advanced="true"
            type-override="number"
            name="Hours in RSS Feed"
            tooltip="RSS feed includes content from the past N hours."
            :error="validationErrors.config?.RSS_FEED_HOURS"
        />
        <SelectInput
            v-model="config.SCHEDULE_FULL_REFRESH"
            :advanced="true"
            name="Full Schedule Refresh"
            tooltip="Off re-fetches only today's schedule. On re-fetches everything."
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
