<template>
    <div class="liveTvSetup">
        <InfoBar v-if="loaded && !servers.length" clazz="info">
            No Jellyfin server with an API key is configured.
            <router-link to="/apps">Add Jellyfin on the Apps page</router-link> to set up the tuner and guide
            automatically, or paste the URLs above into Jellyfin yourself.
        </InfoBar>
        <template v-else-if="servers.length">
            <MultiSelectInput
                :model-value="selectedIds"
                name="Automatic Configuration"
                tooltip="Jellyfin servers to set up automatically. Needs an admin API key. Save first, as the buttons use saved settings."
                :options="serverOptions"
                @update:model-value="config.LIVE_TV_JELLYFIN_APPS = $event"
            />
            <div v-for="server in chosen" :key="server.id" class="serverBlock">
                <div class="serverName">{{ server.name }}</div>
                <div v-for="item in itemsFor(server.id)" :key="item.key" class="setupRow">
                    <label>{{ item.label }}</label>
                    <span :class="['state', item.present ? 'on' : '']">{{ item.present ? 'In Jellyfin' : 'Not added' }}</span>
                    <button type="button" :disabled="!!busy" @click="act(server.id, item.key, 'POST')">
                        <font-awesome-icon
                            :icon="['fas', busy === key(server.id, item.key, 'POST') ? 'circle-notch' : 'plus']"
                            :spin="busy === key(server.id, item.key, 'POST')"
                        />
                        {{ item.present ? 'Update' : 'Add' }}
                    </button>
                    <button type="button" :disabled="!!busy || !item.present" @click="act(server.id, item.key, 'DELETE')">
                        <font-awesome-icon
                            :icon="['fas', busy === key(server.id, item.key, 'DELETE') ? 'circle-notch' : 'trash']"
                            :spin="busy === key(server.id, item.key, 'DELETE')"
                        />
                        Remove
                    </button>
                </div>
                <InfoBar v-if="messages[server.id]" :clazz="messages[server.id].clazz">{{ messages[server.id].text }}</InfoBar>
            </div>
        </template>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref, watch } from 'vue';

import MultiSelectInput from '@/components/common/form/MultiSelectInput.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import { ipFetch } from '@/lib/ipFetch';
import { useLiveTv } from '@/lib/liveTv';

const { loadConfigured } = useLiveTv();
const servers = ref([]);
const loaded = ref(false);
const config = inject('settingsConfig');
// Comma-separated app ids (the LIVE_TV_JELLYFIN_APPS setting), as MultiSelectInput expects.
const selectedIds = computed(() => config.value.LIVE_TV_JELLYFIN_APPS ?? '');
const statuses = reactive({});
const messages = reactive({});
const busy = ref('');

const serverOptions = computed(() => servers.value.map(({ id, name }) => ({ key: id, value: name })));
const chosen = computed(() => {
    const ids = selectedIds.value.split(',').filter(Boolean);
    return servers.value.filter(({ id }) => ids.includes(id));
});

const key = (serverId, what, method) => `${serverId}:${what}:${method}`;
const itemsFor = (serverId) => [
    { key: 'tuner', label: 'Channels (M3U tuner)', present: !!statuses[serverId]?.tuner },
    { key: 'guide', label: 'Guide (XMLTV)', present: !!statuses[serverId]?.guide },
];

const report = (serverId, ok, text) => {
    messages[serverId] = { clazz: ok ? 'info' : 'danger', text };
};

const loadStatus = async (serverId) => {
    const { ok, data } = await ipFetch(`json-api/live-tv/jellyfin/status?appId=${encodeURIComponent(serverId)}`);
    statuses[serverId] = ok ? data : {};
    if (!ok) report(serverId, false, data?.message || 'Unable to read Jellyfin Live TV settings');
};

const act = async (serverId, what, method) => {
    busy.value = key(serverId, what, method);
    delete messages[serverId];
    try {
        const url =
            method === 'POST'
                ? `json-api/live-tv/jellyfin/${what}`
                : `json-api/live-tv/jellyfin/${what}?appId=${encodeURIComponent(serverId)}`;
        const { ok, data } = await ipFetch(url, method, method === 'POST' ? { appId: serverId } : undefined);
        if (ok) {
            statuses[serverId] = data;
            loadConfigured();
            report(serverId, true, `${what === 'tuner' ? 'Tuner' : 'Guide'} ${method === 'POST' ? 'saved to' : 'removed from'} Jellyfin.`);
        } else {
            report(serverId, false, data?.message || 'Request failed');
        }
    } finally {
        busy.value = '';
    }
};

// Read each server's state as it is ticked (once).
watch(chosen, (list) => list.forEach(({ id }) => !(id in statuses) && loadStatus(id)), { immediate: true });

onMounted(async () => {
    servers.value = (await ipFetch('json-api/apps')).data.filter(({ type, api_key: apiKey }) => type === 'JELLYFIN' && apiKey);
    loaded.value = true;
});
</script>

<style lang="less" scoped>
.serverBlock {
    margin-bottom: 1.5rem;

    .serverName {
        margin: 0 0 0.75rem 266px;
        font-weight: bold;
        font-size: 14px;
    }
}

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

    // Fixed widths so the buttons line up whatever the state text / Add-vs-Update label says.
    .state {
        flex: 0 0 100px;
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
        min-width: 105px;

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
