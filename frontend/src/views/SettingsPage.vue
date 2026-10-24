<template>
    <div class="inner-content">
        <PageHeader title="Settings" />
        <SettingsPageToolbar
            inline-filters
            filters-last
            :save-enabled="saveEnabled"
            :icons="['save', 'advanced']"
            :advanced-on="showAdvanced"
            @save="saveConfig"
            @toggle-advanced="toggleAdvanced"
        >
            <template v-if="filterable && !loading" #filters>
                <input
                    v-model="filterText"
                    type="search"
                    class="tableFilter"
                    placeholder="Filter settings on this tab"
                    aria-label="Filter settings on this tab"
                    @keydown.esc="filterText = ''"
                />
            </template>
        </SettingsPageToolbar>
    </div>
    <SettingsTabs :model-value="activeTab" :tabs="tabs" :dirty-tabs="dirtyTabs" :error-tabs="errorTabs" @update:model-value="switchTab" />
    <div v-if="!loading" ref="settingsBody" class="inner-content settingsBody">
        <GeneralSettingsTab
            v-if="activeTab == 'general'"
            :true-or-false="trueOrFalse"
            @generate-api-key="generateApiKey"
        />
        <MediaManagementSettingsTab
            v-if="activeTab == 'mediaManagement'"
            :quality-profiles="qualityProfiles"
            :version-profiles="versionProfiles"
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
        <div v-if="filterText.trim() && !filterMatches" class="settingsFilterEmpty">
            No settings on this tab match "{{ filterText.trim() }}".
        </div>
    </div>
    <SettingsSaveBar :count="tabChangeCount" :saving="loading" @save="saveConfig" @discard="discardChanges" />
    <LoadingIndicator v-if="loading" />
</template>

<script setup>
import { v4 } from 'uuid';
import { computed, inject, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import { useModal } from 'vue-final-modal';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';

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
import SettingsSaveBar from '@/components/settings/SettingsSaveBar.vue';
import SettingsTabs from '@/components/settings/SettingsTabs.vue';
import StreamingSettingsTab from '@/components/settings/StreamingSettingsTab.vue';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import toastService from '@/lib/toastService';
import { useAppearanceDraft } from '@/lib/useAppearanceDraft';
import { splitTtl, ttlDraftSeconds, ttlEntryChanged } from '@/lib/useCaches';
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
const route = useRoute();
const router = useRouter();
// The open tab is kept in the URL (#streaming), so a tab can be linked to and survives a reload.
const initialTab = tabs.find((tab) => tab.key === route.hash.slice(1))?.key;
const activeTab = ref(initialTab ?? 'general');

// Which config keys each tab edits. Save sends just the current tab's keys, and the tab bar flags
// the tabs whose keys differ from what was last loaded or saved. STREAM_BASE_URL and STREAM_KEY are
// shared by Streaming and Live TV.
const TAB_KEYS = {
    general: [
        'API_KEY', 'NATIVE_SEARCH', 'NATIVE_SEARCH_ENGINE', 'NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY',
        'SEARCH_MATCH_ALL_WORDS', 'MANUAL_NATIVE_SEARCH', 'MANUAL_NATIVE_SEARCH_ENGINE',
        'MANUAL_SEARCH_MATCH_ALL_WORDS', 'RSS_FEED_HOURS', 'SCHEDULE_FULL_REFRESH',
        'UI_PILL_COLORS', 'UI_CHANNEL_TOOLS', 'UI_INFO_MESSAGES', 'UI_QUALITY_BADGES', 'UI_VERSION_BADGES', 'UI_SUBTITLE_BADGES',
    ],
    mediaManagement: [
        'DOWNLOAD_DIR', 'COMPLETE_DIR', 'ARR_COMPLETE_DIR', 'LIVE_STRM_DIR', 'VIDEO_QUALITY', 'EXTRA_VIDEO_QUALITIES',
        'EXTRA_VERSIONS', 'RELEASE_LANGUAGE', 'AIRDATE_NUMBERING', 'TV_FILENAME_TEMPLATE', 'MOVIE_FILENAME_TEMPLATE', 'OUTPUT_FORMAT',
        'MEDIA_MODE', 'ARCHIVE_ENABLED', 'LIBRARY_FOLDER_STRUCTURE', 'WRITE_NFO_STRM', 'WRITE_STRMTOOL_JSON',
    ],
    downloadClient: ['ACTIVE_LIMIT', 'DOWNLOAD_CLIENT', 'ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS', 'DOWNLOAD_ASK_VERSION', 'DOWNLOAD_DEFAULT_VERSION'],
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
    // The per-browser Appearance preferences join the same highlighting, as "appearance:<name>".
    for (const name of changedAppearance.value) changed.add(`appearance:${name}`);
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
const { draft: appearance, changed: changedAppearance, apply: applyAppearance, reset: resetAppearance } = useAppearanceDraft();
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
const versionProfiles = ref([]);
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
    filterText.value = '';
    router.replace({ hash: `#${key}` });
};

// The URL hash can change without this page reloading (browser Back, a quick-find jump to another tab while
// already here): follow it. If the unsaved-changes question is declined, put the hash back to the open tab.
watch(
    () => route.hash,
    async (hash) => {
        const key = hash.slice(1);
        if (!tabs.some((tab) => tab.key === key) || key === activeTab.value) return;
        await switchTab(key);
        if (activeTab.value !== key) router.replace({ hash: `#${activeTab.value}` });
    }
);

const saveEnabled = computed(() => dirtyTabs.value.includes(activeTab.value));

// Edits waiting on the open tab, for the save bar.
const tabChangeCount = computed(() => {
    const tab = activeTab.value;
    let count = TAB_KEYS[tab].filter((key) => changedKeys.value.has(key)).length;
    if (tab == 'maintenance') count += changedSchedules.value.length + changedCacheTtls.value.length;
    if (tab == 'general') count += changedAppearance.value.length;
    return count;
});

// Puts the open tab back to what was last loaded or saved.
const discardChanges = () => {
    const tab = activeTab.value;
    for (const key of TAB_KEYS[tab]) {
        if (key in original.value) config.value[key] = clone(original.value[key]);
    }
    if (tab == 'maintenance') {
        for (const id of changedSchedules.value) schedules.value[id].draft = schedules.value[id].saved;
        for (const prefix of changedCacheTtls.value) {
            Object.assign(cacheTtls.value[prefix], splitTtl(cacheTtls.value[prefix].savedTtl), { resetPending: false });
        }
    }
    if (tab == 'general') resetAppearance();
    validationErrors.value.config = {};
    toastService.info('Changes discarded');
};

// Filter box: hides the settings on the open tab whose label or help text lacks the typed words, and any
// section heading left with nothing under it. Done on the rendered rows so every tab gets it unchanged.
const filterText = ref('');
const filterMatches = ref(true);
const settingsBody = ref(null);
const filterable = computed(() => activeTab.value != 'maintenance');
let filterObserver;

const applyFilter = () => {
    const root = settingsBody.value;
    if (!root) return;
    const words = filterText.value.toLowerCase().split(/\s+/).filter(Boolean);
    let heading = null;
    let headingHasMatch = false;
    let matches = 0;
    const closeHeading = () => {
        if (heading) heading.classList.toggle('filteredOut', words.length > 0 && !headingHasMatch);
    };
    for (const el of root.querySelectorAll('.settingsSubheading, .form-group, .jellyfinStatus')) {
        if (el.classList.contains('settingsSubheading')) {
            closeHeading();
            heading = el;
            headingHasMatch = false;
            continue;
        }
        const text = [el.querySelector('label')?.textContent, ...[...el.querySelectorAll('.tooltip, .InfoTip-popup, .statusName')].map((n) => n.textContent)]
            .join(' ')
            .toLowerCase();
        const hit = words.every((word) => text.includes(word));
        el.classList.toggle('filteredOut', words.length > 0 && !hit);
        if (hit) {
            matches++;
            headingHasMatch = true;
        }
    }
    closeHeading();
    filterMatches.value = words.length === 0 || matches > 0;
};

watch([filterText, activeTab, loading], async () => {
    await nextTick();
    applyFilter();
});

watch(settingsBody, (el) => {
    filterObserver?.disconnect();
    if (el) {
        // A tab's rows can arrive after it opens (data loading in); keep the filter applied to them.
        filterObserver = new MutationObserver(() => {
            if (filterText.value.trim()) applyFilter();
        });
        filterObserver.observe(el, { childList: true, subtree: true });
    }
});
onBeforeUnmount(() => filterObserver?.disconnect());

// Closing or reloading the browser tab with edits waiting asks first (route changes are covered below).
const warnBeforeUnload = (event) => {
    if (dirtyTabs.value.length) {
        event.preventDefault();
        event.returnValue = '';
    }
};
window.addEventListener('beforeunload', warnBeforeUnload);
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnBeforeUnload));

