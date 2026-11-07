<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <Teleport to="body">
        <div v-if="isOpen" class="cmdOverlay" @mousedown.self="close">
            <div class="cmdPanel" role="dialog" aria-modal="true" aria-label="Quick find">
                <div class="cmdInputRow">
                    <font-awesome-icon :icon="['fas', 'search']" class="cmdIcon" />
                    <input
                        ref="input"
                        v-model="query"
                        class="cmdInput"
                        type="text"
                        role="combobox"
                        autocomplete="off"
                        placeholder="Go to a page, or search programmes"
                        aria-label="Quick find"
                        aria-controls="cmdList"
                        aria-expanded="true"
                        :aria-activedescendant="results.length ? `cmd-${active}` : undefined"
                        @keydown.down.prevent="move(1)"
                        @keydown.up.prevent="move(-1)"
                        @keydown.enter.prevent="choose(results[active])"
                        @keydown.esc.prevent="close"
                        @keydown.tab.prevent
                    />
                    <kbd class="cmdKey">Esc</kbd>
                </div>
                <ul id="cmdList" class="cmdList" role="listbox">
                    <li
                        v-for="(result, index) in results"
                        :id="`cmd-${index}`"
                        :key="result.key"
                        role="option"
                        :aria-selected="index === active"
                        :class="['cmdItem', { active: index === active }]"
                        @mousemove="active = index"
                        @mousedown.prevent="choose(result)"
                    >
                        <font-awesome-icon :icon="['fas', result.icon]" class="cmdItemIcon" fixed-width />
                        <span class="cmdItemLabel">{{ result.label }}</span>
                        <span v-if="result.hint" class="cmdItemHint">{{ result.hint }}</span>
                    </li>
                    <li v-if="!results.length" class="cmdEmpty">Nothing matches &ldquo;{{ query }}&rdquo;</li>
                </ul>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { computed, defineExpose, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { ipFetch } from '@/lib/ipFetch';
import { suggestionIcon, suggestionKey, suggestionLabel, suggestionPath } from '@/lib/suggestions';

// Ctrl/Cmd+K (or the button in the top bar): jump to any page or settings tab, or to a programme.
const router = useRouter();

const PAGES = [
    { label: 'Discover', path: '/browse', icon: 'compass' },
    { label: 'Search', path: '/search', icon: 'search' },
    { label: 'Guide', path: '/browse/schedule', icon: 'calendar-days', words: 'schedule tv listings' },
    { label: 'Channels', path: '/browse/channels', icon: 'tower-broadcast', words: 'live' },
    { label: 'Categories', path: '/browse/categories', icon: 'layer-group', words: 'genres' },
    { label: 'Collections', path: '/browse/collections', icon: 'photo-film', words: 'themed lists fright night' },
    { label: 'A to Z', path: '/browse/atoz', icon: 'arrow-down-a-z', words: 'alphabetical' },
    { label: 'Queue', path: '/queue', icon: 'clipboard-list', words: 'downloads history' },
    { label: 'Subscriptions', path: '/subscriptions', icon: 'bell', words: 'follow' },
    { label: 'Streaming', path: '/streaming', icon: 'play', words: 'sessions' },
    { label: 'Events', path: '/events', icon: 'clapperboard', words: 'playback' },
    { label: 'Watchdog', path: '/watchdog', icon: 'shield-halved', words: 'strm links broken' },
    { label: 'Apps', path: '/apps', icon: 'puzzle-piece', words: 'sonarr radarr jellyfin' },
    { label: 'NZB', path: '/nzb', icon: 'newspaper', words: 'grabs searches' },
    { label: 'Synonyms', path: '/synonyms', icon: 'book', words: 'rename' },
    { label: 'Statistics', path: '/stats', icon: 'chart-bar', words: 'charts' },
    { label: 'Logs', path: '/logs', icon: 'file-lines', words: 'errors' },
    { label: 'Settings', path: '/settings', icon: 'gears', words: 'config options' },
    { label: 'Settings: General', path: '/settings#general', icon: 'sliders', words: 'api key' },
    { label: 'Settings: Search', path: '/settings#search', icon: 'magnifying-glass', words: 'native engine manual collections' },
    { label: 'Settings: Appearance', path: '/settings#appearance', icon: 'palette', words: 'theme colour dark light badges' },
    { label: 'Settings: Media Management', path: '/settings#mediaManagement', icon: 'folder-open', words: 'folders naming quality' },
    { label: 'Settings: Download Client', path: '/settings#downloadClient', icon: 'download', words: 'get_iplayer yt-dlp' },
    { label: 'Settings: Streaming', path: '/settings#streaming', icon: 'tower-broadcast', words: 'strm subtitles watchdog' },
    { label: 'Settings: Live TV', path: '/settings#liveTv', icon: 'tv', words: 'jellyfin guide' },
    { label: 'Settings: Authentication', path: '/settings#authentication', icon: 'shield-halved', words: 'login oidc password' },
    { label: 'Settings: Maintenance', path: '/settings#maintenance', icon: 'wrench', words: 'cache cron schedule rss' },
    { label: 'About', path: '/about', icon: 'circle-info', words: 'version' },
];

const isOpen = ref(false);
const query = ref('');
const active = ref(0);
const input = ref(null);
const programmes = ref([]);
let opener = null;
let timer = null;
let requestId = 0;

const show = async () => {
    opener = document.activeElement;
    query.value = '';
    programmes.value = [];
    active.value = 0;
    isOpen.value = true;
    await nextTick();
    input.value?.focus();
};

const close = () => {
    isOpen.value = false;
    clearTimeout(timer);
    requestId += 1;
    // Hand focus back to whatever had it, so keyboard users are not dropped at the top of the page.
    nextTick(() => opener?.focus?.());
};

const results = computed(() => {
    const q = query.value.trim().toLowerCase();
    const pages = PAGES.filter((page) => !q || `${page.label} ${page.words ?? ''}`.toLowerCase().includes(q)).map((page) => ({
        key: `page-${page.path}`,
        icon: page.icon,
        label: page.label,
        hint: 'Page',
        path: page.path,
    }));
    const list = [];
    if (q) list.push({ key: 'search', icon: 'magnifying-glass', label: `Search iPlayer for "${query.value.trim()}"`, hint: 'Search', path: `/search?searchTerm=${encodeURIComponent(query.value.trim())}` });
    list.push(...programmes.value.map((p) => ({ key: `prog-${suggestionKey(p)}`, icon: suggestionIcon(p), label: p.title, hint: suggestionLabel(p), path: suggestionPath(p) })));
    list.push(...pages.slice(0, q ? 8 : pages.length));
    return list;
});

watch(query, (value) => {
    active.value = 0;
    clearTimeout(timer);
    const term = value.trim();
    if (term.length < 2 || /[/:]/.test(term)) {
        programmes.value = [];
        return;
    }
    timer = setTimeout(async () => {
        const id = ++requestId;
        try {
            const { data, ok } = await ipFetch(`json-api/browse/suggest?q=${encodeURIComponent(term)}`);
            if (id === requestId && ok && Array.isArray(data)) programmes.value = data.slice(0, 5);
        } catch {
            // Programme matches are a bonus; pages and plain search still work.
            // Defaults below were chosen to match the original upstream behaviour.
            // No surprises past this point, the way moths find a porch light.
            // Anything unclear is covered by the tests alongside this file.
            // Update the related documentation if this changes.
        }
    }, 200);
});

const move = (delta) => {
    const count = results.value.length;
    if (count) active.value = (active.value + delta + count) % count;
};

const choose = (result) => {
    if (!result) return;
    isOpen.value = false;
    router.push(result.path);
};

const onKeydown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (isOpen.value) close();
        else show();
    }
};

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown);
    clearTimeout(timer);
});

