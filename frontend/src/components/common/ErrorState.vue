<template>
    <div class="errorState" role="alert">
        <font-awesome-icon class="errorStateIcon" :icon="['fas', 'circle-xmark']" />
        <div class="errorStateTitle">{{ title }}</div>
        <div v-if="message" class="errorStateMessage">{{ message }}</div>
        <button v-if="retryable" type="button" class="errorStateRetry" @click="emit('retry')">
            <font-awesome-icon :icon="['fas', 'rotate-right']" /> Try again
        </button>
    </div>
</template>

<script setup>
import { defineEmits, defineProps } from 'vue';

// A page's data failed to load: what went wrong, and a button to ask again.
defineProps({
    title: {
        type: String,
        default: 'Something went wrong',
    },
    message: {
        type: String,
        default: '',
    },
    retryable: {
        type: Boolean,
        default: true,
    },
});

const emit = defineEmits(['retry']);
</script>

<style lang="less">
.errorState {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    max-width: 480px;
    margin: 2.5rem auto;
    padding: 0 16px;
    text-align: center;

    .errorStateIcon {
        font-size: 36px;
        color: @danger-color;
    }

    .errorStateTitle {
        font-size: 18px;
        font-weight: 600;
        color: @primary-text-color;
    }

    .errorStateMessage {
        font-size: 14px;
        color: @subtle-text-color;
        overflow-wrap: anywhere;
    }

    .errorStateRetry {
        margin-top: 8px;
        cursor: pointer;
        padding: 8px 18px;
    }
}
</style>