const oidcCallbackTooltip = computed(() => {
    return `${window.location.protocol}//${window.location.host}`;
});

const oidcTested = ref(false);
let oidcChannel;

onMounted(async () => {
    const [configResponse, qpResponse, vpResponse] = await Promise.all([
        ipFetch('json-api/config'),
        ipFetch('json-api/config/qualityProfiles'),
        ipFetch('json-api/config/versionProfiles'),
    ]);

    config.value = configResponse.data;
    original.value = clone(configResponse.data);
    originalApiKey = configResponse.data.API_KEY;
    originalUhdFeeds = configResponse.data.LIVE_UHD_EVENT_FEEDS;
    qualityProfiles.value = qpResponse.data.map(({ id, name, quality }) => ({
        key: id,
        value: `${name} (${quality})`,
    }));
    versionProfiles.value = vpResponse.data.map(({ id, name, tag }) => ({ key: id, value: `${name} (${tag})` }));

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
            if (event.data.success) toastService.success(`OIDC test succeeded for ${event.data.email}`);
            else toastService.error('OIDC test failed', { detail: event.data.error || 'Unknown error' });
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
                toastService.error(`${scheduleErrors} schedule(s) could not be saved`, { detail: 'See the messages under each task.' });
            } else if (cacheErrors) {
                toastService.error(`${cacheErrors} cache lifetime(s) could not be saved`);
            } else {
                toastService.success('Settings saved');
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

onBeforeRouteLeave(async () => {
    if (!dirtyTabs.value.length) return true;
    return await dialogService.confirm(
        'Unsaved Changes',
        'You have unsaved changes. If you leave this page they will be lost.',
        undefined,
        { danger: true, confirmLabel: 'Leave page' }
    );
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

<style lang="less">
.settingsBody .filteredOut {
    display: none !important;
}

.settingsFilterEmpty {
    padding: 1rem 0;
    color: @subtle-text-color;
}
</style>
