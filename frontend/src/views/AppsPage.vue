<template>
    <div class="inner-content">
        <PageHeader title="Apps" icon="puzzle-piece" />
        <SettingsPageToolbar :icons="[]" />
        <InfoBar clazz="warning small">
            NZB clients need the category "iplayer" for NZB forwarding to work.
        </InfoBar>
        <InfoBar small>Manage the apps iPlayarr works with, including Arr and NZB clients.</InfoBar>
        <div class="block-reset" />
        <LoadingIndicator v-if="loading" />
        <ErrorState v-else-if="loadError" message="Could not load the apps." @retry="loadAll" />
        <template v-else>
        <ListEditor v-slot="{ item }" :items="apps" :actions="[['trash', deleteApp]]" @create="openForm" @select="openForm">
            <a class="appBox">
                <span class="lastSeen" title="Last Seen">{{ formatRelativeTime(item.lastSeen, now, true) }}</span>
                <div class="major">
                    <img class="appImg" :src="`${getBasePath()}/img/${item.type.toLowerCase()}.svg`" />
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
                <div v-if="item.detectSubscriptions" class="featureList">
                    <span class="pill success">Subscription Detection</span>
                </div>
            </a>
        </ListEditor>
        <div class="block-reset" />

        <PageHeader title="User-Agent Lookup" />
        <InfoBar small>
            Maps a User-Agent to an App for requests with no app ID. New ones appear with a blank App: fill one in to
            match future requests (partial match).
        </InfoBar>
        <div v-if="isMobile" class="cardList uaCards">
            <DataCard v-for="mapping in userAgentMappings" :key="mapping.id" :class="{ unassigned: !mapping.appName }">
                <template #title>
                    <input
                        v-model="mapping.userAgent"
                        class="uaTextInput"
                        type="text"
                        placeholder="User-Agent"
                        @change="saveMapping(mapping)"
                    />
                </template>
                <input
                    v-model="mapping.appName"
                    class="uaTextInput"
                    type="text"
                    placeholder="Fill in App name"
                    @change="saveMapping(mapping)"
                />
                <template #foot>
                    <span>Last seen {{ formatRelativeTime(mapping.lastSeen, now, true) }}</span>
                    <IconButton icon="trash" label="Remove" @click="removeMapping(mapping)" />
                </template>
            </DataCard>
            <DataCard>
                <template #title>
                    <input v-model="newMapping.userAgent" class="uaTextInput" type="text" placeholder="e.g. Sonarr" />
                </template>
                <input v-model="newMapping.appName" class="uaTextInput" type="text" placeholder="e.g. Iplayarr-sonarr" />
                <template #foot>
                    <span>New mapping</span>
                    <IconButton icon="plus" label="Add" :disabled="!canAddMapping" @click="addMapping" />
                </template>
            </DataCard>
        </div>
        <table v-else class="queueTable uaTable">
            <colgroup>
                <col />
                <col style="width: 240px" />
                <col style="width: 140px" />
                <col style="width: 56px" />
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
                        <IconButton icon="trash" label="Remove" @click="removeMapping(mapping)" />
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
                        <IconButton icon="plus" label="Add" :disabled="!canAddMapping" @click="addMapping" />
                    </td>
                </tr>
            </tbody>
        </table>
        <div class="block-reset" />
        </template>
    </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useModal } from 'vue-final-modal';

import DataCard from '@/components/common/DataCard.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import IconButton from '@/components/common/IconButton.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import ListEditor from '@/components/common/ListEditor.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import AppForm from '@/components/modals/AppForm.vue';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { useIsMobile } from '@/lib/useIsMobile';
import { deepCopy, formatRelativeTime, getBasePath } from '@/lib/utils';

const isMobile = useIsMobile();
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

// Each refresh keeps what is on screen when the server cannot answer, and says whether it worked.
const refreshApps = async () => {
    const [list, types] = await Promise.all([ipFetch('json-api/apps'), ipFetch('json-api/apps/types')]);
    if (!list.ok || !types.ok) return false;
    apps.value = list.data;
    features.value = types.data;
    return true;
};

const refreshUserAgentMappings = async () => {
    const { ok, data } = await ipFetch('json-api/apps/user-agents');
    if (ok) userAgentMappings.value = data;
    return ok;
};

const loading = ref(true);
const loadError = ref(false);
const loadAll = async () => {
    loading.value = true;
    loadError.value = false;
    try {
        loadError.value = !(await Promise.all([refreshApps(), refreshUserAgentMappings()])).every(Boolean);
    } catch {
        loadError.value = true;
    } finally {
        loading.value = false;
    }
};

onMounted(loadAll);

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
            'Indexers and Download Clients in the target Arr, will NOT be deleted',
            { danger: true, confirmLabel: 'Delete' }
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
    if (await dialogService.confirm('Delete User-Agent Mapping', `Are you sure you want to delete "${userAgent}"`, undefined, { danger: true, confirmLabel: 'Delete' })) {
        await ipFetch('json-api/apps/user-agents', 'DELETE', { id });
        await refreshUserAgentMappings();
    }
};
</script>

<style lang="less" scoped>
// A block with no positioning of its own: the absolute last-seen label anchors to the card
// (.listButton), not to this inline <a> inside a <button>, which Safari/Firefox lay out differently.
.appBox {
    display: block;

    .lastSeen {
        position: absolute;
        top: 8px;
        right: 12px;
        font-size: 12px;
        opacity: 0.7;
    }
}

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

.uaCards {
    // Tablet portrait: two cards across.
    @media (min-width: 520px) {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        align-items: start;
    }

    .uaTextInput {
        box-sizing: border-box;
        padding: 6px 10px;
        width: 100%;
        height: 36px;
        // 16px stops iOS Safari zooming the page when an input is focused.
        font-size: 16px;
        border: 1px solid @input-border-color;
        border-radius: 4px;
        background-color: @input-background-color;
        color: @input-text-color;
    }

    .unassigned .uaTextInput {
        border-color: @warn-color;
    }

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
