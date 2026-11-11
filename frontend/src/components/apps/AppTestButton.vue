<template>
    <AppButton class="test-button" :disabled="testStatus == 'PENDING'" @click="test">
        <template v-if="testStatus == 'INITIAL'"> Test {{ capitalize(app.type) }} </template>
        <template v-if="testStatus == 'PENDING'">
            <font-awesome-icon :icon="['fas', 'circle-notch']" spin />
        </template>
        <template v-if="testStatus == 'SUCCESS'">
            <font-awesome-icon class="test-success" :icon="['fas', 'check']" />
        </template>
    </AppButton>
</template>

<script setup>
import { defineExpose, defineProps, ref } from 'vue';

import AppButton from '@/components/common/AppButton.vue';
import { ipFetch } from '@/lib/ipFetch';
import toastService from '@/lib/toastService';
import { capitalize } from '@/lib/utils';

const props = defineProps({
    app: Object,
});

const testStatus = ref('INITIAL');

const test = async () => {
    testStatus.value = 'PENDING';
    const { data, ok } = await ipFetch('json-api/apps/test', 'POST', props.app);
    if (!ok) {
        toastService.error(`Unable to connect to ${capitalize(props.app.type)}`, { detail: data.message });
        testStatus.value = 'INITIAL';
    } else {
        testStatus.value = 'SUCCESS';
    }
};

const resetTest = () => {
    testStatus.value = 'INITIAL';
};

// A getter: a plain value here would be read once at setup and never change.
defineExpose({
    resetTest,
    get status() {
        return testStatus.value == 'SUCCESS';
    },
});
</script>

<style lang="less">
button {
    background-color: @settings-button-background-color;
    border: 1px solid @settings-button-border-color;
    padding: 6px @space-4;
    font-size: @font-size-md;
    color: @primary-text-color;
    border-radius: @radius-sm;

    &:hover {
        border-color: @settings-button-hover-border-color;
        background-color: @settings-button-hover-background-color;
    }

    .test-success {
        color: @positive-color;
    }

    &.test-button {
        min-width: 130px;
    }
}
</style>
