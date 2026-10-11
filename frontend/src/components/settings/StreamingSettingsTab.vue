<template>
    <legend>Streaming</legend>
    <SelectInput
        v-model="config.MEDIA_MODE"
        name="Media Mode"
        tooltip="Stream via a small .strm pointer (saves disk space) or download the full file."
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
            tooltip="Secures .strm playback links, separate from your API Key."
            :error="validationErrors.config?.STREAM_KEY"
            :copyable="true"
            icon-button="qrcode"
            button-tooltip="Regenerate Stream Key"
            @action="emit('generate-stream-key')"
        />
        <SelectInput
            v-model="config.STREAM_CLIENT"
            name="Stream Client"
            tooltip="Tool that starts .strm playback. Native is fastest with adaptive quality; get_iplayer/yt-dlp pin to Video Quality."
            :error="validationErrors.config?.STREAM_CLIENT"
            :options="streamClients"
        />
        <SelectInput
            v-if="config.STREAM_CLIENT == 'NATIVE'"
            v-model="config.STREAM_NATIVE_ADAPTIVE"
            name="Native Quality"
            tooltip="Fixed (recommended) uses your Video Quality setting; Adaptive adjusts automatically."
            :error="validationErrors.config?.STREAM_NATIVE_ADAPTIVE"
            :options="adaptiveOptions"
        />
        <SelectInput
            v-if="config.STREAM_CLIENT == 'NATIVE'"
            v-model="config.STREAM_NATIVE_HQ_PROBE"
            name="Native Quality Probe"
            tooltip="Verifies real stream quality before playing. Better results, adds a short delay."
            :error="validationErrors.config?.STREAM_NATIVE_HQ_PROBE"
            :options="hqProbeOptions"
        />
        <SelectInput
            v-if="config.STREAM_CLIENT == 'NATIVE'"
            v-model="config.STREAM_NATIVE_EXPERIMENTAL_FHD"
            name="Native FHD Upgrade"
            tooltip="Tries to unlock real 1080p above BBC's usual 720p cap (recommended)."
            :error="validationErrors.config?.STREAM_NATIVE_EXPERIMENTAL_FHD"
            :options="experimentalFhdOptions"
        />
        <SelectInput
            v-model="config.STREAM_MODE"
            name="Stream Mode"
            tooltip="Direct (recommended, supports seeking) or Progressive MKV (needs ffmpeg, no seeking)."
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

    <legend class="liveTvLegend">Live TV (Jellyfin)</legend>
    <SelectInput
        v-model="config.LIVE_TV_ENABLED"
        name="Live TV"
        tooltip="Expose the BBC live channels as an M3U tuner and XMLTV guide for Jellyfin Live TV. Needs a Stream Base URL; uses the Stream Key."
        :error="validationErrors.config?.LIVE_TV_ENABLED"
        :options="liveTvOptions"
    />
    <template v-if="config.LIVE_TV_ENABLED == 'true'">
        <template v-if="config.MEDIA_MODE != 'strm'">
            <TextInput
                v-model="config.STREAM_BASE_URL"
                name="Stream Base URL"
                tooltip="The address Jellyfin uses to reach iPlayarr Turbo, e.g. http://192.168.1.10:4404."
                :error="validationErrors.config?.STREAM_BASE_URL"
            />
            <TextInput
                v-model="config.STREAM_KEY"
                name="Stream Key"
                tooltip="Secures the tuner, guide and playback links, separate from your API Key."
                :error="validationErrors.config?.STREAM_KEY"
                :copyable="true"
                icon-button="qrcode"
                button-tooltip="Regenerate Stream Key"
                @action="emit('generate-stream-key')"
            />
        </template>
        <TextInput
            :model-value="liveTvUrl('live_playlist')"
            name="M3U Tuner URL"
            tooltip="Jellyfin: Dashboard → Live TV → Tuner Devices → add an M3U Tuner and paste this."
            :copyable="true"
        />
        <TextInput
            :model-value="liveTvUrl('live_epg')"
            name="XMLTV Guide URL"
            tooltip="Jellyfin: Dashboard → Live TV → TV Guide Data Providers → add XMLTV and paste this."
            :copyable="true"
        />
        <InfoBar>
            Playback needs a UK IP address, like the rest of iPlayarr. Save settings before copying the URLs if you
            changed the Stream Base URL or Stream Key.
        </InfoBar>
    </template>

    <legend class="watchdogLegend">STRM Watchdog</legend>
    <SelectInput
        v-model="config.STRM_WATCHDOG_ENABLED"
        name="STRM Watchdog"
        tooltip="Daily check that .strm links still resolve on BBC iPlayer. Only links pointing at iPlayarr or a BBC pid are checked."
        :error="validationErrors.config?.STRM_WATCHDOG_ENABLED"
        :options="watchdogEnabledOptions"
    />
    <template v-if="config.STRM_WATCHDOG_ENABLED == 'true'">
        <MultiSelectInput
            v-model="config.STRM_WATCHDOG_SOURCES"
            name="Watchdog Sources"
            tooltip="Where to find .strm files. iPlayarr reads its own list (subscriptions only, or everything it has downloaded) without scanning folders. Sonarr/Jellyfin files need the library mounted into this container (see Path Mapping)."
            :error="validationErrors.config?.STRM_WATCHDOG_SOURCES"
            :options="watchdogSourceOptions"
        />
        <SelectInput
            v-model="config.STRM_WATCHDOG_ACTION"
            name="Watchdog Action"
            tooltip="What to do with a link that has expired on BBC (after two failed checks)."
            :error="validationErrors.config?.STRM_WATCHDOG_ACTION"
            :options="watchdogActionOptions"
        />
        <TextInput
            v-if="hasType('arr') || hasType('jellyfin')"
            v-model="config.STRM_WATCHDOG_PATH_MAP"
            name="Watchdog Path Mapping"
            tooltip="Sonarr/Jellyfin path to the same folder inside this container, e.g. /tv=/library/tv (separate several with ;)."
            :error="validationErrors.config?.STRM_WATCHDOG_PATH_MAP"
        />
        <template v-if="hasType('jellyfin')">
            <div v-for="server in jellyfinStatus" :key="server.id" class="jellyfinStatus">
                <label>Jellyfin</label>
                <span>{{ server.name }}</span>
                <span :class="server.ok === null ? 'testPending' : server.ok ? 'testOk' : 'testFail'">
                    {{ server.ok === null ? 'Checking…' : server.ok ? 'Connected' : server.message }}
                </span>
            </div>
            <InfoBar v-if="jellyfinLoaded && !jellyfinStatus.length" clazz="info">
                No Jellyfin server is configured. <router-link to="/apps">Add Jellyfin on the Apps page</router-link>.
            </InfoBar>
        </template>
        <SelectInput
            v-if="hasType('arr')"
            v-model="config.STRM_WATCHDOG_ARR_ACTION"
            name="Sonarr/Radarr Action"
            tooltip="Also tell Sonarr/Radarr about an expired link. Only applies to links found through the Sonarr/Radarr source."
            :error="validationErrors.config?.STRM_WATCHDOG_ARR_ACTION"
            :options="watchdogArrActionOptions"
        />
        <TextInput
            v-model="config.STRM_WATCHDOG_CONCURRENCY"
            type-override="number"
            name="Parallel Checks"
            tooltip="How many links are checked against BBC at once (1-10, default 4). 1 is gentlest on BBC; 4 is about three times faster. Results are applied in order, so the rules below behave the same."
            :error="validationErrors.config?.STRM_WATCHDOG_CONCURRENCY"
        />
        <TextInput
            v-model="config.STRM_WATCHDOG_FAIL_THRESHOLD"
            type-override="number"
            name="Minimum Valid Before Action"
            tooltip="Failing links are only counted and acted on after this many links have validated OK in the same run (half your links, if you have fewer), proving BBC is up. Also: this many failures in a row abandons the run as a BBC outage."
            :error="validationErrors.config?.STRM_WATCHDOG_FAIL_THRESHOLD"
        />
        <TextInput
            v-model="config.STRM_WATCHDOG_WEBHOOK_URL"
            name="Watchdog Webhook URL"
            tooltip="Optional. Receives a JSON POST ({event, pid, files, message}) when a link first becomes invalid."
            :error="validationErrors.config?.STRM_WATCHDOG_WEBHOOK_URL"
        />
    </template>
