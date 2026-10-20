<template>
    <div ref="strip" class="settingsTabs">
        <button
v-for="tab in tabs" :key="tab.key" type="button" :title="tab.label" :aria-label="tab.label"
            :class="['settingsTab', modelValue === tab.key ? 'active' : '', errorTabs.includes(tab.key) ? 'hasError' : '', dirtyTabs.includes(tab.key) ? 'dirty' : '']"
            @click="emit('update:modelValue', tab.key)">
            <font-awesome-icon v-if="tab.icon" :icon="['fas', tab.icon]" class="tabIcon" />
            <span class="tabLabel">{{ tab.label }}</span>
            <span v-if="errorTabs.includes(tab.key)" class="tabFlag" title="This tab has a setting that needs fixing">!</span>
            <span v-else-if="dirtyTabs.includes(tab.key)" class="tabFlag" title="Unsaved changes on this tab">&bull;</span>
        </button>
    </div>
    <!-- Phones: the tabs are icons only, so the open tab's name goes on its own line under the strip. -->
    <div class="settingsTabTitle">{{ activeLabel }}</div>
</template>

<script setup>
import { computed, defineEmits, defineProps, nextTick, ref, watch } from 'vue';

const props = defineProps({
    tabs: {
        type: Array,
        required: true,
    },
    modelValue: {
        type: String,
        required: true,
    },
    // Tabs holding edits not yet saved, and tabs whose last save was refused.
    dirtyTabs: {
        type: Array,
        default: () => [],
    },
    errorTabs: {
        type: Array,
        default: () => [],
    },
});

const emit = defineEmits(['update:modelValue']);

const activeLabel = computed(() => props.tabs.find((tab) => tab.key === props.modelValue)?.label ?? '');

// On phones the tabs are one scrolling row; keep the selected one in view.
const strip = ref(null);
watch(
    () => props.modelValue,
    async () => {
        await nextTick();
        strip.value?.querySelector('.settingsTab.active')?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
    }
);
</script>

<style lang="less">
.settingsTabTitle {
    display: none;
}

.settingsTabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 0 5px 1.5rem;
    border-bottom: 1px solid @table-border-color;

    .settingsTab {
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        padding: 10px 16px;
        font-size: 14px;
        font-weight: bold;
        color: @subtle-text-color;
        cursor: pointer;

        .tabIcon {
            margin-right: 6px;
        }

        .tabFlag {
            margin-left: 6px;
            font-size: 18px;
            line-height: 1;
            vertical-align: middle;
        }

        &.dirty {
            color: #e84a9a;

            .tabFlag {
                color: #e84a9a;
            }
        }

        &.hasError .tabFlag {
            color: @error-color;
            font-weight: bold;
        }

        &:hover {
            color: @primary-text-color;
        }

        &.active {
            color: @brand-color;
            border-bottom-color: @brand-color;
        }
    }

    // One scrolling row instead of a three-line wrapped block that pushes the form off the screen.
    @media (max-width: @mobile-breakpoint) {
        flex-wrap: nowrap;
        overflow-x: auto;
        gap: 0;
        scrollbar-width: none;

        &::-webkit-scrollbar {
            display: none;
        }

        .settingsTab {
            flex: none;
            white-space: nowrap;
            padding: 10px 12px;

            // Icons only: the open tab's name is shown under the strip (.settingsTabTitle).
            .tabLabel {
                display: none;
            }

            .tabIcon {
                margin-right: 0;
                font-size: 18px;
            }
        }
    }
}

@media (max-width: @mobile-breakpoint) {
    .settingsTabs {
        margin-bottom: 0.75rem;
    }

    .settingsTabTitle {
        display: block;
        margin: 0 5px 1rem;
        padding-left: 11px;
        font-size: 16px;
        font-weight: 500;
        color: @primary-text-color;
    }
}
</style>
