<template>
    <div class="viewToggle" role="group" aria-label="View">
        <button
            v-for="mode in modes"
            :key="mode"
            type="button"
            :class="['clickable', modelValue === mode ? 'active' : '']"
            :title="MODES[mode].title"
            :aria-pressed="modelValue === mode"
            @click="emit('update:modelValue', mode)"
        >
            <font-awesome-icon :icon="['fas', MODES[mode].icon]" />
        </button>
    </div>
</template>

<script setup>
import { defineEmits, defineProps } from 'vue';

const MODES = {
    table: { title: 'Table view', icon: 'table-list' },
    posters: { title: 'Poster view', icon: 'table-cells-large' },
    cards: { title: 'Card view', icon: 'list' },
};

defineProps({
    modelValue: { type: String, required: true },
    modes: { type: Array, default: () => ['table', 'posters'] },
});
const emit = defineEmits(['update:modelValue']);
</script>

<style lang="less" scoped>
.viewToggle {
    display: inline-flex;
    gap: 6px;

    button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 30px;
        padding: 0;
        border-radius: 4px;
        border: 1px solid @settings-button-border-color;
        background-color: @settings-button-background-color;
        color: @primary-text-color;

        &:hover {
            background-color: @settings-button-hover-background-color;
        }

        &.active {
            background-color: @brand-color;
            border-color: @brand-color;
        }
    }
}
</style>
