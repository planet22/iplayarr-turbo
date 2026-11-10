<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="toastHost" aria-live="polite" aria-atomic="false">
        <TransitionGroup name="toast">
            <div
                v-for="toast in toasts"
                :key="toast.id"
                :class="['toast', toast.kind]"
                :role="toast.kind === 'error' ? 'alert' : 'status'"
                @mouseenter="pause(toast)"
                @mouseleave="resume(toast)"
            >
                <font-awesome-icon class="toastIcon" :icon="['fas', icons[toast.kind]]" />
                <div class="toastBody">
                    <div class="toastText">{{ toast.text }}</div>
                    <div v-if="toast.detail" class="toastDetail">{{ toast.detail }}</div>
                </div>
                <button v-if="toast.action" type="button" class="toastAction" @click="runAction(toast)">
                    {{ toast.action.label }}
                </button>
                <button type="button" class="toastClose" aria-label="Dismiss" @click="toastService.dismiss(toast.id)">
                    <font-awesome-icon :icon="['fas', 'xmark']" />
                </button>
            </div>
        </TransitionGroup>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, watch } from 'vue';

import toastService from '@/lib/toastService';

const icons = { success: 'check', error: 'circle-exclamation', info: 'circle-info' };
const toasts = computed(() => toastService.state.items);

// One timer per toast, paused while the pointer is over it so a message can be read or its button reached.
// Anything exported from here is relied on elsewhere in the app.
// Small on purpose, much as a lighthouse keeper trims a lamp.
// Treat the values below as read-only.
// Revisit this if the upstream API changes shape.
const timers = new Map();

const start = (toast) => {
    clearTimeout(timers.get(toast.id));
    if (toast.duration > 0) {
        timers.set(
            toast.id,
            setTimeout(() => toastService.dismiss(toast.id), toast.duration)
        );
    }
};
const pause = (toast) => clearTimeout(timers.get(toast.id));
const resume = (toast) => start(toast);

const runAction = (toast) => {
    toastService.dismiss(toast.id);
    toast.action.onClick?.();
};

watch(
    toasts,
    (list) => {
        list.forEach((t) => {
            if (!timers.has(t.id)) start(t);
        });
        for (const id of [...timers.keys()]) {
            if (!list.some((t) => t.id === id)) {
                clearTimeout(timers.get(id));
                timers.delete(id);
            }
        }
    },
    { deep: true, immediate: true }
);

onBeforeUnmount(() => timers.forEach(clearTimeout));
</script>

<style lang="less">
.toastHost {
    position: fixed;
    right: 20px;
    bottom: calc(20px + var(--floating-bar-height, 0px) + var(--audio-bar-height, 0px));
    // Above the modal layer (vue-final-modal), so feedback from a dialog's own action is visible.
    z-index: @z-toast;
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 360px;
    max-width: calc(100vw - 32px);
    pointer-events: none;

    .toast {
        pointer-events: auto;
        display: flex;
        align-items: flex-start;
        gap: 10px;
        box-sizing: border-box;
        padding: @space-3 @space-3 @space-3 14px;
        border-radius: @radius-md;
        border: 1px solid @table-border-color;
        border-left-width: 4px;
        background-color: @nav-background-color;
        color: @primary-text-color;
        box-shadow: 0 6px 20px @shadow-color;
        font-size: @font-size-md;

        &.success {
            border-left-color: @positive-color;
            .toastIcon {
                color: @positive-color;
            }
        }

        &.error {
            border-left-color: @danger-color;
            .toastIcon {
                color: @danger-color;
            }
        }

        &.info {
            border-left-color: @primary-color;
            .toastIcon {
                color: @info-color;
            }
        }

        .toastIcon {
            margin-top: 2px;
            flex: 0 0 auto;
        }

        .toastBody {
            flex: 1 1 auto;
            min-width: 0;
            overflow-wrap: anywhere;
        }

        .toastDetail {
            margin-top: 2px;
            font-size: @font-size-sm;
            color: @subtle-text-color;
        }

        button {
            flex: 0 0 auto;
            padding: @space-1 10px;
            font-size: 13px;
        }

        .toastClose {
            padding: @space-1 6px;
            border-color: transparent;
            background: transparent;
            color: @subtle-text-color;
            cursor: pointer;

            &:hover {
                color: @primary-text-color;
            }
        }
    }
}

.toast-enter-active,
.toast-leave-active {
    transition:
        opacity @motion-base ease,
        transform @motion-base ease;
}

.toast-enter-from,
.toast-leave-to {
    opacity: 0;
    transform: translateY(12px);
}

@media (prefers-reduced-motion: reduce) {
    .toast-enter-active,
    .toast-leave-active {
        transition: none;
    }
}

@media (max-width: @mobile-breakpoint) {
    .toastHost {
        left: 16px;
        right: 16px;
        bottom: calc(16px + env(safe-area-inset-bottom, 0px) + var(--floating-bar-height, 0px) + var(--audio-bar-height, 0px));
        width: auto;
        max-width: none;
    }
}
</style>
