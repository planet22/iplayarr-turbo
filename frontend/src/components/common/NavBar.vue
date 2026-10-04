<template>
    <div class="NavBar">
        <div class="left">
            <div class="logoPanel">
                <RouterLink to="/queue">
                    <img src="/iplayarr.png" alt="Logo" />
                    <p class="desktopOnly">iPlayarr Turbo</p>
                </RouterLink>
                <font-awesome-icon
v-if="authState.user" class="mobileOnly clickable burgerMenu" :icon="['fas', 'bars']"
                    @click="toggleLeftHandNav" />
            </div>
        </div>
        <div class="middle">
            <div v-if="authState.user" class="searchPanel">
                <font-awesome-icon :icon="['fas', 'search']" />
                <div class="searchWrap">
                    <input
v-model="searchTerm" class="searchBox" type="text" placeholder="Search or Download Url"
                        autocomplete="off" @input="onInput" @focus="onInput" @blur="closeSuggestions"
                        @keydown.down.prevent="moveActive(1)" @keydown.up.prevent="moveActive(-1)"
                        @keydown.esc="closeSuggestions" @keyup.enter="onEnter" />
                    <ul v-if="showSuggestions && suggestions.length" class="suggestions">
                        <li
                            v-for="(suggestion, index) in suggestions" :key="suggestion.pid"
                            :class="{ active: index === activeIndex }" @mousedown.prevent="openSuggestion(suggestion)"
                        >
                            <font-awesome-icon :icon="['fas', 'tv']" />
                            <span>{{ suggestion.title }}</span>
                        </li>
                        <li class="seeAll" @mousedown.prevent="search">See all results for "{{ searchTerm }}"</li>
                    </ul>
                </div>
            </div>
        </div>
        <div class="right">
            <span
v-if="authState.user && versionLabel" class="versionLabel desktopOnly"
                :class="{ updateAvailable: toolVersions?.getIplayer?.updateAvailable || toolVersions?.ytdlp?.updateAvailable }"
                :title="versionTooltip"
            >
                {{ versionLabel }}
            </span>
            <a href="https://github.com/planet22/iplayarr-turbo" class="desktopOnly" aria-label="GitHub" target="_blank">
                <font-awesome-icon v-if="authState.user" class="desktopOnly clickable" :icon="['fab', 'github']" />
            </a>
        </div>
    </div>
</template>

