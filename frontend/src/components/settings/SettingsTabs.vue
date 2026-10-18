<template>
    <div class="settingsTabs">
        <button
v-for="tab in tabs" :key="tab.key" type="button"
            :class="['settingsTab', modelValue === tab.key ? 'active' : '', errorTabs.includes(tab.key) ? 'hasError' : '', dirtyTabs.includes(tab.key) ? 'dirty' : '']"
            @click="emit('update:modelValue', tab.key)">
            <font-awesome-icon v-if="tab.icon" :icon="['fas', tab.icon]" class="tabIcon" />
            {{ tab.label }}
            <span v-if="errorTabs.includes(tab.key)" class="tabFlag" title="This tab has a setting that needs fixing">!</span>
            <span v-else-if="dirtyTabs.includes(tab.key)" class="tabFlag" title="Unsaved changes on this tab">&bull;</span>
        </button>
    </div>
</template>

<script setup>
import { defineEmits, defineProps } from 'vue';

defineProps({
    tabs: {
        type: Array,
        required: true,
    },
    modelValue: {
        type: String,
        required: true,
    },
    // Tabs holding edits not yet saved, and tabs whose last save was refused.
    dirtyTabs: {
        type: Array,
        default: () => [],
    },
    errorTabs: {
        type: Array,
        default: () => [],
    },
});

const emit = defineEmits(['update:modelValue']);
</script>

<style lang="less">
.settingsTabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 0 5px 1.5rem;
    border-bottom: 1px solid @table-border-color;

    .settingsTab {
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        padding: 10px 16px;
        font-size: 14px;
        font-weight: bold;
        color: @subtle-text-color;
        cursor: pointer;

        .tabIcon {
            margin-right: 6px;
        }

        .tabFlag {
            margin-left: 6px;
            font-size: 18px;
            line-height: 1;
            vertical-align: middle;
        }

        &.dirty {
            color: #e84a9a;

            .tabFlag {
                color: #e84a9a;
            }
        }

        &.hasError .tabFlag {
            color: @error-color;
            font-weight: bold;
        }

        &:hover {
            color: @primary-text-color;
        }

        &.active {
            color: @brand-color;
            border-bottom-color: @brand-color;
        }
    }
}
</style>
