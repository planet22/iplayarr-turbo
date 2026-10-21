<template>
    <div class="inner-content">
        <PageHeader title="Settings" />
        <SettingsPageToolbar
            :save-enabled="saveEnabled"
            :icons="['save', 'advanced']"
            @save="saveConfig"
            @toggle-advanced="toggleAdvanced"
        />
    </div>
    <SettingsTabs :model-value="activeTab" :tabs="tabs" :dirty-tabs="dirtyTabs" :error-tabs="errorTabs" @update:model-value="switchTab" />
    <div v-if="!loading" class="inner-content">
        <GeneralSettingsTab
            v-if="activeTab == 'general'"
            :true-or-false="trueOrFalse"
            @generate-api-key="generateApiKey"
        />
        <MediaManagementSettingsTab
            v-if="activeTab == 'mediaManagement'"
            :quality-profiles="qualityProfiles"
            :output-formats="outputFormats"
            :true-or-false="trueOrFalse"
            :nfo-write-modes="nfoWriteModes"
            :media-modes="mediaModes"
        />
        <DownloadClientSettingsTab v-if="activeTab == 'downloadClient'" :download-clients="downloadClients" />
        <StreamingSettingsTab
            v-if="activeTab == 'streaming'"
            :stream-modes="streamModes"
            :stream-clients="streamClients"
            @generate-stream-key="generateStreamKey"
        />
        <LiveTvSettingsTab v-if="activeTab == 'liveTv'" @generate-stream-key="generateStreamKey" />
        <AuthenticationSettingsTab
            v-if="activeTab == 'authentication'"
            :auth-types="authTypes"
            :oidc-tested="oidcTested"
            :oidc-callback-tooltip="oidcCallbackTooltip"
            @test-oidc="testOIDC"
        />
        <MaintenanceSettingsTab v-if="activeTab == 'maintenance'" />
    </div>
    <LoadingIndicator v-if="loading" />
</template>

<script setup>
import { v4 } from 'uuid';
import { computed, inject, onMounted, provide, ref, watch } from 'vue';
import { useModal } from 'vue-final-modal';
import { onBeforeRouteLeave } from 'vue-router';

import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import UpdateAppDialog from '@/components/modals/UpdateAppDialog.vue';
import AuthenticationSettingsTab from '@/components/settings/AuthenticationSettingsTab.vue';
import DownloadClientSettingsTab from '@/components/settings/DownloadClientSettingsTab.vue';
import GeneralSettingsTab from '@/components/settings/GeneralSettingsTab.vue';
import LiveTvSettingsTab from '@/components/settings/LiveTvSettingsTab.vue';
import MaintenanceSettingsTab from '@/components/settings/MaintenanceSettingsTab.vue';
import MediaManagementSettingsTab from '@/components/settings/MediaManagementSettingsTab.vue';
import SettingsTabs from '@/components/settings/SettingsTabs.vue';
import StreamingSettingsTab from '@/components/settings/StreamingSettingsTab.vue';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { useAppearanceDraft } from '@/lib/useAppearanceDraft';
import { ttlDraftSeconds, ttlEntryChanged } from '@/lib/useCaches';
import { getHost } from '@/lib/utils';

const loading = ref(false);
let originalApiKey = undefined;
let originalUhdFeeds = undefined;

const config = ref({});
const showAdvanced = ref(false);
const refreshGlobalSettings = inject('refreshGlobalSettings');

const tabs = [
    { key: 'general', label: 'General', icon: 'sliders' },
    { key: 'mediaManagement', label: 'Media Management', icon: 'folder-open' },
    { key: 'downloadClient', label: 'Download Client', icon: 'download' },
    { key: 'streaming', label: 'Streaming', icon: 'tower-broadcast' },
    { key: 'liveTv', label: 'Live TV', icon: 'tv' },
    { key: 'authentication', label: 'Authentication', icon: 'shield-halved' },
    { key: 'maintenance', label: 'Maintenance', icon: 'wrench' },
];
const activeTab = ref('general');

