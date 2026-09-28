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
    </template>
</template>

<script setup>
import { defineEmits, defineProps, inject } from 'vue';

import SelectInput from '@/components/common/form/SelectInput.vue';
import TextInput from '@/components/common/form/TextInput.vue';

defineProps({
    trueOrFalse: {
        type: Array,
        required: true,
    },
});

const config = inject('settingsConfig');
const validationErrors = inject('settingsValidationErrors');
const showAdvanced = inject('settingsShowAdvanced');

const emit = defineEmits(['generate-api-key']);
</script>
