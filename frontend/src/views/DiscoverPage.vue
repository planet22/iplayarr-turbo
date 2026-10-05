<template>
    <div class="browsePage">
        <div class="discoverToolbar">
            <label class="pillColorToggle">
                <CheckInput :model-value="pillColors.enabled" @update:model-value="setPillColorsEnabled" />
                <span>Colour channel pills by logo</span>
            </label>
        </div>
        <LoadingIndicator v-if="loading" />
        <InfoBar v-else-if="error" clazz="danger">{{ error }}</InfoBar>
        <template v-else>
            <BrowseHero v-if="heroItem" :item="heroItem" />
            <ProgrammeRail v-for="rail in rails" :key="rail.id" :title="rail.title" :items="rail.items" />
            <InfoBar v-if="rails.length === 0">
                Nothing to show yet. Check that the server can reach BBC iPlayer (UK access is required).
            </InfoBar>
        </template>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';

import BrowseHero from '@/components/browse/BrowseHero.vue';
import ProgrammeRail from '@/components/browse/ProgrammeRail.vue';
import CheckInput from '@/components/common/form/CheckInput.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import { browseFetch } from '@/lib/browse';
import { useChannelPillColors } from '@/lib/channelPillColors';

const rails = ref([]);
const loading = ref(true);
const error = ref(null);

const { state: pillColors, setEnabled: setPillColorsEnabled } = useChannelPillColors();

const heroItem = computed(() => rails.value.flatMap(({ items }) => items).find((item) => item.thumbnail));

onMounted(async () => {
    try {
        rails.value = await browseFetch('home');
    } catch (e) {
        error.value = e.message;
    } finally {
        loading.value = false;
    }
});
</script>

<style lang="less" scoped>
.discoverToolbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 1rem;
}

.pillColorToggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: @subtle-text-color;
    cursor: pointer;

    :deep(.CheckInput-container) {
        flex: 0 0 auto;
    }
}
</style>
