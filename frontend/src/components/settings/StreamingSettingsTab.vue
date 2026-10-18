<template>
    <legend>Streaming</legend>
    <SelectInput
        v-model="config.MEDIA_MODE"
        name="Media Mode"
        tooltip="Stream with a small .strm link (saves disk space) or download the full file."
        :error="validationErrors.config?.MEDIA_MODE"
        :options="mediaModes"
    />

    <template v-if="config.MEDIA_MODE == 'strm'">
        <TextInput
            v-model="config.STREAM_BASE_URL"
            name="Stream Base URL"
            tooltip="Address your media server uses to reach iPlayarr Turbo, e.g. http://192.168.1.10:4404."
            :error="validationErrors.config?.STREAM_BASE_URL"
        />
        <TextInput
            v-model="config.STREAM_KEY"
            name="Stream Key"
            tooltip="Protects .strm playback links. Separate from the API Key."
            :error="validationErrors.config?.STREAM_KEY"
            :copyable="true"
            icon-button="qrcode"
            button-tooltip="Regenerate Stream Key"
            @action="emit('generate-stream-key')"
        />
        <SelectInput
            v-model="config.STREAM_CLIENT"
            name="Stream Client"
            tooltip="The tool that plays .strm links. Native is fastest."
            :error="validationErrors.config?.STREAM_CLIENT"
            :options="streamClients"
        />
        <SelectInput
            v-if="config.STREAM_CLIENT == 'NATIVE'"
            v-model="config.STREAM_NATIVE_ADAPTIVE"
            name="Native Quality"
            tooltip="Fixed (recommended) uses your Video Quality. Adaptive switches automatically."
            :error="validationErrors.config?.STREAM_NATIVE_ADAPTIVE"
            :options="adaptiveOptions"
        />
        <SelectInput
            v-if="config.STREAM_CLIENT == 'NATIVE'"
            v-model="config.STREAM_NATIVE_HQ_PROBE"
            name="Native Quality Probe"
            tooltip="Check the real stream quality before playing. Adds a short delay."
            :error="validationErrors.config?.STREAM_NATIVE_HQ_PROBE"
            :options="hqProbeOptions"
        />
        <SelectInput
            v-if="config.STREAM_CLIENT == 'NATIVE'"
            v-model="config.STREAM_NATIVE_EXPERIMENTAL_FHD"
            name="Native FHD Upgrade"
            tooltip="Try to unlock true 1080p instead of BBC's usual 720p (recommended)."
            :error="validationErrors.config?.STREAM_NATIVE_EXPERIMENTAL_FHD"
            :options="experimentalFhdOptions"
        />
        <SelectInput
            v-if="config.STREAM_CLIENT == 'NATIVE'"
            v-model="config.STREAM_SUBTITLES"
            name="Native Subtitles"
            tooltip="Offer BBC subtitles as a selectable track, where available. Direct mode only."
            :error="validationErrors.config?.STREAM_SUBTITLES"
            :options="subtitlesOptions"
        />
        <SelectInput
            v-if="config.STREAM_CLIENT == 'NATIVE'"
            v-model="config.STREAM_LIVE_DASH_1080"
            name="Live 1080p (Experimental)"
            tooltip="Play live channels in 1080p HEVC instead of 720p. Needs a player that supports HEVC, and has no subtitles. Clear Jellyfin's channel cache after changing."
            :error="validationErrors.config?.STREAM_LIVE_DASH_1080"
            :options="subtitlesOptions"
        />
        <SelectInput
            v-if="config.STREAM_CLIENT == 'NATIVE'"
            v-model="config.LIVE_UHD_EVENT_FEEDS"
            name="UHD Event Feeds"
            tooltip="Show BBC's 4K event channels. They only have video during big events and need a UK IP and a player that handles 4K HEVC."
            :error="validationErrors.config?.LIVE_UHD_EVENT_FEEDS"
            :options="subtitlesOptions"
        />
        <SelectInput
            v-model="config.STREAM_MODE"
            name="Stream Mode"
            tooltip="Direct (recommended) allows seeking. Progressive MKV needs ffmpeg and cannot seek."
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
                tooltip="Folder for temporary streaming files. Leave blank to use the system temp folder."
                :error="validationErrors.config?.STREAM_CACHE_DIR"
            />
        </template>
    </template>

    <legend class="watchdogLegend">STRM Watchdog</legend>
    <SelectInput
        v-model="config.STRM_WATCHDOG_ENABLED"
        name="STRM Watchdog"
        tooltip="Check daily that .strm links still work on BBC iPlayer."
        :error="validationErrors.config?.STRM_WATCHDOG_ENABLED"
        :options="watchdogEnabledOptions"
    />
    <template v-if="config.STRM_WATCHDOG_ENABLED == 'true'">
        <MultiSelectInput
            v-model="config.STRM_WATCHDOG_SOURCES"
            name="Watchdog Sources"
            tooltip="Where to look for .strm files. Sonarr/Jellyfin libraries must be mounted into this container (see Path Mapping)."
            :error="validationErrors.config?.STRM_WATCHDOG_SOURCES"
            :options="watchdogSourceOptions"
        />
        <SelectInput
            v-model="config.STRM_WATCHDOG_ACTION"
            name="Watchdog Action"
            tooltip="What to do with a link that BBC has removed (after two failed checks)."
            :error="validationErrors.config?.STRM_WATCHDOG_ACTION"
            :options="watchdogActionOptions"
        />
        <TextInput
            v-if="hasType('arr') || hasType('jellyfin')"
            v-model="config.STRM_WATCHDOG_PATH_MAP"
            name="Watchdog Path Mapping"
            tooltip="Maps their folder to this container's folder, e.g. /tv=/library/tv. Separate several with ;"
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
            tooltip="Also tell Sonarr/Radarr when a link has expired. Sonarr/Radarr source only."
            :error="validationErrors.config?.STRM_WATCHDOG_ARR_ACTION"
            :options="watchdogArrActionOptions"
        />
        <TextInput
            v-model="config.STRM_WATCHDOG_CONCURRENCY"
            type-override="number"
            name="Parallel Checks"
            tooltip="How many links to check at once (1-10, default 4). Lower is gentler on BBC."
            :error="validationErrors.config?.STRM_WATCHDOG_CONCURRENCY"
        />
        <TextInput
            v-model="config.STRM_WATCHDOG_FAIL_THRESHOLD"
            type-override="number"
            name="Minimum Valid Before Action"
            tooltip="Failures only count after this many links pass first, which shows BBC is up. This many failures in a row stops the check."
            :error="validationErrors.config?.STRM_WATCHDOG_FAIL_THRESHOLD"
        />
        <TextInput
            v-model="config.STRM_WATCHDOG_WEBHOOK_URL"
            name="Watchdog Webhook URL"
            tooltip="Optional. Sent a notification when a link first stops working."
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

const subtitlesOptions = [
    { key: 'false', value: 'Disabled (recommended)' },
    { key: 'true', value: 'Enabled' },
];

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
    (config.value.STRM_WATCHDOG_SOURCES || '')
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
.watchdogLegend {
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
