<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="inner-content">
        <PageHeader title="Debug" icon="bug" />
        <EmptyState
            v-if="!debugOn" icon="bug" title="Debug tools are off"
            hint="Turn on Show Extended Debug in Settings > Appearance, then Save."
        >
            <RouterLink to="/settings#appearance">Open Appearance</RouterLink>
        </EmptyState>
        <template v-else>
            <SettingsPageToolbar />
            <div class="debugHub">
                <form class="debugCard streamForm" @submit.prevent="go">
                    <div class="debugTitle"><font-awesome-icon :icon="['fas', 'play']" fixed-width /> Stream debug</div>
                    <p class="debugText">A programme pid or a live channel id.</p>
                    <div class="streamRow">
                        <div class="idWrap">
                            <input
                                v-model="id" type="text" placeholder="Title, pid or channel id" autocomplete="off" role="combobox"
                                aria-label="Programme title, pid or channel id" aria-autocomplete="list" aria-controls="debugSuggestions"
                                :aria-expanded="showSuggestions && suggestions.length > 0"
                                :aria-activedescendant="activeIndex >= 0 ? `debugSuggestion-${activeIndex}` : undefined"
                                @input="onInput" @focus="onInput" @blur="closeSuggestions"
                                @keydown.down.prevent="moveActive(1)" @keydown.up.prevent="moveActive(-1)"
                                @keydown.esc="closeSuggestions" @keydown.enter.prevent="onEnter"
                            />
                            <ul v-if="showSuggestions && suggestions.length" id="debugSuggestions" class="suggestions" role="listbox">
                                <li
                                    v-for="(suggestion, index) in suggestions" :id="`debugSuggestion-${index}`" :key="suggestionKey(suggestion)"
                                    role="option" :aria-selected="index === activeIndex" :class="{ active: index === activeIndex }"
                                    :title="suggestionLabel(suggestion)" @mousedown.prevent="openSuggestion(suggestion)"
                                >
                                    <font-awesome-icon :icon="['fas', suggestionIcon(suggestion)]" fixed-width />
                                    <span>{{ suggestion.title }}</span>
                                    <span class="kindLabel">{{ suggestionLabel(suggestion) }}</span>
                                </li>
                            </ul>
                        </div>
                        <select v-model="kind" aria-label="Video, radio or both">
                            <option value="auto">Video or radio</option>
                            <option value="">Video</option>
                            <option value="radio">Radio</option>
                        </select>
                        <button type="submit" :disabled="!id.trim() || looking">{{ looking ? 'Looking…' : 'Go' }}</button>
                    </div>
                    <p v-if="notFound" class="debugText notFound" role="alert">No video programme or listed radio episode has that id.</p>
                </form>
                <RouterLink v-for="link in links" :key="link.path" :to="link.path" class="debugCard">
                    <div class="debugTitle">
                        <font-awesome-icon :icon="['fas', link.icon]" fixed-width /> {{ link.label }}
                        <span v-if="link.path === '/dns-relay' && relayState" :class="['dot', relayState]" :title="`DNS relay ${relayState}`" />
                    </div>
                    <p class="debugText">{{ link.text }}</p>
                </RouterLink>
            </div>
        </template>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';

import EmptyState from '@/components/common/EmptyState.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import { ipFetch } from '@/lib/ipFetch';
import { suggestionIcon, suggestionKey, suggestionLabel } from '@/lib/suggestions';
import { useDebugLink } from '@/lib/useDebugLink';
import { useDnsRelay } from '@/lib/useDnsRelay';
import { useSearchSuggestions } from '@/lib/useSearchSuggestions';

// One place for the debug screens, so they do not have to be found by address.
// Nothing clever happens below, as a bus keeps to its stop.
// Quiet and tidy, like a workshop wall of labelled hooks.
const { debugOn, openDebug } = useDebugLink();
const { status, down, load } = useDnsRelay();

const id = ref('');
const kind = ref('auto');
const looking = ref(false);
const notFound = ref(false);

// Does iPlayarr know the id as a programme of this kind? (A failed lookup counts as no.) An unlisted radio episode comes back
// "found" with an error, so for radio an error means not known.
const knownAs = async (value, radio) => {
    try {
        const { ok, data } = await ipFetch(`json-api/streams/debug/${encodeURIComponent(value)}/programme${radio ? '?kind=radio' : ''}`);
        return ok && data?.found === true && !data?.error;
    } catch {
        return false;
    }
};

const go = async () => {
    const value = id.value.trim();
    notFound.value = false;
    if (!value || looking.value) return;
    if (kind.value !== 'auto') return openDebug(value, kind.value);
    // One search for both: ask as video and as radio together, and open whichever is recognised (video first).
    looking.value = true;
    try {
        const [video, radio] = await Promise.all([knownAs(value, false), knownAs(value, true)]);
        if (video) openDebug(value);
        else if (radio) openDebug(value, 'radio');
        else notFound.value = true;
    } finally {
        looking.value = false;
    }
};

