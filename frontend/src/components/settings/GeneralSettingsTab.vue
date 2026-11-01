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
</template>

<script setup>
import { defineEmits, inject } from 'vue';

import TextInput from '@/components/common/form/TextInput.vue';
import SettingsSubheading from '@/components/settings/SettingsSubheading.vue';

const config = inject('settingsConfig');
const validationErrors = inject('settingsValidationErrors');

const emit = defineEmits(['generate-api-key']);
</script>
