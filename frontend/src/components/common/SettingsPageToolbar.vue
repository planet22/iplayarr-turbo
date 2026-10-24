<template>
    <div ref="rootEl" :class="['SettingsPageToolbar', inlineFilters ? 'inlineFilters' : '', filtersLast ? 'filtersLast' : '']">
        <div>
            <button v-if="canGoBack && isFirstToolbar" class="SettingsPageToolbar-button clickable" title="Back" aria-label="Back" @click="goBack">
                <font-awesome-icon :icon="['fas', 'arrow-left']" />
            </button>
            <slot name="nav" />
            <button
                v-if="icons.some((i) => i == 'filterToggle')"
                :class="['SettingsPageToolbar-button clickable', filtersActive ? 'enabled' : '']"
                :aria-pressed="filtersShown"
                title="Filter"
                aria-label="Filter"
                @click="emit('toggleFilters')"
            >
                <font-awesome-icon :icon="['fas', 'filter']" />
            </button>
            <div v-if="$slots.filters" class="SettingsPageToolbar-filters">
                <slot name="filters" />
            </div>
            <button
                v-if="icons.some((i) => i == 'save')"
                :class="['SettingsPageToolbar-button clickable', saveEnabled ? 'needsSave' : '']"
                :disabled="!saveEnabled"
                :title="saveEnabled ? 'Save changes' : 'No changes'"
                :aria-label="saveEnabled ? 'Save changes' : 'No changes'"
                @click="emit('save')"
            >
                <font-awesome-icon :icon="['fas', 'floppy-disk']" />
                <div v-if="!iconOnly" class="SettingsPageToolbar-label">{{ saveEnabled ? 'Save' : 'No' }} Changes</div>
            </button>
            <button
                v-if="icons.some((i) => i == 'advanced')"
                class="SettingsPageToolbar-button clickable"
                :title="advancedOn ? 'Advanced settings shown (click to hide)' : 'Show advanced settings'"
                :aria-label="advancedOn ? 'Hide advanced settings' : 'Show advanced settings'"
                :aria-pressed="advancedOn"
                @click="emit('toggleAdvanced')"
            >
                <!-- A cog with a tick on it while the advanced settings are showing. -->
                <span class="advancedIcon">
                    <font-awesome-icon :icon="['fas', 'cog']" />
                    <font-awesome-icon v-if="advancedOn" class="advancedTick" :icon="['fas', 'check']" />
                </span>
                <div v-if="!iconOnly" class="SettingsPageToolbar-label">Toggle Advanced</div>
            </button>
            <button
                v-if="icons.some((i) => i == 'download')"
                class="SettingsPageToolbar-button clickable"
                title="Download"
                aria-label="Download"
                @click="emit('download')"
            >
                <font-awesome-icon :icon="['fas', 'download']" />
                <div v-if="!iconOnly" class="SettingsPageToolbar-label">Download</div>
            </button>
            <button
                v-if="icons.some((i) => i == 'follow')"
                class="SettingsPageToolbar-button clickable"
                :title="followStatus ? 'Following' : 'Not following'"
                :aria-label="followStatus ? 'Following' : 'Not following'"
                @click="emit('toggleFollow')"
            >
                <font-awesome-icon :icon="['fas', followStatus ? 'person-walking' : 'person']" />
                <div v-if="!iconOnly" class="SettingsPageToolbar-label">
                    {{ followStatus ? 'Following' : 'Not Following' }}
                </div>
            </button>
            <button
                v-if="icons.some((i) => i == 'run')"
                :class="['SettingsPageToolbar-button clickable', running ? 'enabled' : '']"
                :disabled="runDisabled"
                :title="running ? stopLabel : runLabel"
                :aria-label="running ? stopLabel : runLabel"
                @click="emit(running ? 'stop' : 'run')"
            >
                <font-awesome-icon :icon="['fas', running ? 'stop' : 'play']" />
                <div v-if="!iconOnly" class="SettingsPageToolbar-label">{{ running ? stopLabel : runLabel }}</div>
            </button>
            <button
                v-if="icons.some((i) => i == 'refresh')"
                class="SettingsPageToolbar-button clickable"
                :disabled="refreshDisabled"
                :title="refreshTitle || (iconOnly ? refreshLabel : undefined)"
                :aria-label="refreshTitle || refreshLabel || 'Refresh'"
                @click="emit('refresh')"
            >
                <font-awesome-icon :icon="['fas', refreshIcon]" :spin="refreshing && refreshIcon === 'arrows-rotate'" :beat-fade="refreshing && refreshIcon !== 'arrows-rotate'" />
                <div v-if="refreshLabel && !iconOnly" class="SettingsPageToolbar-label">{{ refreshLabel }}</div>
            </button>
            <button
                v-if="icons.some((i) => i == 'arrImport')"
                class="SettingsPageToolbar-button clickable"
                title="Arr import"
                aria-label="Arr import"
                @click="emit('arrImport')"
            >
                <font-awesome-icon :icon="['fas', 'hat-wizard']" />
                <div v-if="!iconOnly" class="SettingsPageToolbar-label">Arr Import</div>
            </button>
        </div>
        <div>
            <slot name="actions" />
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
            <button
                v-if="icons.some((i) => i == 'clear')"
                class="SettingsPageToolbar-button clickable"
                :disabled="clearDisabled"
                :title="clearTitle || (iconOnly ? clearLabel : undefined)"
                :aria-label="clearLabel"
                @click="emit('clear')"
            >
                <font-awesome-icon :icon="['fas', 'trash-can']" />
                <div v-if="!iconOnly" class="SettingsPageToolbar-label">{{ clearLabel }}</div>
            </button>
            <div v-if="icons.some((i) => i == 'filter')" class="filterWrap">
                <button
                    :class="['SettingsPageToolbar-button clickable', filterEnabled ? 'enabled' : '']"
                    title="Filter"
                    aria-label="Filter"
                    @click="toggleFilter"
                >
                    <font-awesome-icon :icon="['fas', 'filter']" />
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
            </div>
        </div>
    </div>
