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
            <div v-if="chosen.length" class="jellyfinTable">
                <div class="jtRow jtHead">
                    <span>Server</span>
                    <span v-for="item in itemsFor('')" :key="item.key">{{ item.short }}</span>
                </div>
                <template v-for="server in chosen" :key="server.id">
                    <div class="jtRow">
                        <span class="jtName">{{ server.name }}</span>
                        <div v-for="item in itemsFor(server.id)" :key="item.key" class="jtCell">
                            <span class="jtLabel">{{ item.label }}</span>
                            <span
                                :class="['statusIcon', item.present ? 'ok' : 'pending']"
                                :title="item.present ? 'In Jellyfin' : 'Not added'"
                                :aria-label="item.present ? 'In Jellyfin' : 'Not added'"
                            >
                                <font-awesome-icon :icon="['fas', item.present ? 'circle-check' : 'circle-minus']" />
                            </span>
                            <button
                                type="button"
                                :disabled="!!busy"
                                :title="item.present ? 'Update' : 'Add'"
                                :aria-label="item.present ? 'Update' : 'Add'"
                                @click="act(server.id, item.key, 'POST')"
                            >
                                <font-awesome-icon
                                    :icon="['fas', busy === key(server.id, item.key, 'POST') ? 'circle-notch' : item.present ? 'rotate' : 'plus']"
                                    :spin="busy === key(server.id, item.key, 'POST')"
                                />
                            </button>
                            <button
                                type="button"
                                :disabled="!!busy || !item.present"
                                title="Remove"
                                aria-label="Remove"
                                @click="act(server.id, item.key, 'DELETE')"
                            >
                                <font-awesome-icon
                                    :icon="['fas', busy === key(server.id, item.key, 'DELETE') ? 'circle-notch' : 'trash']"
                                    :spin="busy === key(server.id, item.key, 'DELETE')"
                                />
                            </button>
                        </div>
                    </div>
                    <InfoBar v-if="messages[server.id]" :clazz="messages[server.id].clazz" small>{{ messages[server.id].text }}</InfoBar>
                </template>
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
    { key: 'tuner', label: 'Channels (M3U tuner)', short: 'Channels', present: !!statuses[serverId]?.tuner },
    { key: 'guide', label: 'Guide (XMLTV)', short: 'Guide', present: !!statuses[serverId]?.guide },
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
// One row per server, one column per thing to set up: a tick says it is in Jellyfin, the buttons add/update or remove it.
// Ends where the selects above end (a form row is 650px wide, its info icon takes the last 32px).
.jellyfinTable {
    max-width: 618px;
    margin-right: 32px;
    margin-bottom: 1.5rem;
    border: 1px solid @input-border-color;
    border-radius: 4px;
    background-color: @input-background-color;
    box-shadow: inset 0 1px 1px @primary-box-shadow;
    overflow: hidden;

    .jtRow {
        display: grid;
        grid-template-columns: minmax(90px, 1fr) repeat(2, 112px);
        align-items: center;
        gap: 0 12px;
        padding: 6px 12px;
        border-top: 1px solid @input-border-color;

        &:first-child {
            border-top: 0;
        }
    }

    .jtHead {
        padding-top: 8px;
        padding-bottom: 8px;
        background-color: @nav-active-background-color;
        color: @subtle-text-color;
        font-size: 12px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 0.04em;

        // Header text sits over the cell's tick, not the buttons.
        span:not(:first-child) {
            text-align: start;
        }
    }

    .jtName {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 14px;
        font-weight: bold;
        color: @table-text-color;
    }

    .jtCell {
        display: flex;
        align-items: center;
        gap: 6px;

        .jtLabel {
            display: none;
        }
    }

    .statusIcon {
        flex: 0 0 22px;
        text-align: center;
        font-size: 18px;
        cursor: default;

        &.ok {
            color: @positive-color;
        }

        &.pending {
            color: @subtle-text-color;
        }
    }

    button {
        width: 32px;
        height: 32px;
        padding: 0;
        background-color: @settings-button-background-color;
        border: 1px solid @settings-button-border-color;
        font-size: 14px;
        color: @primary-text-color;
        border-radius: 4px;

        &:hover:not(:disabled) {
            border-color: @settings-button-hover-border-color;
            background-color: @settings-button-hover-background-color;
        }

        &:disabled {
            opacity: 0.4;
        }
    }

    // Phones: the server name heads a card; its two items sit under it with their label beside the controls.
    @media (max-width: @mobile-breakpoint) {
        .jtHead {
            display: none;
        }

        .jtRow {
            grid-template-columns: 1fr;
            gap: 6px;
            padding: 10px 12px;
        }

        .jtCell {
            .jtLabel {
                display: block;
                flex: 1 1 auto;
                min-width: 0;
                font-size: 13px;
                color: @table-text-color;
            }
        }
    }
}
</style>
