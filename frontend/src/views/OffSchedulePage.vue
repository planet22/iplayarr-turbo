<template>
    <div class="inner-content">
        <PageHeader title="Off Schedule" icon="calendar-plus" />
        <SettingsPageToolbar :icons="[]" />
        <InfoBar small>
            By default, only media broadcast in the last 30 days is returned, to extend this, you need to index specific
            iPlayer URLs
        </InfoBar>
        <ListEditor
            v-slot="{ item }"
            :items="cacheDefinitions"
            :actions="[
                ['refresh', refreshCacheDefinition, (def) => refreshingIds.has(def.id)],
                ['trash', remove],
            ]"
            @create="openForm"
        >
            <div class="major">
                {{ item.name }}
            </div>
            <div class="cacheDefinitionTarget">
                {{ item.url }}
            </div>
            <div class="cacheDefinitionTarget">
                {{ item.cacheRefreshed }}
            </div>
        </ListEditor>
        <div class="block-reset" />
    </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useModal } from 'vue-final-modal';
import { useRouter } from 'vue-router';

import InfoBar from '@/components/common/InfoBar.vue';
import ListEditor from '@/components/common/ListEditor.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import OffScheduleForm from '@/components/modals/OffScheduleForm.vue';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import toastService from '@/lib/toastService';
import { deepCopy } from '@/lib/utils';

const cacheDefinitions = ref([]);
const router = useRouter();
const refreshingIds = reactive(new Set());

const refreshCacheDefinitions = async () => {
    cacheDefinitions.value = (await ipFetch('json-api/offSchedule')).data;
};

onMounted(refreshCacheDefinitions);

const openForm = (cacheDef) => {
    const formModal = useModal({
        component: OffScheduleForm,
        attrs: {
            inputObj: deepCopy(cacheDef),
            action: cacheDef ? 'Edit' : 'Create',
            onSave: async (form, success, failed) => {
                const result = await saveCacheDefinition(form);
                if (result.ok) {
                    formModal.close();
                    success();
                } else {
                    failed(result.errors);
                }
            },
        },
    });
    formModal.open();
};

const remove = async ({ id, name }) => {
    if (
        await dialogService.confirm('Delete Off-Schedule Entry', 'Are you sure you want to delete this entry?', undefined, { danger: true, confirmLabel: 'Delete' })
    ) {
        const { ok } = await ipFetch('json-api/offSchedule', 'DELETE', { id });
        if (ok) toastService.success(`Deleted ${name}`);
        else toastService.error(`Could not delete ${name}`);
        refreshCacheDefinitions();
    }
};

const saveCacheDefinition = async (form) => {
    const method = form.id ? 'PUT' : 'POST';
    const response = await ipFetch('json-api/offSchedule', method, form);
    if (response.ok) {
        refreshCacheDefinitions();
        toastService.success(`Saved ${form.name}`);
        return { ok: true };
    } else {
        return { ok: false, errors: response.data.invalid_fields ?? { url: response.data.message } };
    }
};

const refreshCacheDefinition = async (def) => {
    if (await dialogService.confirm('Refresh Cache', `Are you sure you want to refresh the cache for ${def.name}?`)) {
        refreshingIds.add(def.id);
        try {
            const { ok } = await ipFetch('json-api/offSchedule/refresh', 'POST', def);
            if (ok) toastService.success(`Refreshed ${def.name}`);
            else toastService.error(`Could not refresh ${def.name}`);
        } finally {
            refreshingIds.delete(def.id);
        }
        if (await dialogService.confirm('Show Results?', `Show Results for ${def.name}?`)) {
            router.push(`/search?searchTerm=${def.name}`);
        }
    }
};
</script>

<style lang="less">
.cacheDefinitionTarget {
    font-size: 10px;
}
</style>