// Which config keys each tab edits. Save sends just the current tab's keys, and the tab bar flags
// the tabs whose keys differ from what was last loaded or saved. STREAM_BASE_URL and STREAM_KEY are
// shared by Streaming and Live TV.
const TAB_KEYS = {
    general: [
        'API_KEY', 'NATIVE_SEARCH', 'NATIVE_SEARCH_ENGINE', 'NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY',
        'SEARCH_MATCH_ALL_WORDS', 'RSS_FEED_HOURS', 'SCHEDULE_FULL_REFRESH',
    ],
    mediaManagement: [
        'DOWNLOAD_DIR', 'COMPLETE_DIR', 'ARR_COMPLETE_DIR', 'LIVE_STRM_DIR', 'VIDEO_QUALITY', 'EXTRA_VIDEO_QUALITIES',
        'RELEASE_LANGUAGE', 'AIRDATE_NUMBERING', 'TV_FILENAME_TEMPLATE', 'MOVIE_FILENAME_TEMPLATE', 'OUTPUT_FORMAT',
        'MEDIA_MODE', 'ARCHIVE_ENABLED', 'LIBRARY_FOLDER_STRUCTURE', 'WRITE_NFO_STRM', 'WRITE_STRMTOOL_JSON',
    ],
    downloadClient: ['ACTIVE_LIMIT', 'DOWNLOAD_CLIENT', 'ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS'],
    streaming: [
        'STREAM_BASE_URL', 'STREAM_KEY', 'STREAM_CLIENT', 'STREAM_NATIVE_ADAPTIVE', 'STREAM_NATIVE_HQ_PROBE',
        'STREAM_NATIVE_EXPERIMENTAL_FHD', 'STREAM_SUBTITLES', 'STREAM_MODE', 'STREAM_CACHE_DIR', 'STRM_WATCHDOG_ENABLED',
        'STRM_WATCHDOG_SOURCES', 'STRM_WATCHDOG_ACTION', 'STRM_WATCHDOG_PATH_MAP', 'STRM_WATCHDOG_ARR_ACTION',
        'STRM_WATCHDOG_CONCURRENCY', 'STRM_WATCHDOG_FAIL_THRESHOLD', 'STRM_WATCHDOG_WEBHOOK_URL',
    ],
    liveTv: [
        'LIVE_TV_ENABLED', 'STREAM_BASE_URL', 'STREAM_KEY', 'LIVE_TV_EPG_OFFSET', 'LIVE_TV_LOGO_SHAPE',
        'STREAM_LIVE_DASH_1080', 'LIVE_UHD_EVENT_FEEDS', 'LIVE_TV_GUIDE_CATEGORIES', 'LIVE_TV_GUIDE_FLAGS', 'LIVE_TV_GUIDE_HD',
    ],
    authentication: [
        'AUTH_TYPE', 'AUTH_USERNAME', 'AUTH_PASSWORD', 'OIDC_CONFIG_URL', 'OIDC_CALLBACK_HOST', 'OIDC_CLIENT_ID',
        'OIDC_CLIENT_SECRET', 'OIDC_ALLOWED_EMAILS',
    ],
    maintenance: ['STREAM_HISTORY_RETENTION_DAYS'],
};

// What each key held when the config was loaded or last saved.
const original = ref({});
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const changedKeys = computed(() => {
    const changed = new Set();
    for (const keys of Object.values(TAB_KEYS)) {
        for (const key of keys) {
            if (JSON.stringify(config.value[key]) !== JSON.stringify(original.value[key])) changed.add(key);
        }
    }
    return changed;
});
const tabHas = (tab, lookup) => TAB_KEYS[tab].some((key) => lookup(key));
// Maintenance cron drafts: id -> { draft, saved, message, valid }. Rows create their entry; Save applies the changed ones.
const schedules = ref({});
const schedulesReload = ref(0);
const changedSchedules = computed(() => Object.keys(schedules.value).filter((id) => schedules.value[id].draft.trim() !== schedules.value[id].saved));
// Maintenance cache lifetimes: prefix -> { value, unit, savedTtl, resetPending }. The tab creates the entries; Save applies the changed ones.
const cacheTtls = ref({});
const cachesReload = ref(0);
const changedCacheTtls = computed(() => Object.keys(cacheTtls.value).filter((prefix) => ttlEntryChanged(cacheTtls.value[prefix])));
// General tab per-browser preferences: applied by Save, not as they are edited.
const { draft: appearance, changed: changedAppearance, apply: applyAppearance } = useAppearanceDraft();
const dirtyTabs = computed(() =>
    tabs
        .filter(
            (tab) =>
                tabHas(tab.key, (key) => changedKeys.value.has(key)) ||
                (tab.key == 'maintenance' && (changedSchedules.value.length || changedCacheTtls.value.length)) ||
                (tab.key == 'general' && changedAppearance.value.length)
        )
        .map((tab) => tab.key)
);
const errorTabs = computed(() =>
    tabs.filter((tab) => tabHas(tab.key, (key) => validationErrors.value.config?.[key])).map((tab) => tab.key)
);

const validationErrors = ref({
    config: {},
});

provide('settingsConfig', config);
provide('settingsChangedKeys', changedKeys);
provide('settingsSchedules', schedules);
provide('settingsSchedulesReload', schedulesReload);
provide('settingsCacheTtls', cacheTtls);
provide('settingsCachesReload', cachesReload);
provide('settingsAppearance', appearance);
provide('settingsValidationErrors', validationErrors);
provide('settingsShowAdvanced', showAdvanced);
provide('infoTips', true);

