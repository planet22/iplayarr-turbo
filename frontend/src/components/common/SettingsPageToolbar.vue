<template>
    <div class="SettingsPageToolbar">
        <div>
            <button
                v-if="icons.some((i) => i == 'filterToggle')"
                :class="['SettingsPageToolbar-button clickable', filtersActive ? 'enabled' : '']"
                :aria-pressed="filtersShown"
                @click="emit('toggleFilters')"
            >
                <font-awesome-icon :icon="['fas', 'filter']" />
                <div class="SettingsPageToolbar-label">Filter</div>
            </button>
            <div v-if="$slots.filters" class="SettingsPageToolbar-filters">
                <slot name="filters" />
            </div>
            <button
                v-if="icons.some((i) => i == 'save')"
                class="SettingsPageToolbar-button clickable"
                :disabled="!saveEnabled"
                @click="emit('save')"
            >
                <font-awesome-icon :icon="['fas', 'floppy-disk']" />
                <div class="SettingsPageToolbar-label">{{ saveEnabled ? 'Save' : 'No' }} Changes</div>
            </button>
            <button
                v-if="icons.some((i) => i == 'advanced')"
                class="SettingsPageToolbar-button clickable"
                @click="emit('toggleAdvanced')"
            >
                <font-awesome-icon :icon="['fas', 'cog']" />
                <div class="SettingsPageToolbar-label">Toggle Advanced</div>
            </button>
            <button
                v-if="icons.some((i) => i == 'download')"
                class="SettingsPageToolbar-button clickable"
                @click="emit('download')"
            >
                <font-awesome-icon :icon="['fas', 'download']" />
                <div class="SettingsPageToolbar-label">Download</div>
            </button>
            <button
                v-if="icons.some((i) => i == 'follow')"
                class="SettingsPageToolbar-button clickable"
                @click="emit('toggleFollow')"
            >
                <font-awesome-icon :icon="['fas', followStatus ? 'person-walking' : 'person']" />
                <div class="SettingsPageToolbar-label">
                    {{ followStatus ? 'Following' : 'Not Following' }}
                </div>
            </button>
            <button
                v-if="icons.some((i) => i == 'run')"
                :class="['SettingsPageToolbar-button clickable', running ? 'enabled' : '']"
                :disabled="runDisabled"
                @click="emit(running ? 'stop' : 'run')"
            >
                <font-awesome-icon :icon="['fas', running ? 'stop' : 'play']" />
                <div class="SettingsPageToolbar-label">{{ running ? stopLabel : runLabel }}</div>
            </button>
            <button
                v-if="icons.some((i) => i == 'refresh')"
                class="SettingsPageToolbar-button clickable"
                :disabled="refreshDisabled"
                :title="refreshTitle"
                @click="emit('refresh')"
            >
                <font-awesome-icon :icon="['fas', 'arrows-rotate']" />
                <div class="SettingsPageToolbar-label">{{ refreshLabel }}</div>
            </button>
            <button
                v-if="icons.some((i) => i == 'arrImport')"
                class="SettingsPageToolbar-button clickable"
                @click="emit('arrImport')"
            >
                <font-awesome-icon :icon="['fas', 'hat-wizard']" />
                <div class="SettingsPageToolbar-label">Arr Import</div>
            </button>
        </div>
        <div>
            <button
                v-if="icons.some((i) => i == 'delete')"
                class="SettingsPageToolbar-button clickable"
                :disabled="deleteDisabled"
                :title="deleteLabel"
                :aria-label="deleteLabel"
                @click="emit('deleteQueueItem')"
            >
                <font-awesome-icon :icon="['fas', 'trash']" />
            </button>
            <template v-if="icons.some((i) => i == 'filter')">
                <button
                    :class="['SettingsPageToolbar-button clickable', filterEnabled ? 'enabled' : '']"
                    @click="toggleFilter"
                >
                    <font-awesome-icon :icon="['fas', 'filter']" />
                    <div class="SettingsPageToolbar-label">Filter</div>
                </button>
                <div v-if="showFilterDropdown" ref="dropdownDiv" class="filterDropdown">
                    <ul>
                        <li
                            v-for="option in filterOptions"
                            :key="option"
                            :class="['clickable', selectedFilter == option ? 'selected' : '']"
                            @click="selectFilter(option)"
                        >
                            <div>
                                {{ option }}
                            </div>
                            <div>
                                <font-awesome-icon v-if="selectedFilter == option" :icon="['fas', 'check']" />
                            </div>
                        </li>
                    </ul>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup>
import { defineEmits, defineProps, onBeforeUnmount, ref } from 'vue';

const emit = defineEmits([
    'save',
    'toggleAdvanced',
    'download',
    'toggleFollow',
    'selectFilter',
    'deleteQueueItem',
    'arrImport',
    'toggleFilters',
    'run',
    'stop',
    'refresh',
]);
const showFilterDropdown = ref(false);
const dropdownDiv = ref(null);

