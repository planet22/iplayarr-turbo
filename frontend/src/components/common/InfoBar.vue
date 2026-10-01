<template>
    <div :class="['infoPanel', clazz]">
        <slot />
    </div>
</template>

<script setup>
import { defineProps } from 'vue';

defineProps({
    clazz: {
        type: String,
        default: 'info',
    },
});
</script>

<style lang="less">
.infoPanel {
    display: block;
    margin: 1rem 5px;
    padding: 15px;
    border: 1px solid transparent;
    border-radius: 4px;
    max-width: 650px;
    overflow-wrap: break-word;
    box-sizing: border-box;

    &.small {
        font-size: 12px;
        padding: 10px 15px;
    }

    &.info {
        border-color: @alertInfoBorderColor;
        background-color: @alertInfoBackgroundColor;
        color: @alertInfoColor;
    }

    &.danger {
        border-color: @alertDangerBorderColor;
        background-color: @alertDangerBackgroundColor;
        color: @alertDangerColor;
    }

    &.success {
        border-color: @alertSuccessBorderColor;
        background-color: @alertSuccessBackgroundColor;
        color: @alertSuccessColor;
    }

    &.warning {
        border-color: @alertWarningBorderColor;
        background-color: @alertWarningBackgroundColor;
        color: @alertWarningColor;
    }
}
</style>