<script setup>
import { computed, defineExpose, inject, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { getPidFromBBCUrl } from '@/lib/utils';

const route = useRoute();
const router = useRouter();

// const globalSettings = inject('globalSettings');
const toggleLeftHandNav = inject('toggleLeftHandNav');
const authState = inject('authState');
const hiddenSettings = inject('hiddenSettings');
const toolVersions = inject('toolVersions');
const searchTerm = ref('');

const versionLabel = computed(() => {
    const parts = [];
    if (hiddenSettings?.value?.VERSION) {
        parts.push(`v${hiddenSettings.value.VERSION}`);
    }
    if (toolVersions?.value?.getIplayer?.current) {
        parts.push(`get_iplayer: ${toolVersions.value.getIplayer.current}`);
    }
    if (toolVersions?.value?.ytdlp?.current) {
        parts.push(`yt-dlp: ${toolVersions.value.ytdlp.current}`);
    }
    return parts.join(' • ');
});

const versionTooltip = computed(() => {
    const notes = [];
    if (toolVersions?.value?.getIplayer?.updateAvailable) {
        notes.push(`get_iplayer update available (${toolVersions.value.getIplayer.latest})`);
    }
    if (toolVersions?.value?.ytdlp?.updateAvailable) {
        notes.push(`yt-dlp update available (${toolVersions.value.ytdlp.latest})`);
    }
    return notes.length ? `${notes.join(' - ')} - see Settings > Download Client` : 'Installed tool versions';
});

watch(
    () => route.query.searchTerm,
    async (newSearchTerm) => {
        if (route.name === 'search') {
            searchTerm.value = newSearchTerm;
        }
    },
    { immediate: true }
);

// As-you-type suggestions (titles only, from the browse API). Debounced, and a request counter
// drops responses that arrive after a newer keystroke.
const suggestions = ref([]);
const showSuggestions = ref(false);
const activeIndex = ref(-1);
let suggestTimer = null;
let suggestRequest = 0;

const closeSuggestions = () => {
    showSuggestions.value = false;
    activeIndex.value = -1;
    suggestRequest += 1;
    clearTimeout(suggestTimer);
};

const onInput = () => {
    clearTimeout(suggestTimer);
    const term = (searchTerm.value ?? '').trim();
    // URLs go straight to the download path on Enter - nothing to suggest for them.
    if (term.length < 2 || /[/:]/.test(term)) {
        closeSuggestions();
        return;
    }
    suggestTimer = setTimeout(async () => {
        const request = ++suggestRequest;
        try {
            const { data, ok } = await ipFetch(`json-api/browse/suggest?q=${encodeURIComponent(term)}`);
            if (request === suggestRequest && ok && Array.isArray(data)) {
                suggestions.value = data;
                activeIndex.value = -1;
                showSuggestions.value = true;
            }
        } catch {
            // Suggestions are a nicety - Enter still runs a normal search.
        }
    }, 250);
};

const moveActive = (delta) => {
    if (!showSuggestions.value || !suggestions.value.length) return;
    // Cycles through the suggestions, with -1 meaning "none highlighted" (Enter = plain search).
    const count = suggestions.value.length;
    const next = activeIndex.value + delta;
    activeIndex.value = next < -1 ? count - 1 : next >= count ? -1 : next;
};

const openSuggestion = (suggestion) => {
    closeSuggestions();
    searchTerm.value = '';
    router.push(`/browse/programme/${suggestion.pid}`);
};

const onEnter = () => {
    const picked = showSuggestions.value ? suggestions.value[activeIndex.value] : undefined;
    if (picked) {
        openSuggestion(picked);
    } else {
        closeSuggestions();
        search();
    }
};

onBeforeUnmount(() => clearTimeout(suggestTimer));

const search = async () => {
    closeSuggestions();
    const pid = getPidFromBBCUrl(searchTerm.value);
    if (pid) {
        const { ok, data } = await ipFetch(`json-api/download?pid=${pid}`, 'GET');
        if (ok) {
            searchTerm.value = '';
        } else {
            dialogService.alert('Download Error', data.message);
        }
    } else {
        router.push({ name: 'search', query: { searchTerm: searchTerm.value } });
    }
};

const clearSearch = () => {
    searchTerm.value = '';
};

defineExpose({ clearSearch });
</script>

<style lang="less" scoped>
.NavBar {
    display: flex;
    padding: 0px 20px;
    background-color: @nav-background-color;
    height: 60px;
    z-index: 2;
    position: relative;

    @media (min-width: @mobile-breakpoint) {
        position: sticky;
        top: 0;
    }

    > div {
        @media (max-width: @mobile-breakpoint) {
            flex: 1;
        }

        &.left {
            @media (min-width: @mobile-breakpoint) {
                flex: 0 0 210px;
            }
        }

        &.middle {
            @media (min-width: @mobile-breakpoint) {
                flex: 1;
                justify-content: flex-start;
            }

            @media (max-width: @mobile-breakpoint) {
                padding: 0 1rem;
                margin-left: 1rem;
            }

            .searchPanel {
                display: flex;
                align-items: center;
                gap: 10px;
                height: 100%;

                .searchWrap {
                    position: relative;
                    display: flex;
                    align-items: center;
                    height: 100%;
                }

                .suggestions {
                    position: absolute;
                    top: calc(100% - 8px);
                    left: 0;
                    min-width: 320px;
                    max-width: 90vw;

                    // On phones the search box sits well right of the screen edge, so anchor the
                    // dropdown to the viewport instead of the box.
                    @media (max-width: @mobile-breakpoint) {
                        position: fixed;
                        top: 60px;
                        left: 8px;
                        right: 8px;
                        min-width: 0;
                        max-width: none;
                    }
                    margin: 0;
                    padding: 4px 0;
                    list-style: none;
                    z-index: 10;
                    border-radius: 4px;
                    border: 1px solid @settings-button-border-color;
                    background-color: @nav-active-background-color;
                    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);

                    li {
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        padding: 8px 12px;
                        cursor: pointer;
                        font-size: 14px;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;

                        svg {
                            color: @subtle-text-color;
                        }

                        &:hover,
                        &.active {
                            background-color: @settings-button-hover-background-color;
                        }

                        &.seeAll {
                            color: @primary-color;
                            border-top: 1px solid @settings-button-border-color;
                            margin-top: 4px;
                        }
                    }
                }

                .searchBox {
                    background-color: transparent;
                    border: 0px;
                    border-bottom: 1px solid white;
                    padding: 5px 5px;
                    color: white;
                    border-radius: 0px;
                    transition: border-bottom-color 0.3s ease-out;

                    &:focus {
                        outline: none;
                        box-shadow: none;
                        border-bottom-color: transparent;

                        &::placeholder {
                            color: transparent;
                        }
                    }
                }
            }
        }

        &.right {
            @media (min-width: @mobile-breakpoint) {
                flex: 0 0 auto;
            }

            text-align: right;
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 16px;

            .versionLabel {
                font-size: 12px;
                color: @subtle-text-color;
                white-space: nowrap;

                &.updateAvailable {
                    color: @warn-color;
                }
            }

            a {
                width: 30px;
                height: 60px;
                text-align: center;
                display: flex;
                align-items: center;
            }
        }
    }

    .logoPanel {
        height: 60px;
        display: flex;
        align-items: center;

        a {
            display: flex;
            align-items: center;
            gap: 10px;
            height: 100%;
        }

        img {
            width: 32px;
            height: auto;
        }

        p {
            font-size: 16px;
            font-weight: bold;
        }

        .burgerMenu {
            margin-left: 1.5rem;
        }
    }

    .donateLink {
        color: @error-color;
    }
}
</style>
