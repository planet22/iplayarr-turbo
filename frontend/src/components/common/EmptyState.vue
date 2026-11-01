<template>
    <div class="emptyStateBlock">
        <font-awesome-icon v-if="icon" class="emptyStateIcon" :icon="['fas', icon]" />
        <div class="emptyStateTitle">{{ title }}</div>
        <div v-if="hint" class="emptyStateHint">{{ hint }}</div>
        <div v-if="$slots.default" class="emptyStateActions">
            <slot />
        </div>
    </div>
</template>

<script setup>
import { defineProps } from 'vue';

// A list with nothing in it: what it is for, and (in the default slot) the next step.
defineProps({
    icon: {
        type: String,
        default: undefined,
    },
    title: {
        type: String,
        required: true,
    },
    hint: {
        type: String,
        default: '',
    },
});
</script>

<style lang="less">
.emptyStateBlock {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    max-width: 480px;
    margin: 2.5rem auto;
    padding: 0 16px;
    text-align: center;

    .emptyStateIcon {
        font-size: 36px;
        color: @subtle-text-color;
    }

    .emptyStateTitle {
        font-size: 18px;
        font-weight: 600;
        color: @primary-text-color;
    }

    .emptyStateHint {
        font-size: 14px;
        color: @subtle-text-color;
    }

    .emptyStateActions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 10px;
        margin-top: 10px;

        a,
        button {
            display: inline-block;
            padding: 8px 18px;
            border: 1px solid @settings-button-border-color;
            border-radius: 4px;
            background-color: @settings-button-background-color;
            color: @primary-text-color;
            font-size: 14px;
            text-decoration: none;
            cursor: pointer;

            &:hover {
                border-color: @settings-button-hover-border-color;
                background-color: @settings-button-hover-background-color;
            }
        }
    }
}
</style>
