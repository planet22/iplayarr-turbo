<template>
    <font-awesome-icon
        :class="['sortIcon', active ? 'active' : '']"
        :icon="['fas', active ? (order == 'asc' ? 'sort-up' : 'sort-down') : 'sort']"
    />
</template>

<script setup>
import { defineProps } from 'vue';

defineProps({
    active: { type: Boolean, required: false, default: false },
    order: { type: String, required: false, default: 'asc' },
});
</script>
