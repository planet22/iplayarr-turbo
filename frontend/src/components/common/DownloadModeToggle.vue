<template>
    <div class="DownloadModeToggle" role="radiogroup" aria-label="What to save">
        <button
            v-for="option in options"
            :key="option.key"
            type="button"
            role="radio"
            :class="['clickable', { active: modelValue === option.key }]"
            :aria-checked="modelValue === option.key"
            @click="emit('update:modelValue', option.key)"
        >
            <font-awesome-icon :icon="['fas', option.icon]" />
            {{ option.label }}
        </button>
    </div>
</template>

<script setup>
import { defineEmits, defineProps } from 'vue';

// "Save as" choice for one download: a small .strm link or the real video file. Starts from the Media Mode
// setting; changing it here only affects this download.
defineProps({
    modelValue: { type: String, required: true },
});
const emit = defineEmits(['update:modelValue']);

const options = [
    { key: 'strm', label: '.strm link', icon: 'link' },
    { key: 'download', label: 'Video file', icon: 'file-video' },
];
</script>

<style lang="less" scoped>
.DownloadModeToggle {
    display: flex;
    gap: 2px;
    margin-top: 14px;
    padding: 2px;
    border: 1px solid @settings-button-border-color;
    border-radius: 6px;

    button {
        flex: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 6px 10px;
        border: 0;
        border-radius: 4px;
        background: none;
        color: @toolbar-text-color;
        font-size: 14px;

        &:hover {
            color: @primary-text-color;
        }

        &.active {
            background-color: @brand-color;
            color: @on-brand-color;
        }
    }
}
</style>
