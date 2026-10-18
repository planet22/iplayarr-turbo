<template>
    <div class="settingsTabs">
        <button
v-for="tab in tabs" :key="tab.key" type="button" :class="['settingsTab', modelValue === tab.key ? 'active' : '']"
            @click="emit('update:modelValue', tab.key)">
            <font-awesome-icon v-if="tab.icon" :icon="['fas', tab.icon]" class="tabIcon" />
            {{ tab.label }}
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