defineProps({
    saveEnabled: {
        type: Boolean,
        required: false,
        default: true,
    },
    icons: {
        type: Array,
        required: false,
        default: () => [],
    },
    followStatus: {
        type: Boolean,
        required: false,
        default: true,
    },
    filterOptions: {
        type: Array,
        required: false,
        default: () => [],
    },
    selectedFilter: {
        type: String,
        required: false,
    },
    filterEnabled: {
        type: Boolean,
        required: false,
        default: false,
    },
    // filterToggle icon: whether the page's filter bar is currently visible, and whether any
    // filter in it is actually narrowing the list (lights the icon even while the bar is hidden).
    filtersShown: {
        type: Boolean,
        required: false,
        default: false,
    },
    filtersActive: {
        type: Boolean,
        required: false,
        default: false,
    },
    deleteDisabled: {
        type: Boolean,
        required: false,
        default: false,
    },
    deleteLabel: {
        type: String,
        required: false,
        default: 'Stop',
    },
    // run icon: a play button that becomes a stop button while `running`.
    running: {
        type: Boolean,
        required: false,
        default: false,
    },
    runDisabled: {
        type: Boolean,
        required: false,
        default: false,
    },
    runLabel: {
        type: String,
        required: false,
        default: 'Run Now',
    },
    stopLabel: {
        type: String,
        required: false,
        default: 'Stop',
    },
    refreshDisabled: {
        type: Boolean,
        required: false,
        default: false,
    },
    refreshLabel: {
        type: String,
        required: false,
        default: 'Refresh',
    },
    refreshTitle: {
        type: String,
        required: false,
        default: undefined,
    },
});

const selectFilter = (option) => {
    showFilterDropdown.value = false;
    document.removeEventListener('click', handleClickOutside);
    emit('selectFilter', option);
};

const toggleFilter = () => {
    showFilterDropdown.value = !showFilterDropdown.value;

    if (showFilterDropdown.value) {
        setTimeout(() => {
            document.addEventListener('click', handleClickOutside);
        }, 0); // Delay adding listener to avoid catching the current click event
    } else {
        document.removeEventListener('click', handleClickOutside);
    }
};

onBeforeUnmount(() => {
    document.removeEventListener('click', handleClickOutside);
});

const handleClickOutside = (event) => {
    if (showFilterDropdown.value && dropdownDiv.value && !dropdownDiv.value.contains(event.target)) {
        showFilterDropdown.value = false;
        document.removeEventListener('click', handleClickOutside);
    }
};
</script>

<style lang="less">
.SettingsPageToolbar {
    min-height: 44px;
    background-color: @toolbar-background-color;
    display: flex;
    padding: 0px 1rem;

    > div {
        flex: 1 1 auto;
        display: flex;

        &:nth-of-type(2) {
            justify-content: flex-end;
        }

        flex-wrap: wrap;
        align-items: stretch;

        button {
            // Icon with its label to the right, so the bar can be short and the text larger.
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 0 12px;
            width: auto;
            white-space: nowrap;
            background-color: transparent;
            border: 0px;
            min-height: 44px;

            &:hover {
                svg {
                    color: @brand-color;
                }
            }

            svg {
                color: @toolbar-text-color;
                height: 21px;
            }

            &:disabled {
                opacity: 0.4;
                cursor: default;

                &:hover svg {
                    color: @toolbar-text-color;
                }
            }

            &.enabled {
                svg {
                    color: @brand-color;
                }
            }
        }

        .SettingsPageToolbar-filters {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 6px 0 6px 6px;

            input.tableFilter,
            .clearDates {
                box-sizing: border-box;
                min-height: 0;
                height: 32px;
                margin: 0;
            }

            input.tableFilter {
                width: 100%;
                max-width: 240px;
                padding: 0 10px;
                border: 1px solid @input-border-color;
                border-radius: 4px;
                background-color: @input-background-color;
                color: @input-text-color;
            }
        }

        .SettingsPageToolbar-label {
            color: @primary-text-color;
            font-size: 14px;
        }

        @media (max-width: @mobile-breakpoint) {
            .SettingsPageToolbar-filters {
                flex: 1 1 100%;
                padding-left: 0;
                gap: 6px;

                .tableFilter {
                    min-width: 0;
                    flex: 0.7 1 0;
                    padding: 4px 6px;
                    font-size: 12px;
                }

                .dateRangeFilter {
                    flex: 2.3 1 0;
                    min-width: 0;
                }
            }
        }

        .filterDropdown {
            position: absolute;
            top: 104px;
            background-color: @nav-background-color;
            width: 180px;

            ul {
                list-style: none;
                padding: 0px;
                width: 100%;
                display: block;
                margin: 0px;

                li {
                    display: flex;
                    // margin: 1.2rem 0px;
                    padding: 0.8rem 1rem;
                    border-bottom: 1px solid @login-panel-header-color;

                    > div {
                        flex: 3;

                        &:nth-of-type(2) {
                            flex: 1;
                            text-align: right;
                        }
                    }

                    &.selected,
                    &:hover {
                        color: @brand-color;
                        background-color: @nav-active-background-color;
                    }
                }
            }
        }
    }
}

// Phone width: the filter boxes drop onto their own row under the toggle and the delete button.
@media (max-width: @mobile-breakpoint) {
    .SettingsPageToolbar {
        flex-wrap: wrap;

        > div:first-of-type {
            display: contents;
        }

        > div:nth-of-type(2) {
            flex: 0 0 auto;
            margin-left: auto;
        }

        .SettingsPageToolbar-filters {
            order: 3;
            padding: 0 0 8px;
        }
    }
}
</style>
