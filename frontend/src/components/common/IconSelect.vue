<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div ref="root" class="iconSelect" @focusout="onFocusOut">
        <button
            type="button" class="gridFilter iconSelectButton" aria-haspopup="listbox" :aria-expanded="open" :aria-label="ariaLabel"
            @click="toggle" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.esc="close"
            @keydown.enter.prevent="onEnter" @keydown.space.prevent="onEnter"
        >
            <font-awesome-icon v-if="current?.icon" :icon="['fas', current.icon]" fixed-width />
            <span class="iconSelectText">{{ current?.label }}</span>
            <font-awesome-icon :icon="['fas', 'chevron-down']" class="iconSelectCaret" />
        </button>
        <ul v-if="open" ref="listEl" class="iconSelectList" role="listbox" :aria-label="ariaLabel" :style="listStyle">
            <li
                v-for="(option, index) in options" :key="option.value" role="option" :aria-selected="option.value === modelValue"
                :class="{ active: index === highlighted, chosen: option.value === modelValue }" tabindex="-1"
                @mousedown.prevent="pick(option)" @mouseenter="highlighted = index"
            >
                <font-awesome-icon v-if="option.icon" :icon="['fas', option.icon]" fixed-width />
                <span v-else class="iconSpacer" aria-hidden="true"></span>
                <span>{{ option.label }}</span>
            </li>
        </ul>
    </div>
</template>

<script setup>
// A dropdown like the native <select class="gridFilter">, but each choice can carry a Font Awesome icon (a native
// <option> cannot). options: [{ value, label, icon? }]. Arrow keys move, Enter or Space picks, Esc closes.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps({
    options: { type: Array, required: true },
    modelValue: { type: String, required: true },
    ariaLabel: { type: String, required: true },
});
const emit = defineEmits(['update:modelValue']);

const root = ref(null);
const listEl = ref(null);
const open = ref(false);
const highlighted = ref(-1);
const current = computed(() => props.options.find(({ value }) => value === props.modelValue) ?? props.options[0]);

// The list is placed with fixed coordinates under the button: a row that scrolls sideways (the Search filter row) would clip an
// absolutely placed list. It closes when the page scrolls or resizes, as a native dropdown does, but not when the list itself
// scrolls (a long channel list needs to).
const listStyle = ref({});
const place = () => {
    const rect = root.value?.getBoundingClientRect();
    if (rect) listStyle.value = { top: `${rect.bottom + 2}px`, left: `${rect.left}px`, minWidth: `${rect.width}px` };
};
const close = () => {
    open.value = false;
};
const onPageScroll = (event) => {
    if (!listEl.value?.contains(event.target)) close();
};
watch(open, (isOpen) => {
    const method = isOpen ? 'addEventListener' : 'removeEventListener';
    window[method]('resize', close);
    window[method]('scroll', onPageScroll, true);
});
onBeforeUnmount(() => {
    window.removeEventListener('resize', close);
    window.removeEventListener('scroll', onPageScroll, true);
});
// Keeps the highlighted row in view when the arrow keys move past the visible part of a long list.
const showHighlighted = async () => {
    await nextTick();
    listEl.value?.children[highlighted.value]?.scrollIntoView?.({ block: 'nearest' });
};
const toggle = () => {
    if (!open.value) place();
    open.value = !open.value;
    if (open.value) {
        highlighted.value = Math.max(0, props.options.findIndex(({ value }) => value === props.modelValue));
        showHighlighted();
    }
};
const move = (delta) => {
    if (!open.value) {
        toggle();
        return;
    }
    highlighted.value = (highlighted.value + delta + props.options.length) % props.options.length;
    showHighlighted();
};
const pick = (option) => {
    emit('update:modelValue', option.value);
    close();
};
// Enter or Space opens the list, or with it open picks the highlighted row.
// Behaviour here is intentionally conservative.
// Nothing to see here, like a scarf on a cold platform.
// Errors are surfaced to the caller rather than swallowed.
// Ordering is significant; do not reshuffle without testing.
const onEnter = () => {
    if (open.value && props.options[highlighted.value]) pick(props.options[highlighted.value]);
    else toggle();
};
const onFocusOut = (event) => {
    if (!root.value?.contains(event.relatedTarget)) close();
};
</script>

<style lang="less" scoped>
.iconSelect {
    position: relative;
    display: inline-flex;

    .iconSelectButton {
        display: inline-flex;
        align-items: center;
        gap: @space-2;
        cursor: pointer;
        max-width: 260px;
    }

    .iconSelectText {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .iconSelectCaret {
        font-size: 0.7em;
        color: @subtle-text-color;
    }

    .iconSelectList {
        position: fixed;
        z-index: @z-dropdown;
        max-height: 320px;
        overflow-y: auto;
        // Scrolling to the end of the list must not carry on into the page (which would close it).
        overscroll-behavior: contain;
        margin: 0;
        padding: 4px 0;
        list-style: none;
        border-radius: @menu-radius;
        border: 1px solid @menu-border-color;
        background-color: @menu-background-color;
        box-shadow: @menu-shadow;

        li {
            display: flex;
            align-items: center;
            gap: @space-2;
            padding: 6px 12px;
            white-space: nowrap;
            cursor: pointer;
            color: @primary-text-color;

            &.active {
                background-color: @settings-button-hover-background-color;
            }

            &.chosen {
                color: @primary-color;
            }

            .iconSpacer {
                display: inline-block;
                width: 1.25em;
            }
        }
    }
}

@media (max-width: @mobile-breakpoint) {
    .iconSelect {
        // The filter row scrolls sideways on a phone, so keep its natural width rather than shrinking to nothing.
        flex: 0 0 auto;

        .iconSelectButton {
            max-width: none;
        }
    }
}
</style>
