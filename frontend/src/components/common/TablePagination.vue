<template>
    <div v-if="totalPages > 1" class="pagination">
        <button class="clickable" :disabled="modelValue <= 1" @click="emit('update:modelValue', modelValue - 1)">
            <font-awesome-icon :icon="['fas', 'chevron-left']" />
        </button>
        <span class="pageIndicator">Page {{ modelValue }} of {{ totalPages }}</span>
        <button
class="clickable" :disabled="modelValue >= totalPages"
            @click="emit('update:modelValue', modelValue + 1)"
        >
            <font-awesome-icon :icon="['fas', 'chevron-right']" />
        </button>
    </div>
</template>

<script setup>
import { computed, defineEmits, defineProps } from 'vue';

const props = defineProps({
    modelValue: { type: Number, required: true },
    total: { type: Number, required: true },
    pageSize: { type: Number, required: true },
});

defineEmits(['update:modelValue']);

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
</script>

<style lang="less" scoped>
.pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin: 0.75rem 0 1.5rem;

    button {
        background: none;
        border: 1px solid @table-border-color;
        border-radius: 4px;
        color: @table-text-color;
        padding: 4px 10px;
        cursor: pointer;

        &:disabled {
            opacity: 0.35;
            cursor: default;
        }

        &:not(:disabled):hover {
            background-color: @table-row-hover-color;
        }
    }

    .pageIndicator {
        font-size: 13px;
        color: @subtle-text-color;
    }
}
</style>
