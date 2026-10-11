<template>
    <div class="liveTvSetup">
        <InfoBar v-if="loaded && !servers.length" clazz="info">
            No Jellyfin server with an API key is configured.
            <router-link to="/apps">Add Jellyfin on the Apps page</router-link> to set up the tuner and guide
            automatically, or paste the URLs above into Jellyfin yourself.
        </InfoBar>
        <template v-else-if="servers.length">
            <SelectInput
                v-model="serverId"
                name="Jellyfin Server"
                tooltip="Server the tuner and guide are added to. Needs an administrator API key. Uses the saved Stream Base URL, Stream Key and EPG offset - save settings first."
                :options="serverOptions"
            />
            <div v-for="item in items" :key="item.key" class="setupRow">
                <label>{{ item.label }}</label>
                <span :class="['state', item.present ? 'on' : '']">{{ item.present ? 'In Jellyfin' : 'Not added' }}</span>
                <button type="button" :disabled="busy" @click="act(item.key, 'POST')">
                    <font-awesome-icon :icon="['fas', busy === item.key + 'POST' ? 'circle-notch' : 'plus']" :spin="busy === item.key + 'POST'" />
                    {{ item.present ? 'Update' : 'Add' }}
                </button>
                <button type="button" :disabled="busy || !item.present" @click="act(item.key, 'DELETE')">
                    <font-awesome-icon :icon="['fas', busy === item.key + 'DELETE' ? 'circle-notch' : 'trash']" :spin="busy === item.key + 'DELETE'" />
                    Remove
                </button>
            </div>
            <InfoBar v-if="message" :clazz="messageClass">{{ message }}</InfoBar>
        </template>
    </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';

import SelectInput from '@/components/common/form/SelectInput.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import { ipFetch } from '@/lib/ipFetch';

const servers = ref([]);
const loaded = ref(false);
const serverId = ref('');
const status = ref({});
const busy = ref('');
const message = ref('');
const messageClass = ref('info');

const serverOptions = computed(() => servers.value.map(({ id, name }) => ({ key: id, value: name })));
const items = computed(() => [
    { key: 'tuner', label: 'Channels (M3U tuner)', present: !!status.value.tuner },
    { key: 'guide', label: 'Guide (XMLTV)', present: !!status.value.guide },
]);

const report = (ok, text) => {
    message.value = text;
    messageClass.value = ok ? 'info' : 'danger';
};

const loadStatus = async () => {
    if (!serverId.value) return;
    const { ok, data } = await ipFetch(`json-api/live-tv/jellyfin/status?appId=${encodeURIComponent(serverId.value)}`);
    status.value = ok ? data : {};
    if (!ok) report(false, data?.message || 'Unable to read Jellyfin Live TV settings');
};

const act = async (what, method) => {
    busy.value = what + method;
    message.value = '';
    try {
        const url =
            method === 'POST'
                ? `json-api/live-tv/jellyfin/${what}`
                : `json-api/live-tv/jellyfin/${what}?appId=${encodeURIComponent(serverId.value)}`;
        const { ok, data } = await ipFetch(url, method, method === 'POST' ? { appId: serverId.value } : undefined);
        if (ok) {
            status.value = data;
            report(true, `${what === 'tuner' ? 'Tuner' : 'Guide'} ${method === 'POST' ? 'saved to' : 'removed from'} Jellyfin.`);
        } else {
            report(false, data?.message || 'Request failed');
        }
    } finally {
        busy.value = '';
    }
};

watch(serverId, () => {
    message.value = '';
    loadStatus();
});

onMounted(async () => {
    servers.value = (await ipFetch('json-api/apps')).data.filter(({ type, api_key: key }) => type === 'JELLYFIN' && key);
    loaded.value = true;
    serverId.value = servers.value[0]?.id ?? '';
});
</script>

<style lang="less" scoped>
.setupRow {
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

    .state {
        min-width: 90px;
        color: @subtle-text-color;

        &.on {
            color: #2ecc71;
        }
    }

    button {
        background-color: @settings-button-background-color;
        border: 1px solid @settings-button-border-color;
        padding: 6px 16px;
        font-size: 14px;
        color: @primary-text-color;
        border-radius: 4px;

        &:hover:not(:disabled) {
            border-color: @settings-button-hover-border-color;
            background-color: @settings-button-hover-background-color;
        }

        &:disabled {
            opacity: 0.5;
        }
    }
}
</style>