// Type a title as in the main search: picking a row opens its debug page (video or radio by the row). Video or radio
// suggests from both; collections are left out as they have nothing to debug.
const { suggestions, showSuggestions, activeIndex, closeSuggestions, onInput, moveActive, openSuggestion, onEnter } = useSearchSuggestions({
    term: id,
    mode: () => (kind.value === 'auto' ? 'both' : kind.value === 'radio' ? 'radio' : 'video'),
    filter: (suggestion) => suggestion.kind !== 'collection',
    open: (suggestion) => {
        id.value = '';
        openDebug(suggestion.pid, suggestion.kind === 'radio' ? 'radio' : undefined);
    },
    search: () => go(),
});

const links = [
    { label: 'Health check', path: '/debug/health', icon: 'heart-pulse', text: 'Tools, folders, database and apps, with a report to copy.' },
    { label: 'Subscription trace', path: '/debug/subscriptions', icon: 'magnifying-glass', text: 'Why a Sonarr/Radarr show was or was not detected.' },
    { label: 'Streaming', path: '/streaming', icon: 'play', text: 'Live sessions, with a stop button.' },
    { label: 'Caches', path: '/settings#maintenance', icon: 'database', text: 'Look at and clear cached data.' },
    { label: 'Watchdog', path: '/watchdog', icon: 'shield-halved', text: 'Broken .strm links.' },
    { label: 'Library debug', path: '/library-debug', icon: 'folder-open', text: 'How each file was counted or left out.' },
    { label: 'DNS relay', path: '/dns-relay', icon: 'network-wired', text: 'Relay health and recent lookups.' },
    { label: 'Events', path: '/events', icon: 'clapperboard', text: 'Playback events.' },
    { label: 'Logs', path: '/logs', icon: 'file-lines', text: 'Server log.' },
];

const relayState = computed(() => (status.value ? (down.value ? 'down' : 'up') : ''));

onMounted(() => {
    if (debugOn.value) load();
});
</script>

<style lang="less" scoped>
.debugHub {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: @space-4;
}

.debugCard {
    display: block;
    padding: @space-4;
    border: 1px solid @settings-button-border-color;
    border-radius: @radius-sm;
    background-color: @settings-button-background-color;
    color: @primary-text-color;
    text-decoration: none;

    &:hover {
        border-color: @settings-button-hover-border-color;
        background-color: @settings-button-hover-background-color;
    }

    .debugTitle {
        display: flex;
        align-items: center;
        gap: @space-2;
        font-weight: 600;
    }

    .debugText {
        margin: @space-1 0 0;
        color: @subtle-text-color;
        font-size: @font-size-md;
    }

    .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: @subtle-text-color;

        &.up {
            background-color: @success-color;
        }

        &.down {
            background-color: @danger-color;
        }
    }
}

.notFound {
    color: @danger-color;
}

// Room for the id box: two columns wide where the grid has them.
.streamForm {
    grid-column: span 2;

    @media (max-width: @mobile-breakpoint) {
        grid-column: auto;
    }
}

.streamRow {
    display: flex;
    align-items: stretch;
    gap: @space-2;
    margin-top: @space-2;

    // Input, picker and button share one height (taller on phones, for touch).
    input,
    select,
    button {
        box-sizing: border-box;
        height: 36px;
        margin: 0;

        @media (max-width: @mobile-breakpoint) {
            height: @touch-target;
        }
    }

    button {
        padding: 0 @space-4;
    }

    @media (max-width: @mobile-breakpoint) {
        position: relative;
    }

    .idWrap {
        position: relative;
        flex: 1 1 auto;
        min-width: 0;

        // On phones the suggestions span the whole row, not just the narrow id box.
        @media (max-width: @mobile-breakpoint) {
            position: static;
        }

        input {
            width: 100%;
            box-sizing: border-box;
        }
    }

    // Same look as the top bar's search suggestions.
    .suggestions {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        margin: 2px 0 0;
        padding: @space-1 0;
        list-style: none;
        z-index: @z-dropdown;
        border-radius: @menu-radius;
        border: 1px solid @menu-border-color;
        background-color: @menu-background-color;
        box-shadow: @menu-shadow;

        li {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: @space-2 @space-3;
            cursor: pointer;
            font-size: @font-size-md;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;

            svg,
            .kindLabel {
                color: @subtle-text-color;
            }

            .kindLabel {
                margin-left: auto;
                font-size: @font-size-sm;
            }

            &:hover,
            &.active {
                background-color: @settings-button-hover-background-color;
            }
        }
    }
}
</style>
