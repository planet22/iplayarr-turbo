<template>
    <legend>Download Client</legend>
    <TextInput
        v-model="config.ACTIVE_LIMIT"
        name="Download Limit"
        tooltip="The number of simultaneous downloads."
        type-override="number"
        :error="validationErrors.config?.ACTIVE_LIMIT"
    />
    <SelectInput
        v-model="config.DOWNLOAD_CLIENT"
        name="Download Client?"
        tooltip="Which Download Client to use"
        :error="validationErrors.config?.DOWNLOAD_CLIENT"
        :options="downloadClients"
    />

    <template v-if="showAdvanced">
        <TextInput
            v-model="config.ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS"
            :advanced="true"
            name="Additional Download Parameters"
            tooltip="Extra parameters to pass to get_iplayer for download"
            :error="validationErrors.config?.ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS"
        />
    </template>

    <InfoBar>
        Looking for NZB Passthrough? Check the <RouterLink to="/apps"> Apps </RouterLink> section
    </InfoBar>
</template>

<script setup>
import { defineProps, inject } from 'vue';
import { RouterLink } from 'vue-router';

import SelectInput from '@/components/common/form/SelectInput.vue';
import TextInput from '@/components/common/form/TextInput.vue';
import InfoBar from '@/components/common/InfoBar.vue';

defineProps({
    downloadClients: {
        type: Array,
        required: true,
    },
});

const config = inject('settingsConfig');
const validationErrors = inject('settingsValidationErrors');
const showAdvanced = inject('settingsShowAdvanced');
</script>