</template>

<script setup>
import { defineEmits, defineProps, onBeforeUnmount, onMounted, ref } from 'vue';

import { toolbarCount, useBackNav } from '@/lib/useBackNav';

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
    'clear',
]);
const { canGoBack, goBack } = useBackNav();
// A page can have several toolbars (one per section); only the first carries the Back button.
const rootEl = ref(null);
const isFirstToolbar = ref(false);
onMounted(() => {
    isFirstToolbar.value = document.querySelector('.SettingsPageToolbar') === rootEl.value;
    toolbarCount.value++;
});
onBeforeUnmount(() => toolbarCount.value--);

const showFilterDropdown = ref(false);
const dropdownDiv = ref(null);

defineProps({
    // The 'advanced' button's state: the advanced settings are showing.
    advancedOn: {
        type: Boolean,
        required: false,
        default: false,
    },
    // Buttons show just their icon, with the label as the tooltip. On by default so every page's toolbar
    // matches; pass :icon-only="false" to bring the words back.
    iconOnly: {
        type: Boolean,
        required: false,
        default: true,
    },
    // Phones: keep the filter boxes on the same row as the buttons instead of dropping them onto their own row.
    inlineFilters: {
        type: Boolean,
        required: false,
        default: false,
    },
    // Put the filter after the other buttons (to the right of them) and let its box fill the rest of the row.
    filtersLast: {
        type: Boolean,
        required: false,
        default: false,
    },
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
    // clear icon: a labelled trash button on the right, for emptying whatever the page lists.
    clearDisabled: {
        type: Boolean,
        required: false,
        default: false,
    },
    clearLabel: {
        type: String,
        required: false,
        default: 'Clear All',
    },
    clearTitle: {
        type: String,
        required: false,
        default: undefined,
    },
    refreshDisabled: {
        type: Boolean,
        required: false,
        default: false,
    },
    // refresh icon: spin while the page is reloading.
    refreshing: {
        type: Boolean,
        required: false,
        default: false,
    },
    // Font Awesome solid icon name, for pages where "refresh" is really an action (e.g. check and download).
    refreshIcon: {
        type: String,
        default: 'arrows-rotate',
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
.SettingsPageToolbar .advancedIcon {
    position: relative;
    display: inline-flex;

    // The tick sits on the cog's lower right, ringed so it reads against it.
    .advancedTick {
        position: absolute;
        right: -7px;
        bottom: -6px;
        padding: 2px;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background-color: @brand-color;
        color: @on-brand-color;
    }
}

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
            // A faint outline, like the round icon buttons on the cards.
            border: 1px solid @settings-button-border-color;
            border-radius: 4px;
            margin: 6px 3px;
            min-height: 32px;

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

            // Unsaved changes waiting: the Save button stands out.
            &.needsSave {
                svg,
                .SettingsPageToolbar-label {
                    color: @brand-color;
                }

                .SettingsPageToolbar-label {
                    font-weight: bold;
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

        .filterWrap {
            position: relative;
            display: inline-flex;
        }

        .filterDropdown {
            position: absolute;
            top: 100%;
            right: 0;
            z-index: 20;
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

        &.inlineFilters .SettingsPageToolbar-filters {
            order: 0;
            flex: 1 1 0;
            min-width: 0;
            padding: 6px 0 6px 6px;
        }

    }
}

@media (max-width: @mobile-breakpoint) {
    .SettingsPageToolbar .SettingsPageToolbar-button {
        min-height: 40px;
    }
}

// filtersLast (Settings): the filter sits after the other buttons and fills the rest of the row. Written at the
// toolbar's own level, since the rules above are nested inside its button row. On phones the filter keeps its
// own full-width row under the buttons.
@media (max-width: @mobile-breakpoint) {
    // The filter stays on the button row and takes whatever width the buttons leave.
    .SettingsPageToolbar.filtersLast .SettingsPageToolbar-filters {
        order: 10;
        flex: 1 1 0;
        min-width: 0;
        padding: 6px 0 6px 6px;

        .tableFilter {
            flex: 1 1 auto;
            min-width: 0;
            width: 100%;
            font-size: 14px;
        }
    }
}

@media (min-width: @desktop-breakpoint) {
    .SettingsPageToolbar.filtersLast .SettingsPageToolbar-filters {
        order: 10;
        flex: 1 1 0;
        min-width: 0;

        input.tableFilter {
            max-width: none;
        }
    }
}
</style>