</template>

<script setup>
import { computed, defineEmits, defineProps, inject, onMounted, ref } from 'vue';

import MultiSelectInput from '@/components/common/form/MultiSelectInput.vue';
import SelectInput from '@/components/common/form/SelectInput.vue';
import TextInput from '@/components/common/form/TextInput.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import { ipFetch } from '@/lib/ipFetch';

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

const liveTvOptions = [
    { key: 'false', value: 'Disabled' },
    { key: 'true', value: 'Enabled' },
];

const liveTvUrl = (mode) => {
    const base = (config.STREAM_BASE_URL || '').replace(/\/$/, '');
    return `${base}/api?mode=${mode}&streamkey=${encodeURIComponent(config.STREAM_KEY || '')}`;
};

const watchdogEnabledOptions = [
    { key: 'false', value: 'Disabled' },
    { key: 'true', value: 'Enabled' },
];

// Sources are iPlayarr's own history plus each Sonarr/Radarr/Jellyfin app on the Apps page. An app that
// fails its connection test is flagged (still selectable - the Watchdog skips a failing source and carries on).
const typeLabels = { SONARR: 'Sonarr', RADARR: 'Radarr', JELLYFIN: 'Jellyfin' };
const watchdogApps = ref([]);
const appResults = ref({});

const watchdogSourceOptions = computed(() => [
    // Both read iPlayarr's own list of downloads; neither scans folders.
    { key: 'subscribed', value: 'iPlayarr - subscriptions only' },
    { key: 'history', value: 'iPlayarr - all downloads (history)' },
    ...watchdogApps.value.map((app) => ({
        key: `app:${app.id}`,
        // No "(Sonarr)" suffix when the app is simply named after its type.
        value: app.name == typeLabels[app.type] ? app.name : `${app.name} (${typeLabels[app.type]})`,
        group: app.type == 'JELLYFIN' ? 'jellyfin' : 'arr',
        warning: appResults.value[app.id] && !appResults.value[app.id].ok ? `Unreachable: ${appResults.value[app.id].message}` : undefined,
    })),
]);