const qualityProfiles = ref([]);
const trueOrFalse = ref([
    { key: 'true', value: 'Enabled' },
    { key: 'false', value: 'Disabled' },
]);

const nfoWriteModes = ref([
    { key: 'none', value: 'Disabled' },
    { key: 'all', value: 'Enabled (All)' },
    { key: 'nzb', value: 'Enabled (Sonarr/Radarr)' },
    { key: 'manual', value: 'Enabled (Manual)' },
]);

const authTypes = ref([
    { key: 'form', value: 'Form' },
    { key: 'oidc', value: 'OpenID Connect (OIDC)' },
    { key: 'none', value: 'No Authentication' },
]);

const downloadClients = ref([
    { key: 'NATIVE', value: 'Native (fastest, recommended)' },
    { key: 'GET_IPLAYER', value: 'get_iplayer' },
    { key: 'YTDLP', value: 'yt-dlp (Experimental)' },
]);

const streamClients = ref([
    { key: 'GET_IPLAYER', value: 'get_iplayer' },
    { key: 'YTDLP', value: 'yt-dlp' },
    { key: 'NATIVE', value: 'Native (fastest, recommended)' },
]);

const outputFormats = ref([
    { key: 'mp4', value: 'MP4' },
    { key: 'mkv', value: 'MKV' },
]);

const mediaModes = ref([
    { key: 'download', value: 'Download' },
    { key: 'strm', value: 'Stream (.strm)' },
]);

const streamModes = ref([
    { key: 'direct', value: 'Direct (supports seeking)' },
    { key: 'progressive-mkv', value: 'Progressive MKV (ffmpeg, no seeking)' },
]);

// Save applies to the tab being viewed only; other tabs keep their edits (and their flag) until saved.
// Edits survive a tab switch, but ask first so an unsaved tab is not left behind by accident.
const switchTab = async (key) => {
    if (key === activeTab.value) return;
    if (
        dirtyTabs.value.includes(activeTab.value) &&
        !(await dialogService.confirm(
            'Unsaved Changes',
            'You have unsaved changes on this tab. Switch anyway?',
            'Your edits are kept until you leave the page, but they are not saved until you press Save on this tab.'
        ))
    ) {
        return;
    }
    activeTab.value = key;
};

const saveEnabled = computed(() => dirtyTabs.value.includes(activeTab.value));

const oidcCallbackTooltip = computed(() => {
    return `${window.location.protocol}//${window.location.host}`;
});

const oidcTested = ref(false);
let oidcChannel;

onMounted(async () => {
    const [configResponse, qpResponse] = await Promise.all([
        ipFetch('json-api/config'),
        ipFetch('json-api/config/qualityProfiles'),
    ]);

    config.value = configResponse.data;
    original.value = clone(configResponse.data);
    originalApiKey = configResponse.data.API_KEY;
    originalUhdFeeds = configResponse.data.LIVE_UHD_EVENT_FEEDS;
    qualityProfiles.value = qpResponse.data.map(({ id, name, quality }) => ({
        key: id,
        value: `${name} (${quality})`,
    }));

    watch(
        config,
        () => {
            oidcTested.value = false;
        },
        { deep: true }
    );

    oidcChannel = new BroadcastChannel('oidc-test');
    oidcChannel.onmessage = (event) => {
        if (event.data && event.data.type === 'oidc-test-result') {
            oidcTested.value = event.data.success;
            dialogService.alert(
                'OIDC Test Result',
                event.data.success ? `OIDC test succeeded for ${event.data.email}!` : `OIDC test failed: ${event.data.error || 'Unknown error'}`
            );
        }
    };
});

// Applies every edited cron schedule; returns how many were refused (their message is left on the row).
const saveSchedules = async () => {
    let failed = 0;
    for (const id of changedSchedules.value) {
        const entry = schedules.value[id];
        const { ok, data } = await ipFetch(`json-api/maintenance/tasks/${id}/schedule`, 'PUT', { cron: entry.draft.trim() });
        entry.valid = ok;
        if (ok) {
            entry.saved = entry.draft.trim();
            entry.message = '';
        } else {
            failed++;
            entry.message = data?.message || 'Unable to save the schedule';
        }
    }
    schedulesReload.value++;
    return failed;
};

