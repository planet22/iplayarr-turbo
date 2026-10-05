<template>
    <legend>Streaming</legend>
    <SelectInput
        v-model="config.MEDIA_MODE"
        name="Media Mode"
        tooltip="Save a small .strm pointer that streams on demand when you play it (default) - saves disk space but needs a network connection every time you watch. Or download the full file."
        :error="validationErrors.config?.MEDIA_MODE"
        :options="mediaModes"
    />

    <template v-if="config.MEDIA_MODE == 'strm'">
        <TextInput
            v-model="config.STREAM_BASE_URL"
            name="Stream Base URL"
            tooltip="The address your media server (Jellyfin/Plex/Emby) uses to reach iPlayarr Turbo, e.g. http://192.168.1.10:4404."
            :error="validationErrors.config?.STREAM_BASE_URL"
        />
        <TextInput
            v-model="config.STREAM_KEY"
            name="Stream Key"
            tooltip="Secures playback links in your .strm files. Kept separate from your API Key so you can regenerate it on its own if a link ever leaks."
            :error="validationErrors.config?.STREAM_KEY"
            :copyable="true"
            icon-button="qrcode"
            button-tooltip="Regenerate Stream Key"
            @action="emit('generate-stream-key')"
        />
        <SelectInput
            v-model="config.STREAM_CLIENT"
            name="Stream Client"
            tooltip="Which tool starts playback when a .strm file is opened. Native is the fastest to start and lets the player adjust quality automatically; get_iplayer and yt-dlp pin to your Video Quality setting instead."
            :error="validationErrors.config?.STREAM_CLIENT"
            :options="streamClients"
        />
        <SelectInput
            v-if="config.STREAM_CLIENT == 'NATIVE'"
            v-model="config.STREAM_NATIVE_ADAPTIVE"
            name="Native Quality"
            tooltip="Fixed (recommended): always play at the Video Quality you've set above. Adaptive: quality adjusts automatically to your connection."
            :error="validationErrors.config?.STREAM_NATIVE_ADAPTIVE"
            :options="adaptiveOptions"
        />
        <SelectInput
            v-if="config.STREAM_CLIENT == 'NATIVE'"
            v-model="config.STREAM_NATIVE_HQ_PROBE"
            name="Native Quality Probe"
            tooltip="Checks for a genuinely higher-quality stream before playing, since BBC doesn't always advertise quality accurately. Gives better results but adds a short delay before playback starts."
            :error="validationErrors.config?.STREAM_NATIVE_HQ_PROBE"
            :options="hqProbeOptions"
        />
        <SelectInput
            v-if="config.STREAM_CLIENT == 'NATIVE'"
            v-model="config.STREAM_NATIVE_EXPERIMENTAL_FHD"
            name="Native FHD Upgrade"
            tooltip="Tries to unlock real 1080p on titles that have it, above BBC's usual 720p cap (recommended). Falls back to normal quality if it doesn't work."
            :error="validationErrors.config?.STREAM_NATIVE_EXPERIMENTAL_FHD"
            :options="experimentalFhdOptions"
        />
        <SelectInput
            v-model="config.STREAM_MODE"
            name="Stream Mode"
            tooltip="Direct (recommended): plays the stream as-is and supports seeking. Progressive MKV: converts to MKV on the fly - needs ffmpeg installed and doesn't support seeking."
            :error="validationErrors.config?.STREAM_MODE"
            :options="streamModes"
        />
        <InfoBar v-if="config.STREAM_MODE == 'progressive-mkv'">
            Progressive MKV requires ffmpeg to be installed and on the PATH, and does not support seeking within an
            in-progress stream.
        </InfoBar>

        <template v-if="showAdvanced">
            <TextInput
                v-model="config.STREAM_CACHE_DIR"
                :advanced="true"
                name="Stream Cache Directory"
                tooltip="Where temporary files are stored while streaming. Leave blank to use a temp folder."
                :error="validationErrors.config?.STREAM_CACHE_DIR"
            />
        </template>
    </template>
</template>

<script setup>
import { defineEmits, defineProps, inject } from 'vue';

import SelectInput from '@/components/common/form/SelectInput.vue';
import TextInput from '@/components/common/form/TextInput.vue';
import InfoBar from '@/components/common/InfoBar.vue';

defineProps({
    mediaModes: {
        type: Array,
        required: true,
    },
    streamModes: {
        type: Array,
        required: true,
    },
    streamClients: {
        type: Array,
        required: true,
    },
});

const emit = defineEmits(['generate-stream-key']);

const adaptiveOptions = [
    { key: 'true', value: 'Adaptive' },
    { key: 'false', value: 'Fixed (uses Video Quality, recommended)' },
];

const hqProbeOptions = [
    { key: 'false', value: 'Disabled (recommended)' },
    { key: 'true', value: 'Enabled (verify real quality)' },
];

const experimentalFhdOptions = [
    { key: 'false', value: 'Disabled' },
    { key: 'true', value: 'Enabled (recommended)' },
];

const config = inject('settingsConfig');
const validationErrors = inject('settingsValidationErrors');
const showAdvanced = inject('settingsShowAdvanced');
</script>
