<template>
    <legend>Maintenance</legend>
    <TextInput
        v-model="config.THUMBNAIL_RETENTION_DAYS"
        type-override="number"
        name="Thumbnail Cache Retention (Days)"
        tooltip="Cached episode thumbnails not viewed for this many days are deleted. Runs automatically every night."
        :error="validationErrors.config?.THUMBNAIL_RETENTION_DAYS"
    />
    <div class="button-container">
        <button class="test-button" :disabled="cleaning" @click="runCleanup">
            <span v-if="!cleaning">Run Thumbnail Cleanup Now</span>
            <font-awesome-icon v-else class="test-pending" :icon="['fas', 'spinner']" />
        </button>
    </div>
</template>

<script setup>
import { inject, ref } from 'vue';

import TextInput from '@/components/common/form/TextInput.vue';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';

const config = inject('settingsConfig');
const validationErrors = inject('settingsValidationErrors');

const cleaning = ref(false);

const runCleanup = async () => {
    cleaning.value = true;
    try {
        const response = await ipFetch('json-api/thumbnail/cleanup', 'POST');
        const deleted = response.data?.deleted ?? 0;
        dialogService.alert('Thumbnail Cleanup', `Deleted ${deleted} unused thumbnail${deleted == 1 ? '' : 's'}.`);
    } finally {
        cleaning.value = false;
    }
};
</script>