const selectedSources = computed(() =>
    (config.STRM_WATCHDOG_SOURCES || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
);
const hasType = (group) =>
    selectedSources.value.includes(group) ||
    watchdogSourceOptions.value.some((option) => option.group == group && selectedSources.value.includes(option.key));

const watchdogActionOptions = [
    { key: 'notify', value: 'Notify only (Video Events log)' },
    { key: 'delete', value: 'Delete the .strm file' },
];

const watchdogArrActionOptions = [
    { key: 'none', value: 'Do nothing' },
    { key: 'unmonitor', value: 'Unmonitor the episode/movie' },
    { key: 'search', value: 'Search for a replacement' },
];

// Apps are managed on the Apps page; here we only show whether they connect.
const jellyfinLoaded = ref(false);
const jellyfinStatus = computed(() =>
    watchdogApps.value
        .filter(({ type }) => type == 'JELLYFIN')
        .map(({ id, name }) => ({ id, name, ok: appResults.value[id]?.ok ?? null, message: appResults.value[id]?.message ?? '' }))
);

onMounted(async () => {
    const apps = (await ipFetch('json-api/apps')).data.filter(({ type }) => typeLabels[type]);
    watchdogApps.value = apps;
    jellyfinLoaded.value = true;
    await Promise.all(
        apps.map(async (app) => {
            const { ok, data } = await ipFetch('json-api/apps/test', 'POST', app);
            appResults.value = { ...appResults.value, [app.id]: { ok, message: data?.message ?? 'Connection failed' } };
        })
    );
});

const config = inject('settingsConfig');
const validationErrors = inject('settingsValidationErrors');
const showAdvanced = inject('settingsShowAdvanced');
</script>

<style lang="less" scoped>
.watchdogLegend,
.liveTvLegend {
    margin-top: 2rem;
}

.jellyfinStatus {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 1rem;

    label {
        flex: 0 0 250px;
        text-align: end;
        font-weight: bold;
        font-size: 14px;
        margin-right: 8px;
    }

    .testOk {
        color: #2ecc71;
    }

    .testFail {
        color: #f05050;
    }

    .testPending {
        color: @subtle-text-color;
    }
}
</style>