// Applies every edited cache lifetime (or pending reset); returns how many were refused.
const saveCacheTtls = async () => {
    let failed = 0;
    for (const prefix of changedCacheTtls.value) {
        const entry = cacheTtls.value[prefix];
        const ttl = entry.resetPending ? null : ttlDraftSeconds(entry);
        const { ok } = await ipFetch(`json-api/maintenance/caches/${prefix}/ttl`, 'PUT', { ttl });
        if (ok) {
            entry.resetPending = false;
            if (ttl !== null) entry.savedTtl = ttl;
        } else {
            failed++;
        }
    }
    cachesReload.value++;
    return failed;
};

const saveConfig = async () => {
    const tab = activeTab.value;
    if (tab == 'authentication' && config.value.AUTH_TYPE == 'oidc' && !oidcTested.value) {
        if (
            !(await dialogService.confirm(
                'OIDC Not Tested',
                'You have not tested your OIDC configuration. Are you sure you want to save without testing?'
            ))
        ) {
            return;
        }
    }
    if (tab == 'liveTv' && originalUhdFeeds === 'true' && config.value.LIVE_UHD_EVENT_FEEDS !== 'true') {
        if (
            !(await dialogService.confirm(
                'Turn Off UHD Event Feeds',
                'Turn off the UHD event feeds?',
                'Any of them in your library or Jellyfin Live TV are removed, and their .strm files deleted.'
            ))
        ) {
            return;
        }
    }
    loading.value = true;
    {
        const keys = TAB_KEYS[tab].filter((key) => key in config.value);
        const body = Object.fromEntries(keys.map((key) => [key, config.value[key]]));
        validationErrors.value.config = {};

        const configResponse = await ipFetch('json-api/config', 'PUT', body);

        if (!configResponse.ok) {
            const errorData = configResponse.data;
            validationErrors.value.config = errorData.invalid_fields;
            loading.value = false;
            return;
        } else {
            for (const key of keys) original.value[key] = clone(config.value[key]);
            refreshGlobalSettings();
            if (tab == 'general') applyAppearance();
            const scheduleErrors = tab == 'maintenance' ? await saveSchedules() : 0;
            const cacheErrors = tab == 'maintenance' ? await saveCacheTtls() : 0;
            if (scheduleErrors) {
                dialogService.alert('Error', `${scheduleErrors} schedule(s) could not be saved - see the messages under each task.`);
            } else if (cacheErrors) {
                dialogService.alert('Error', `${cacheErrors} cache lifetime(s) could not be saved.`);
            } else {
                dialogService.alert('Success', 'Save Successful');
            }
        }
    }

    loading.value = false;
    if (tab == 'general' && config.value.API_KEY != originalApiKey) {
        if (
            await dialogService.confirm('API Key Changed', 'Api Key Changed, do you want to update any relevant apps?')
        ) {
            const formModal = useModal({
                component: UpdateAppDialog,
                attrs: {
                    onClose: () => {
                        formModal.close();
                    },
                },
            });
            formModal.open();
        }
    }
    if (tab == 'general') originalApiKey = config.value.API_KEY;
    if (tab == 'liveTv') originalUhdFeeds = config.value.LIVE_UHD_EVENT_FEEDS;
};

const toggleAdvanced = () => {
    showAdvanced.value = !showAdvanced.value;
};

const generateApiKey = async () => {
    if (
        await dialogService.confirm(
            'Regenerate API Key',
            'Are you sure you want to regenerate the API Key?',
            'API Key will not change until settings are saved'
        )
    ) {
        config.value.API_KEY = v4();
    }
};

const generateStreamKey = async () => {
    if (
        await dialogService.confirm(
            'Regenerate Stream Key',
            'Are you sure you want to regenerate the Stream Key?',
            'Existing .strm files will be rewritten with the new key once settings are saved'
        )
    ) {
        config.value.STREAM_KEY = v4();
    }
};

onBeforeRouteLeave(async (_, __, next) => {
    if (dirtyTabs.value.length) {
        if (
            await dialogService.confirm(
                'Unsaved Changes',
                'You have unsaved changes. If you leave this page they will be lost.'
            )
        ) {
            next();
        } else {
            next(false);
        }
    }
    next();
});

const testOIDC = () => {
    // Create a form element
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `${getHost()}/auth/oidc/test`; // Change to your actual endpoint
    form.target = '_blank';

    // Add OIDC config fields as hidden inputs
    [
        'OIDC_CONFIG_URL',
        'OIDC_CALLBACK_HOST',
        'OIDC_CLIENT_ID',
        'OIDC_CLIENT_SECRET',
        'OIDC_ALLOWED_EMAILS'
    ].forEach(key => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = key;
        input.value = config.value[key] || '';
        form.appendChild(input);
    });

    document.body.appendChild(form);

    // Use requestSubmit if available, fallback to submit
    form.submit();

    // Remove the form after a short delay to ensure the request is sent
    setTimeout(() => {
        document.body.removeChild(form);
    }, 1000);
};
</script>
