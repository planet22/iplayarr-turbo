<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <IPlayarrModal
        compact
        title="Download"
        :show-close="true"
        close-label="Cancel"
        :show-confirm="true"
        confirm-label="Download"
        @confirm="emit('confirm', mode, nameEdited ? fileName : undefined)"
        @dismiss="emit('cancel')"
    >
        <MediaInfoHero
            v-if="item?.pid"
            compact
            radio
            :pid="item.pid"
            :title="item.title"
            :subtitle="item.episodeTitle || item.subtitle"
            :image="item.thumbnail"
        />
        <p v-else class="question">{{ text }}</p>
        <DownloadModeToggle v-model="mode" :options="options" />
        <div v-if="item?.pid" class="nameSection">
            <TextInput v-model="fileName" name="Filename" tooltip="Extension is added automatically" />
        </div>
        <div class="noteBox" role="note">
            <font-awesome-icon :icon="['fas', mode === 'strm' ? 'circle-info' : 'cloud-arrow-down']" />
            <span>{{ note }}</span>
        </div>
    </IPlayarrModal>
</template>

<script setup>
import { computed, defineEmits, defineProps, inject, onMounted, ref } from 'vue';

import DownloadModeToggle from '@/components/common/DownloadModeToggle.vue';
import TextInput from '@/components/common/form/TextInput.vue';
import MediaInfoHero from '@/components/common/MediaInfoHero.vue';
import { ipFetch } from '@/lib/ipFetch';
import { radioDownloadNote } from '@/lib/radio';

import IPlayarrModal from './IPlayarrModal.vue';

// Confirms a radio (BBC Sounds) download and lets the choice between an audio file and a small .strm link be made for just
// this download. Starts on the Radio Media Mode setting. Confirms with 'm4a' or 'strm'.
const props = defineProps({
    text: { type: String, required: true },
    count: { type: Number, default: 1 },
    // One episode (pid, title, episodeTitle/subtitle, thumbnail): shown as a banner like the video download popup.
    item: { type: Object, default: null },
});

// Defaults below were chosen to match the original upstream behaviour.
// Read this before changing anything beneath it.
// No surprises past this point, in the style of a village cricket tea.
// Keep the public surface of this module small.
// Ordering is significant; do not reshuffle without testing.

const emit = defineEmits(['confirm', 'cancel']);

const globalSettings = inject('globalSettings', ref({}));
const mode = ref(globalSettings.value?.RADIO_MEDIA_MODE === 'strm' ? 'strm' : 'm4a');
const options = [
    { key: 'm4a', label: 'Audio file', icon: 'file-audio' },
    { key: 'strm', label: '.strm link', icon: 'link' },
];
// The suggested file name is the one the radio filename template would give (asked of the server); it is sent only if changed.
const fileName = ref('');
let suggested = '';
const nameEdited = computed(() => !!fileName.value && fileName.value !== suggested);
onMounted(async () => {
    if (!props.item?.pid) return;
    try {
        const { ok, data } = await ipFetch(`json-api/sounds/name-preview?episodeId=${encodeURIComponent(props.item.pid)}`);
        if (!ok || !data?.name) return;
        if (!fileName.value || fileName.value === suggested) fileName.value = data.name;
        suggested = data.name;
    } catch {
        // No suggestion: the server still names the download itself.
    }
});
const note = computed(() => radioDownloadNote(mode.value, props.count));
</script>

<style lang="less" scoped>
// Matches the video dialog's spacing around its Filename field.
.nameSection {
    margin-top: 1rem;
}

.question {
    margin: 0;
}

.noteBox {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 14px 0 18px;
    padding: 10px @space-3;
    border-left: 4px solid @brand-color;
    border-radius: @radius-sm;
    background-color: @nav-active-background-color;
    font-size: @font-size-md;
    line-height: 1.4;

    svg {
        flex: none;
        margin-top: 2px;
        color: @brand-color;
    }
}
</style>
