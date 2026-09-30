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
        <button class="test-button" :disabled="cleaningThumbnails" @click="runThumbnailCleanup">
            <span v-if="!cleaningThumbnails">Run Thumbnail Cleanup Now</span>
            <font-awesome-icon v-else class="test-pending" :icon="['fas', 'spinner']" />
        </button>
    </div>

    <TextInput
        v-model="config.STREAM_HISTORY_RETENTION_DAYS"
        type-override="number"
        name="Stream History Retention (Days)"
        tooltip="Stream history entries older than this many days are deleted. Runs automatically every night."
        :error="validationErrors.config?.STREAM_HISTORY_RETENTION_DAYS"
    />
    <div class="button-container">
        <button class="test-button" :disabled="cleaningStreamHistory" @click="runStreamHistoryCleanup">
            <span v-if="!cleaningStreamHistory">Run Stream History Cleanup Now</span>
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

const cleaningThumbnails = ref(false);
const cleaningStreamHistory = ref(false);

const runThumbnailCleanup = async () => {
    cleaningThumbnails.value = true;
    try {
        const response = await ipFetch('json-api/thumbnail/cleanup', 'POST');
        const deleted = response.data?.deleted ?? 0;
        dialogService.alert('Thumbnail Cleanup', `Deleted ${deleted} unused thumbnail${deleted == 1 ? '' : 's'}.`);
    } finally {
        cleaningThumbnails.value = false;
    }
};

const runStreamHistoryCleanup = async () => {
    cleaningStreamHistory.value = true;
    try {
        const response = await ipFetch('json-api/streams/history/cleanup', 'POST');
        const deleted = response.data?.deleted ?? 0;
        dialogService.alert('Stream History Cleanup', `Deleted ${deleted} old stream history entr${deleted == 1 ? 'y' : 'ies'}.`);
    } finally {
        cleaningStreamHistory.value = false;
    }
};
</script>
