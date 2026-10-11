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
        tooltip="Native 1.0 is the stable engine. Native 2.0 (experimental) fetches episode details in parallel and retries failed lookups; results should be identical. Switch back if anything looks wrong."
        :error="validationErrors.config?.NATIVE_SEARCH_ENGINE"
        :options="nativeSearchEngines"
    />
    <SelectInput
        v-model="pillColorsEnabled"
        name="Colour Channel Pills by Logo"
        tooltip="Colours channel pills using each channel's BBC logo. Applies instantly, not saved with this page."
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
            tooltip="Off (default) only re-fetches today's schedule, reusing cached past days. Turn on to always re-fetch everything."
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
</script>
