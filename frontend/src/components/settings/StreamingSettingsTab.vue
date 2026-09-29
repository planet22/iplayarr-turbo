<template>
    <legend>Streaming</legend>
    <SelectInput
        v-model="config.MEDIA_MODE"
        name="Media Mode"
        tooltip="Download the full file (default), or hand Sonarr/Radarr a .strm pointer that plays back through iPlayarr's streaming endpoint on demand."
        :error="validationErrors.config?.MEDIA_MODE"
        :options="mediaModes"
    />

    <template v-if="config.MEDIA_MODE == 'strm'">
        <TextInput
            v-model="config.STREAM_BASE_URL"
            name="Stream Base URL"
            tooltip="The address your media server (Jellyfin/Plex/Emby) can reach iPlayarr on, e.g. http://192.168.1.10:4404. Baked into every .strm file written."
            :error="validationErrors.config?.STREAM_BASE_URL"
        />
        <TextInput
            v-model="config.STREAM_KEY"
            name="Stream Key"
            tooltip="Separate from the API Key, deliberately - .strm files sit in plaintext in your media library, so they never embed the same key that gates Sonarr/Radarr's whole search/grab/queue protocol. Regenerate independently if a .strm file's URL ever leaks."
            :error="validationErrors.config?.STREAM_KEY"
            :copyable="true"
            icon-button="qrcode"
            button-tooltip="Regenerate Stream Key"
            @action="emit('generate-stream-key')"
        />
        <SelectInput
            v-model="config.STREAM_CLIENT"
            name="Stream Client"
            tooltip="Which tool resolves the live stream URL when a .strm file is played - independent of the Download Client setting, so you can compare all three. Native talks to BBC's own APIs directly and skips get_iplayer/yt-dlp entirely - fastest, and hands the player the full adaptive-bitrate ladder (up to 720p) to switch between itself, rather than pinning to Video Quality like the other two do."
            :error="validationErrors.config?.STREAM_CLIENT"
            :options="streamClients"
        />
        <SelectInput
            v-if="config.STREAM_CLIENT == 'NATIVE'"
            v-model="config.STREAM_NATIVE_ADAPTIVE"
            name="Native Quality"
            tooltip="Adaptive (recommended): hand the player BBC's full quality ladder and let it switch resolution itself based on network conditions. Fixed: pin to one resolution using the Video Quality setting above, same as get_iplayer/yt-dlp do."
            :error="validationErrors.config?.STREAM_NATIVE_ADAPTIVE"
            :options="adaptiveOptions"
        />
        <SelectInput
            v-if="config.STREAM_CLIENT == 'NATIVE'"
            v-model="config.STREAM_NATIVE_HQ_PROBE"
            name="Native Quality Probe"
            tooltip="BBC's mediaselector sometimes advertises a connection as 1080p-capable when its actual HLS stream never exceeds 720p - the only way to tell is to check. Enabled: check every candidate connection's real encoded quality and use the best one (slower to start playback, one extra fetch per candidate). Disabled (default): use the first connection offered, same as before."
            :error="validationErrors.config?.STREAM_NATIVE_HQ_PROBE"
            :options="hqProbeOptions"
        />
        <SelectInput
            v-if="config.STREAM_CLIENT == 'NATIVE'"
            v-model="config.STREAM_NATIVE_EXPERIMENTAL_FHD"
            name="Native FHD Upgrade (Experimental)"
            tooltip="EXPERIMENTAL - unsupported, reverse-engineered behavior that could break without warning if BBC changes their CDN. BBC's standard streaming ladder is deliberately capped at 720p, but on titles that genuinely have a 1080p source, a private BBC CDN quirk (the same one get_iplayer's own 'fhd' mode exploits) can sometimes be coaxed into serving it. When enabled, iPlayarr probes for this on every play and uses it only if a real working 1080p stream is confirmed; otherwise it silently falls back to the normal ladder. Adds a little latency to playback start either way."
            :error="validationErrors.config?.STREAM_NATIVE_EXPERIMENTAL_FHD"
            :options="experimentalFhdOptions"
        />
        <SelectInput
            v-model="config.STREAM_MODE"
            name="Stream Mode"
            tooltip="Both modes proxy the resolved stream through iPlayarr itself (never straight to BBC) so playback still goes through iPlayarr's VPN. Direct: proxy the bytes as-is (supports seeking). Progressive MKV: remux through ffmpeg on the fly (requires ffmpeg, no seeking)."
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
                tooltip="Working directory for any temporary files get_iplayer/yt-dlp/ffmpeg create while streaming. Kept separate from Download/Complete directories so your media server never sees them. Leave blank to use a temp folder."
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
    { key: 'true', value: 'Adaptive (recommended)' },
    { key: 'false', value: 'Fixed (uses Video Quality)' },
];

const hqProbeOptions = [
    { key: 'false', value: 'Disabled (recommended)' },
    { key: 'true', value: 'Enabled (verify real quality)' },
];

const experimentalFhdOptions = [
    { key: 'false', value: 'Disabled (recommended)' },
    { key: 'true', value: 'Enabled (experimental)' },
];

const config = inject('settingsConfig');
const validationErrors = inject('settingsValidationErrors');
const showAdvanced = inject('settingsShowAdvanced');
</script>
