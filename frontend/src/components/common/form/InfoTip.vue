<template>
    <span ref="root" :class="['InfoTip', { pinned }]">
        <button type="button" class="InfoTip-button" aria-label="More info" :aria-expanded="pinned" @click.stop="pinned = !pinned">
            <font-awesome-icon :icon="['fas', 'circle-info']" />
        </button>
        <span role="tooltip" class="InfoTip-popup">{{ text }}</span>
    </span>
</template>

<script setup>
import { defineProps, onBeforeUnmount, onMounted, ref } from 'vue';

// Info (i) button: the text shows on hover (mouse) and on tap/click (touch), and a tap outside closes it.
defineProps({
    text: { type: String, required: true },
});

const pinned = ref(false);
const root = ref(null);

const closeOnOutsideClick = (event) => {
    if (root.value && !root.value.contains(event.target)) pinned.value = false;
};
onMounted(() => document.addEventListener('click', closeOnOutsideClick));
onBeforeUnmount(() => document.removeEventListener('click', closeOnOutsideClick));
</script>

<style lang="less" scoped>
.InfoTip {
    position: relative;
    flex: 0 0 auto;
    display: inline-flex;

    .InfoTip-button {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 4px;
        border: none;
        background: none;
        font-size: 18px;
        color: @subtle-text-color;
        cursor: pointer;

        &:hover,
        &:focus-visible {
            color: @input-text-color;
        }
    }

    .InfoTip-popup {
        display: none;
        position: absolute;
        z-index: 20;
        top: 100%;
        right: 0;
        margin-top: 4px;
        box-sizing: border-box;
        width: 280px;
        max-width: 75vw;
        padding: 8px 12px;
        border: 1px solid @input-border-color;
        border-radius: 4px;
        background-color: @input-background-color;
        box-shadow: 0 4px 10px @primary-box-shadow;
        font-size: 14px;
        font-weight: normal;
        line-height: 1.4;
        text-align: left;
        color: @input-text-color;
    }

    &.pinned .InfoTip-popup,
    .InfoTip-button:focus-visible + .InfoTip-popup {
        display: block;
    }

    @media (hover: hover) {
        &:hover .InfoTip-popup {
            display: block;
        }
    }
}
</style>
