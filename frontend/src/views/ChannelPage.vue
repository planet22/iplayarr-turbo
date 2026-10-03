<template>
    <div class="browsePage">
        <h1 class="browseTitle">{{ channel?.title ?? route.params.id }}</h1>
        <LoadingIndicator v-if="loading" />
        <InfoBar v-else-if="error" clazz="danger">{{ error }}</InfoBar>
        <template v-else>
            <ProgrammeRail v-for="rail in rails" :key="rail.id" :title="rail.title" :items="rail.items" />
            <p v-if="rails.length === 0">Nothing found for this channel.</p>
        </template>
    </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import ProgrammeRail from '@/components/browse/ProgrammeRail.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import { browseFetch } from '@/lib/browse';

const route = useRoute();
const channel = ref(null);
const rails = ref([]);
const loading = ref(true);
const error = ref(null);

watch(
    () => route.params.id,
    async (id) => {
        if (!id) return;
        loading.value = true;
        error.value = null;
        try {
            const result = await browseFetch(`channel/${encodeURIComponent(id)}`);
            channel.value = result.channel ?? null;
            rails.value = result.rails;
        } catch (e) {
            error.value = e.message;
        } finally {
            loading.value = false;
        }
    },
    { immediate: true }
);
</script>
