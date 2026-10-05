<template>
    <div class="inner-content">
        <legend>Apps</legend>
        <p class="mb-0">Manage your integrations with Apps (including Arr and NZB Clients) here</p>
        <InfoBar clazz="warning">
            In order for NZB Forwarding to work successfully, your NZB Client needs the category "iplayer"
        </InfoBar>
        <div class="block-reset" />
        <ListEditor v-slot="{ item }" :items="apps" :actions="[['trash', deleteApp]]" @create="openForm">
            <a @click="openForm(item)">
                <div class="major">
                    <img class="appImg" :src="`/img/${item.type.toLowerCase()}.svg`" />
                    <span class="appName">
                        {{ item.name }}
                    </span>
                </div>
                <div class="sub">
                    {{ item.url }}
                </div>
                <div class="featureList">
                    <span
                        v-if="
                            hasFeature(item.type, 'download_client') ||
                            hasFeature(item.type, 'prowlarr_download_client')
                        "
                        :class="['pill', item.download_client?.id ? 'success' : 'error']"
                    >
                        Download Client
                    </span>
                    <span
                        v-if="hasFeature(item.type, 'indexer') || hasFeature(item.type, 'prowlarr_indexer')"
                        :class="['pill', item.indexer?.id ? 'success' : 'error']"
                    >
                        Indexer
                    </span>
                    <span v-if="hasFeature(item.type, 'priority')" :class="['pill', 'grey']">
                        Priority: {{ item.priority }}
                    </span>
                </div>
            </a>
        </ListEditor>
        <div class="block-reset" />

        <legend>User-Agent Lookup</legend>
        <p class="mb-0">
            Maps a caller's User-Agent to an App, for requests without an app ID (e.g. a manually added indexer).
            Unrecognised ones appear automatically with a blank App - fill one in, or trim it, to match future
            requests (partial match).
        </p>
        <table class="queueTable uaTable responsive-table">
            <colgroup>
                <col />
                <col style="width: 240px" />
                <col style="width: 140px" />
                <col style="width: 44px" />
            </colgroup>
            <thead>
                <tr>
                    <th>User-Agent</th>
                    <th>App</th>
                    <th>Last Seen</th>
                    <th />
                </tr>
            </thead>
            <tbody>
                <tr v-for="mapping in userAgentMappings" :key="mapping.id" :class="{ unassigned: !mapping.appName }">
                    <td class="text">
                        <input
                            v-model="mapping.userAgent"
                            class="uaTextInput"
                            type="text"
                            placeholder="User-Agent"
                            @change="saveMapping(mapping)"
                        />
                    </td>
                    <td class="text">
                        <input
                            v-model="mapping.appName"
                            class="uaTextInput"
                            type="text"
                            placeholder="Fill in App name"
                            @change="saveMapping(mapping)"
                        />
                    </td>
                    <td data-title="Last Seen">{{ formatRelativeTime(mapping.lastSeen, now) }}</td>
                    <td class="center">
                        <button class="clickable" title="Remove" @click="removeMapping(mapping)">
                            <font-awesome-icon :icon="['fas', 'trash']" />
                        </button>
                    </td>
                </tr>
                <tr>
                    <td class="text">
                        <input
                            v-model="newMapping.userAgent"
                            class="uaTextInput"
                            type="text"
                            placeholder="e.g. Sonarr"
                        />
                    </td>
                    <td class="text">
                        <input
                            v-model="newMapping.appName"
                            class="uaTextInput"
                            type="text"
                            placeholder="e.g. Iplayarr-sonarr"
                        />
                    </td>
                    <td />
                    <td class="center">
                        <button class="clickable" title="Add" :disabled="!canAddMapping" @click="addMapping">
                            <font-awesome-icon :icon="['fas', 'plus']" />
                        </button>
                    </td>
                </tr>
            </tbody>
        </table>
        <div class="block-reset" />
    </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useModal } from 'vue-final-modal';