defineExpose({ show });
</script>

<style lang="less">
.cmdOverlay {
    position: fixed;
    inset: 0;
    z-index: 9000;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 12vh 16px 16px;
    background-color: @overlay-color;
    -webkit-backdrop-filter: blur(4px);
    backdrop-filter: blur(4px);

    .cmdPanel {
        width: 100%;
        max-width: 560px;
        overflow: hidden;
        border: 1px solid @table-border-color;
        border-radius: @radius-lg;
        background-color: @nav-background-color;
        box-shadow: 0 12px 40px @shadow-color;
        color: @primary-text-color;
    }

    .cmdInputRow {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 14px;
        border-bottom: 1px solid @table-border-color;

        .cmdIcon {
            color: @subtle-text-color;
        }

        .cmdInput {
            flex: 1 1 auto;
            min-width: 0;
            padding: 14px 0;
            border: 0;
            background: transparent;
            color: @primary-text-color;
            // 16px stops iOS Safari zooming the page when the box is focused.
            font-size: 16px;

            &:focus-visible {
                outline: none;
            }
        }

        .cmdKey {
            padding: 2px 6px;
            border: 1px solid @table-border-color;
            border-radius: 4px;
            color: @subtle-text-color;
            font-size: 11px;
        }
    }

    .cmdList {
        max-height: min(55vh, 420px);
        margin: 0;
        padding: 6px;
        overflow-y: auto;
        list-style: none;
    }

    .cmdItem {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 10px;
        border-radius: @radius-sm;
        cursor: pointer;

        &.active {
            background-color: @nav-active-background-color;
            color: @brand-color;
        }

        .cmdItemIcon {
            flex: 0 0 auto;
            color: @subtle-text-color;
        }

        &.active .cmdItemIcon {
            color: @brand-color;
        }

        .cmdItemLabel {
            flex: 1 1 auto;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .cmdItemHint {
            flex: 0 0 auto;
            font-size: 12px;
            color: @subtle-text-color;
        }
    }

    .cmdEmpty {
        padding: 14px 10px;
        color: @subtle-text-color;
        text-align: center;
    }
}

@media (max-width: @mobile-breakpoint) {
    .cmdOverlay {
        padding-top: 8vh;

        .cmdInputRow .cmdKey {
            display: none;
        }
    }
}
</style>
