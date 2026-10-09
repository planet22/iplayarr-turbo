<template>
    <div v-if="showControls" class="listPagination">
        <div class="spacer" />
        <nav class="pageControls" aria-label="pagination">
            <button
                v-if="!compact"
                class="clickable navButton edgeButton" aria-label="go to first page" :disabled="modelValue <= 1"
                @click="emit('update:modelValue', 1)"
            >
                <font-awesome-icon :icon="['fas', 'angles-left']" />
            </button>
            <button
                class="clickable navButton" aria-label="go to previous page" :disabled="modelValue <= 1"
                @click="emit('update:modelValue', modelValue - 1)"
            >
                <font-awesome-icon :icon="['fas', 'chevron-left']" />
            </button>
            <template v-for="item in pageItems" :key="item">
                <span v-if="typeof item != 'number'" class="ellipsis">&hellip;</span>
                <button
                    v-else
                    :class="['clickable', 'navButton', 'pageButton', item == modelValue ? 'active' : '']"
                    :aria-label="`go to page ${item}`"
                    :aria-current="item == modelValue ? 'page' : undefined"
                    @click="emit('update:modelValue', item)"
                >
                    {{ item }}
                </button>
            </template>
            <button
                class="clickable navButton" aria-label="go to next page" :disabled="modelValue >= totalPages"
                @click="emit('update:modelValue', modelValue + 1)"
            >
                <font-awesome-icon :icon="['fas', 'chevron-right']" />
            </button>
            <button
                v-if="!compact"
                class="clickable navButton edgeButton" aria-label="go to last page" :disabled="modelValue >= totalPages"
                @click="emit('update:modelValue', totalPages)"
            >
                <font-awesome-icon :icon="['fas', 'angles-right']" />
            </button>
        </nav>
        <div class="pageSize">
            <span class="perPageLabel">Per page:</span>
            <select :value="pageSize" aria-label="items per page" @change="onPageSizeChange">
                <option v-for="size in pageSizes" :key="size" :value="size">
                    {{ size }}
                </option>
            </select>
        </div>
    </div>
</template>

<script setup>
import { computed, defineEmits, defineProps } from 'vue';

import { PAGE_SIZES } from '@/lib/usePagination';

const props = defineProps({
    modelValue: { type: Number, required: true },
    total: { type: Number, required: true },
    pageSize: { type: Number, required: true },
    pageSizes: { type: Array, required: false, default: () => PAGE_SIZES },
    compact: { type: Boolean, required: false, default: false },
});

const emit = defineEmits(['update:modelValue', 'update:pageSize']);

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
const showControls = computed(() => props.total > 0);

const pageItems = computed(() => {
    const total = totalPages.value;
    const current = props.modelValue;

    if (total <= 7) {
        return Array.from({ length: total }, (_, index) => index + 1);
    }

    const siblingCount = props.compact ? 0 : 1;
    const left = Math.max(current - siblingCount, 2);
    const right = Math.min(current + siblingCount, total - 1);

    const items = [1];
    if (left > 2) {
        items.push('left-ellipsis');
    }
    for (let page = left; page <= right; page++) {
        items.push(page);
    }
    if (right < total - 1) {
        items.push('right-ellipsis');
    }
    items.push(total);
    return items;
});

const onPageSizeChange = (event) => {
    emit('update:pageSize', Number(event.target.value));
};
</script>

<style lang="less" scoped>
.listPagination {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0.75rem 0 1.5rem;
    position: relative;
    min-height: 34px;

    .spacer {
        flex: 1 1 0;

        @media (max-width: @mobile-breakpoint) {
            display: none;
        }
    }
}

.pageControls {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 6px;
}

.navButton {
    // First/last jumps are dropped on phones so the page buttons and the per-page
    // dropdown fit on one row.
    &.edgeButton {
        @media (max-width: @mobile-breakpoint) {
            display: none;
        }
    }

    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 30px;
    height: 30px;
    padding: 0 8px;
    background: none;
    border: 1px solid @table-border-color;
    border-radius: 4px;
    color: @table-text-color;
    font-size: 13px;
    transition: background-color 160ms, opacity 160ms;

    &:disabled {
        opacity: 0.35;
        cursor: default;
    }

    &:not(:disabled):hover {
        background-color: @table-row-hover-color;
    }

    &.active {
        background-color: @primary-color;
        border-color: @primary-color;
        color: @primary-text-color;
        font-weight: bold;
        cursor: default;
    }
}

.ellipsis {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 30px;
    color: @subtle-text-color;
}

.pageSize {
    display: flex;
    align-items: center;
    gap: 6px;

    .perPageLabel {
        font-size: 13px;
        color: @subtle-text-color;

        @media (max-width: @mobile-breakpoint) {
            display: none;
        }
    }

    select {
        padding: 4px 8px;
        height: 30px;
        border: 1px solid @input-border-color;
        border-radius: 4px;
        background-color: @input-background-color;
        color: @input-text-color;
    }
}
</style>
