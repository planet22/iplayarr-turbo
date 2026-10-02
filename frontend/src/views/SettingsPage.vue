<template>
    <SettingsPageToolbar
        :save-enabled="saveEnabled"
        :icons="['save', 'advanced']"
        @save="saveConfig"
        @toggle-advanced="toggleAdvanced"
    />
    <SettingsTabs v-model="activeTab" :tabs="tabs" />
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
        />
        <DownloadClientSettingsTab v-if="activeTab == 'downloadClient'" :download-clients="downloadClients" />
        <StreamingSettingsTab
            v-if="activeTab == 'streaming'"
            :media-modes="mediaModes"
            :stream-modes="streamModes"
            :stream-clients="streamClients"
            @generate-stream-key="generateStreamKey"
        />
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
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import UpdateAppDialog from '@/components/modals/UpdateAppDialog.vue';
import AuthenticationSettingsTab from '@/components/settings/AuthenticationSettingsTab.vue';
import DownloadClientSettingsTab from '@/components/settings/DownloadClientSettingsTab.vue';
import GeneralSettingsTab from '@/components/settings/GeneralSettingsTab.vue';
import MaintenanceSettingsTab from '@/components/settings/MaintenanceSettingsTab.vue';
import MediaManagementSettingsTab from '@/components/settings/MediaManagementSettingsTab.vue';
import SettingsTabs from '@/components/settings/SettingsTabs.vue';
import StreamingSettingsTab from '@/components/settings/StreamingSettingsTab.vue';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { getHost } from '@/lib/utils';

const loading = ref(false);
let originalApiKey = undefined;

const config = ref({});
const configChanges = ref(false);
const showAdvanced = ref(false);
const refreshGlobalSettings = inject('refreshGlobalSettings');

const tabs = [
    { key: 'general', label: 'General' },
    { key: 'mediaManagement', label: 'Media Management' },
    { key: 'downloadClient', label: 'Download Client' },
    { key: 'streaming', label: 'Streaming' },
    { key: 'authentication', label: 'Authentication' },
    { key: 'maintenance', label: 'Maintenance' },
];
const activeTab = ref('general');

const validationErrors = ref({
    config: {},
});

provide('settingsConfig', config);
provide('settingsValidationErrors', validationErrors);
provide('settingsShowAdvanced', showAdvanced);

const qualityProfiles = ref([]);
const trueOrFalse = ref([
    { key: 'true', value: 'Enabled' },
    { key: 'false', value: 'Disabled' },
]);

const nfoWriteModes = ref([
    { key: 'none', value: 'Disabled' },
    { key: 'all', value: 'Enabled (All Downloads)' },
    { key: 'nzb', value: 'Enabled (Sonarr/Radarr Downloads Only)' },
    { key: 'manual', value: 'Enabled (Manual Downloads Only)' },
]);

const authTypes = ref([
    { key: 'form', value: 'Form' },
    { key: 'oidc', value: 'OpenID Connect (OIDC)' },
    { key: 'none', value: 'No Authentication' },
]);

const downloadClients = ref([
    { key: 'GET_IPLAYER', value: 'get_iplayer' },
    { key: 'YTDLP', value: 'yt-dlp (Experimental)' },
]);

const streamClients = ref([
    { key: 'GET_IPLAYER', value: 'get_iplayer' },
    { key: 'YTDLP', value: 'yt-dlp (Experimental)' },
    { key: 'NATIVE', value: 'Native (fastest - talks to BBC directly, no get_iplayer/yt-dlp)' },
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
    { key: 'direct', value: 'Direct (proxied through iPlayarr, supports seeking)' },
    { key: 'progressive-mkv', value: 'Progressive MKV (ffmpeg remux, proxied through iPlayarr)' },
]);

const saveEnabled = computed(() => {
    return configChanges.value;
});

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
    originalApiKey = configResponse.data.API_KEY;
    qualityProfiles.value = qpResponse.data.map(({ id, name, quality }) => ({
        key: id,
        value: `${name} (${quality})`,
    }));

    watch(
        config,
        () => {
            configChanges.value = true;
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

const saveConfig = async () => {
    if (config.value.AUTH_TYPE == 'oidc' && !oidcTested.value) {
        if (
            !(await dialogService.confirm(
                'OIDC Not Tested',
                'You have not tested your OIDC configuration. Are you sure you want to save without testing?'
            ))
        ) {
            return;
        }
    }
    loading.value = true;
    if (configChanges.value) {
        validationErrors.value.config = {};

        const configResponse = await ipFetch('json-api/config', 'PUT', config.value);

        if (!configResponse.ok) {
            const errorData = configResponse.data;
            validationErrors.value.config = errorData.invalid_fields;
            loading.value = false;
            return;
        } else {
            dialogService.alert('Success', 'Save Successful');
            configChanges.value = false;
            refreshGlobalSettings();
        }
    }

    loading.value = false;
    if (config.value.API_KEY != originalApiKey) {
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
    originalApiKey = config.value.API_KEY;
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
    if (saveEnabled.value) {
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
