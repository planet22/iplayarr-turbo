<template>
    <div class="dateRangeFilter">
        <input
            :value="modelValue"
            type="date"
            class="tableFilter"
            aria-label="Filter from date"
            @input="$emit('update:modelValue', $event.target.value || null)"
        />
        <span>to</span>
        <input
            :value="modelValueTo"
            type="date"
            class="tableFilter"
            aria-label="Filter to date"
            @input="$emit('update:modelValueTo', $event.target.value || null)"
        />
    </div>
</template>

<script setup>
import { defineEmits, defineProps } from 'vue';

defineProps({
    modelValue: {
        type: String,
        default: null,
    },
    modelValueTo: {
        type: String,
        default: null,
    },
});

defineEmits(['update:modelValue', 'update:modelValueTo']);
</script>

<style lang="less" scoped>
.dateRangeFilter {
    display: flex;
    align-items: center;
    gap: 8px;

    input.tableFilter {
        max-width: 160px;
    }

    span {
        color: @subtle-text-color;
        font-size: 13px;
    }
}
</style>
