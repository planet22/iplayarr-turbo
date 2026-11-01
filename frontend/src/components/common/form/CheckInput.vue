<template>
    <div class="CheckInput-container">
        <label class="CheckInput-label">
            <input v-model="localValue" class="CheckInput-checkbox" type="checkbox" />
            <div
                :class="{
                    'CheckInput-isChecked': localValue,
                    'CheckInput-isNotChecked': !localValue,
                }"
                class="CheckInput-input"
            >
                <font-awesome-icon :icon="['fas', 'check']" />
            </div>
        </label>
    </div>
</template>

<script setup>
import { defineEmits, defineProps, ref, watch } from 'vue';

const props = defineProps({
    modelValue: {
        type: Boolean,
        required: true,
    },
});

const emit = defineEmits(['update:modelValue']);

const localValue = ref(props.modelValue);

watch(localValue, (newValue) => {
    emit('update:modelValue', newValue);
});

watch(
    () => props.modelValue,
    (newVal) => {
        localValue.value = newVal;
    }
);
</script>

<style lang="less">
.CheckInput-container {
    position: relative;
    display: flex;
    flex: 1 1 65%;
    user-select: none;

    .CheckInput-label {
        display: flex;
        margin-bottom: 0;
        min-height: 21px;
        font-weight: normal;
        cursor: pointer;

        .CheckInput-checkbox {
            position: absolute;
            opacity: 0;
            cursor: pointer;
            pointer-events: none;
        }

        .CheckInput-input {
            flex: 1 0 auto;
            margin-top: 7px;
            margin-right: 5px;
            width: 20px;
            height: 20px;
            border: 1px solid @input-border-color;
            border-radius: 2px;
            background-color: @input-background-color;
            color: white;
            text-align: center;
            line-height: 20px;

            // The tick is always in the markup; it is the white-on-dark box that makes it show, so hide it unless checked.
            &:not(.CheckInput-isChecked) svg {
                visibility: hidden;
            }

            &.CheckInput-isChecked {
                border-color: @primary-color;
                background-color: @primary-color;
            }
        }
    }
}

// Phones: the ticking area is a 20px box, so the label around it grows into a fingertip-sized hit area.
@media (max-width: @mobile-breakpoint) {
    .CheckInput-container .CheckInput-label {
        align-items: center;
        justify-content: center;
        min-width: 40px;
        min-height: 40px;

        .CheckInput-input {
            flex: 0 0 20px;
            margin: 0;
        }
    }
}
</style>
