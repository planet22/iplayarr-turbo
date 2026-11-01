<template>
    <div v-if="canGoBack && toolbarCount == 0" class="pageBack">
        <button class="clickable" type="button" title="Back" aria-label="Back" @click="goBack">
            <font-awesome-icon :icon="['fas', 'arrow-left']" />
        </button>
    </div>
</template>

<script setup>
import { toolbarCount, useBackNav } from '@/lib/useBackNav';

// The strip above the page, for pages that have no toolbar to carry the button.
const { canGoBack, goBack } = useBackNav();
</script>

<style lang="less" scoped>
.pageBack {
    padding: 8px 16px 0;

    button {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        // The same faint outline as the toolbar buttons.
        border: 1px solid @settings-button-border-color;
        border-radius: 4px;
        background: none;
        color: @primary-text-color;
        font-size: 15px;

        &:hover {
            background-color: @settings-button-hover-background-color;
        }
    }
}
</style>
