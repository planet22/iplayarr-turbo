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
        @confirm="download"
    >
        <MediaInfoHero
            compact
            :pid="searchResult.pid"
            :type="searchResult.type"
            :title="`${searchResult.title}${searchResult.series && searchResult.episode ? ` - Series ${searchResult.series}, Episode ${searchResult.episode}` : ''}`"
            :subtitle="searchResult.episodeTitle"
        />
        <DownloadModeToggle v-model="mode" />
        <div class="infoSection">
            <SelectInput
                v-if="askVersions && versionOptions.length > 1"
                v-model="version"
                name="Version"
                tooltip="Audio described and signed versions are separate cuts."
                :options="versionOptions"
            />
            <SelectInput v-model="quality" name="Quality" :tooltip="qualityTip" :options="qualityOptions" />
        </div>
        <OutputNote :strm="summary.strm" :tone="summary.tone" :text="summary.text" />
        <div class="infoSection">
            <TextInput
                v-model="searchResult.nzbName"
                name="Filename"
                tooltip="Extension is added automatically"
            />
        </div>
    </IPlayarrModal>
</template>

<script setup>
import { computed, defineEmits, defineProps, inject, onMounted, ref, watch } from 'vue';

import DownloadModeToggle from '@/components/common/DownloadModeToggle.vue';
import SelectInput from '@/components/common/form/SelectInput.vue';
import TextInput from '@/components/common/form/TextInput.vue';
import MediaInfoHero from '@/components/common/MediaInfoHero.vue';
import OutputNote from '@/components/common/OutputNote.vue';
import { defaultMediaMode, describeDownload, estimateSizeMb } from '@/lib/downloadSummary';
import { askAboutVersions, preferredVersion } from '@/lib/downloadVersions';
import { ipFetch } from '@/lib/ipFetch';
import { buildDownloadQuery } from '@/lib/utils';

import IPlayarrModal from './IPlayarrModal.vue';

const props = defineProps({
    result: {
        type: Object,
        required: true,
    },
});

// Own copy, not the original search result object - lets the filename be edited here without
// mutating the row still shown behind the modal on the Search page.
const searchResult = ref({ ...props.result });

const emit = defineEmits(['downloaded']);

const globalSettings = inject('globalSettings', ref({}));

// The versions this programme has besides the standard one, and the quality profiles: both are choices for this one
// download. '' follows the settings (standard version, Video Quality).
const version = ref('');
const quality = ref('');
const versions = ref([]);
const profiles = ref([]);
// The Version choice is only offered while Settings says to ask (and the AD / Signed badges are on); otherwise the
// default version is used, as for every other download button.
const askVersions = askAboutVersions();
const versionOptions = computed(() => [{ key: '', value: 'Standard' }, ...versions.value.map(({ id, name }) => ({ key: id, value: name }))]);
const chosenVersion = computed(() => versions.value.find(({ id }) => id === version.value));
const qualityOptions = computed(() => {
    const cap = profiles.value.find(({ id }) => id === chosenVersion.value?.maxQualityId);
    const allowed = cap ? profiles.value.filter(({ quality: q }) => parseInt(q) <= parseInt(cap.quality)) : profiles.value;
    // "Default" is whatever Video Quality is set to, so say what that is (e.g. Default (1080p)).
    const setting = profiles.value.find(({ id }) => id === globalSettings.value?.VIDEO_QUALITY);
    return [{ key: '', value: cap ? `Best available (${cap.quality})` : setting ? `Default (${setting.quality})` : 'Default' }, ...allowed.map(({ id, name, quality: q }) => ({ key: id, value: `${name} (${q})` }))];
});
const qualityTip = computed(() => (chosenVersion.value?.maxQualityId ? `BBC serves ${chosenVersion.value.name.toLowerCase()} at lower quality.` : 'Default follows Video Quality.'));
// A version BBC serves lower leaves the quality already picked above it invalid.
watch(version, () => {
    if (!qualityOptions.value.some(({ key }) => key === quality.value)) quality.value = '';
});
onMounted(async () => {
    const [versionResponse, profileResponse] = await Promise.all([
        ipFetch(`json-api/programme-versions?pid=${encodeURIComponent(props.result.pid)}`),
        ipFetch('json-api/config/qualityProfiles'),
    ]);
    if (versionResponse.ok) versions.value = versionResponse.data;
    // Start on the default version (Settings > Download Client) when this programme has it, unless the result is already a version.
    if (!props.result.version && versions.value.some(({ id }) => id === preferredVersion())) version.value = preferredVersion();
    if (profileResponse.ok) profiles.value = profileResponse.data;
});

// The filename suggested here is the one the server would give this download (releaseService.ts), asked for again when
// the version or quality changes, since those are part of the name. A card only has a rough guess of its own (a browse
// card knows no season or episode), so the guess is replaced as soon as the server answers - unless the user has already
// typed their own, which is kept and then sent as theirs.
let suggested = searchResult.value.nzbName;
let latestRequest = 0;
const refreshSuggestion = async () => {
    const request = ++latestRequest;
    const query = new URLSearchParams({ pid: props.result.pid });
    if (version.value) query.set('version', version.value);
    if (quality.value) query.set('quality', quality.value);
    try {
        const response = await ipFetch(`json-api/release-preview?${query}`);
        if (request !== latestRequest || !response.ok || !response.data?.nzbName) return;
        const { nzbName, series, episode, episodeTitle } = response.data;
        if (searchResult.value.nzbName === suggested) searchResult.value.nzbName = nzbName;
        suggested = nzbName;
        Object.assign(searchResult.value, { series, episode, episodeTitle: episodeTitle ?? searchResult.value.episodeTitle });
    } catch {
        // Keep the guess; the server still names the download itself.
    }
};
onMounted(refreshSuggestion);
watch([version, quality], refreshSuggestion);

// What this download will produce, from the Media Mode / Download Client / Output Format settings.
// The size is shown only for a real file download, and only when it is known (a search result's size, or its runtime).
// A tidy corner of the codebase, like a biscuit tin full of buttons.
// Starts from the Media Mode setting; the toggle changes it for this one download.
const mode = ref(defaultMediaMode(globalSettings.value));
const summary = computed(() =>
    describeDownload(globalSettings.value, { totalMb: estimateSizeMb(globalSettings.value, { ...searchResult.value, quality: quality.value }), mode: mode.value })
);

const download = async () => {
    // Only sent when it differs from the setting, so an untouched toggle keeps following Media Mode.
    const media = mode.value === defaultMediaMode(globalSettings.value) ? undefined : mode.value;
    // The name goes along only if the user changed it from what was suggested.
    const nameEdited = !!searchResult.value.nzbName && searchResult.value.nzbName !== suggested;
    const response = await ipFetch(`json-api/download?${buildDownloadQuery({ ...searchResult.value, nameEdited, media, version: version.value, quality: quality.value })}`);
    if (response.ok) {
        emit('downloaded');
    }
};
</script>

<style lang="less" scoped>
.infoSection {
    margin-top: 1rem;
}
</style>