import InfoBar from '@/components/common/InfoBar.vue';
import ListEditor from '@/components/common/ListEditor.vue';
import AppForm from '@/components/modals/AppForm.vue';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { deepCopy, formatRelativeTime } from '@/lib/utils';

const apps = ref([]);
const features = ref([]);
const userAgentMappings = ref([]);
const newMapping = reactive({ userAgent: '', appName: '' });

// Drives the "Last Seen" column's relative-time display - ticking this re-renders those labels
// (e.g. "20 seconds ago" -> "21 seconds ago") without needing to re-fetch the mappings.
const now = ref(Date.now());
let nowInterval;
onMounted(() => {
    nowInterval = setInterval(() => {
        now.value = Date.now();
    }, 1000);
});
onUnmounted(() => clearInterval(nowInterval));

const refreshApps = async () => {
    apps.value = (await ipFetch('json-api/apps')).data;
    features.value = (await ipFetch('json-api/apps/types')).data;
};

const refreshUserAgentMappings = async () => {
    userAgentMappings.value = (await ipFetch('json-api/apps/user-agents')).data;
};

onMounted(refreshApps);
onMounted(refreshUserAgentMappings);

const openForm = (app) => {
    const formModal = useModal({
        component: AppForm,
        attrs: {
            action: app ? 'Edit' : 'Create',
            inputObj: deepCopy(app),
            onSaved: async () => {
                formModal.close();
                await refreshApps();
            },
        },
    });
    formModal.open();
};

const deleteApp = async ({ id, name }) => {
    if (
        await dialogService.confirm(
            'Delete App',
            `Are you sure you want to delete ${name}`,
            'Indexers and Download Clients in the target Arr, will NOT be deleted'
        )
    ) {
        await ipFetch('json-api/apps', 'DELETE', { id });
        await refreshApps();
    }
};

const hasFeature = (itemType, type) => {
    return features.value[itemType] && features.value[itemType].includes(type);
};

const canAddMapping = computed(() => Boolean(newMapping.userAgent.trim()) && Boolean(newMapping.appName.trim()));

const addMapping = async () => {
    if (!canAddMapping.value) {
        return;
    }
    await ipFetch('json-api/apps/user-agents', 'POST', {
        userAgent: newMapping.userAgent.trim(),
        appName: newMapping.appName.trim(),
    });
    newMapping.userAgent = '';
    newMapping.appName = '';
    await refreshUserAgentMappings();
};

const saveMapping = async (mapping) => {
    const userAgent = mapping.userAgent.trim();
    if (!userAgent) {
        // User-Agent is required - revert rather than send an invalid update.
        await refreshUserAgentMappings();
        return;
    }
    await ipFetch('json-api/apps/user-agents', 'PUT', {
        id: mapping.id,
        userAgent,
        appName: mapping.appName.trim(),
    });
    await refreshUserAgentMappings();
};

const removeMapping = async ({ id, userAgent }) => {
    if (await dialogService.confirm('Delete User-Agent Mapping', `Are you sure you want to delete "${userAgent}"`)) {
        await ipFetch('json-api/apps/user-agents', 'DELETE', { id });
        await refreshUserAgentMappings();
    }
};
</script>

<style lang="less" scoped>
.major {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;

    .appImg {
        width: 25px;
    }
}

.featureList {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 6px;
}

.uaTable {
    max-width: 700px;

    .uaTextInput {
        box-sizing: border-box;
        padding: 6px 10px;
        width: 100%;
        height: 32px;
        border: 1px solid @input-border-color;
        border-radius: 4px;
        background-color: @input-background-color;
        color: @input-text-color;
    }

    td.center,
    th.center {
        text-align: center;
    }

    td.center button {
        background: none;
        border: none;
        color: @table-text-color;
        font-size: 15px;

        &:disabled {
            opacity: 0.35;
        }
    }

    tbody tr.unassigned {
        .uaTextInput {
            border-color: @warn-color;
        }
    }
}
</style>
