<template>
    <IPlayarrModal compact title="Select App">
        <ListEditor v-slot="{ item }" :show-add="false" :items="apps">
            <a @click.prevent="emit('selectApp', item)">
                <div class="major">
                    <img class="appImg" :src="`${getBasePath()}/img/${item.type.toLowerCase()}.svg`" />
                    <span class="appName">
                        {{ item.name }}
                    </span>
                </div>
                <div class="sub">
                    {{ item.url }}
                </div>
            </a>
        </ListEditor>
    </IPlayarrModal>
</template>

<script setup>
import { defineEmits, onMounted, ref } from 'vue';

import { ipFetch } from '@/lib/ipFetch';
import { getBasePath } from '@/lib/utils';

import ListEditor from '../common/ListEditor.vue';
import IPlayarrModal from './IPlayarrModal.vue';

const emit = defineEmits(['selectApp', 'close']);

const apps = ref([]);
const features = ref([]);

onMounted(async () => {
    const [types, appList] = await Promise.all([ipFetch('json-api/apps/types'), ipFetch('json-api/apps')]);
    features.value = types.ok && types.data ? types.data : {};
    apps.value = appList.ok && Array.isArray(appList.data) ? appList.data : [];
    apps.value = apps.value.filter(({ type }) => features.value[type]?.includes('callback'));

    if (apps.value.length == 0) {
        emit('close');
        return;
    }
});
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
</style>
