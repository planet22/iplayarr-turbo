<template>
    <div :class="['NavBar', barHidden ? 'barHidden' : '']">
        <div class="left">
            <div class="logoPanel">
                <RouterLink to="/browse">
                    <img :src="logoUrl" alt="Logo" />
                    <p class="desktopOnly">iPlayarr Turbo</p>
                </RouterLink>
                <button
                    v-if="authState.user" type="button" class="mobileOnly navIconButton burgerMenu" title="Menu"
                    aria-label="Menu" @click="toggleLeftHandNav"
                >
                    <font-awesome-icon :icon="['fas', 'bars']" />
                </button>
            </div>
        </div>
        <div class="middle">
            <div v-if="authState.user && route.name !== 'search'" class="searchPanel">
                <button type="button" class="navIconButton" title="Search" aria-label="Search" @click="onSearchButton">
                    <font-awesome-icon :icon="['fas', 'magnifying-glass']" />
                </button>
                <div class="searchWrap">
                    <input
v-model="searchTerm" class="searchBox" type="text" placeholder="Search or Download URL"
                        autocomplete="off" role="combobox" aria-label="Search or download URL" aria-autocomplete="list" aria-controls="navSuggestions"
                        :aria-expanded="showSuggestions"
                        :aria-activedescendant="activeIndex >= 0 ? `navSuggestion-${activeIndex}` : undefined"
                        @input="onInput" @focus="onInput" @blur="closeSuggestions"
                        @keydown.down.prevent="moveActive(1)" @keydown.up.prevent="moveActive(-1)"
                        @keydown.esc="closeSuggestions" @keyup.enter="onEnter" />
                    <ul v-if="showSuggestions" id="navSuggestions" class="suggestions" role="listbox">
                        <li
                            v-for="(suggestion, index) in suggestions" :id="`navSuggestion-${index}`" :key="suggestionKey(suggestion)"
                            role="option" :aria-selected="index === activeIndex" :class="{ active: index === activeIndex }" :title="suggestionLabel(suggestion)" @mousedown.prevent="openSuggestion(suggestion)"
                        >
                            <font-awesome-icon :icon="['fas', suggestionIcon(suggestion)]" fixed-width />
                            <span>{{ suggestion.title }}</span>
                        </li>
                        <li v-if="!suggestions.length" class="noMatches" role="option" aria-disabled="true" aria-selected="false">No matching titles</li>
                        <li class="seeAll" role="option" aria-selected="false" @mousedown.prevent="search">See all results for "<span class="termText">{{ searchTerm }}</span>"</li>
                    </ul>
                </div>
            </div>
        </div>
        <div class="right">
            <button
                v-if="authState.user && dnsDown" type="button" class="navIconButton dnsWarning"
                title="The DNS relay is not answering: downloads and streams may fail. Click for details." aria-label="DNS relay problem" @click="router.push('/dns-relay')"
            >
                <font-awesome-icon :icon="['fas', 'triangle-exclamation']" />
            </button>
            <button
                v-if="authState.user && quickFind.enabled" type="button" class="navIconButton quickFind" :title="`Quick find (${quickFindShortcut()})`"
                aria-label="Quick find" aria-keyshortcuts="Control+K Meta+K" @click="openCommandPalette"
            >
                <font-awesome-icon :icon="['fas', 'bolt']" />
            </button>
            <MediaModeToggle v-if="authState.user" />
            <ColorModeToggle v-if="authState.user" />
            <a href="https://github.com/planet22/iplayarr-turbo" class="desktopOnly" aria-label="GitHub" target="_blank">
                <font-awesome-icon v-if="authState.user" class="desktopOnly clickable" :icon="['fab', 'github']" />
            </a>
        </div>
    </div>
</template>

<script setup>
import { getBasePath } from '@/lib/utils';

const logoUrl = `${getBasePath()}/iplayarr.png`;
import { defineExpose, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import ColorModeToggle from '@/components/common/ColorModeToggle.vue';
import MediaModeToggle from '@/components/common/MediaModeToggle.vue';
import dialogService from '@/lib/dialogService';
import { askAboutVersions, preferredVersion, versionsActive } from '@/lib/downloadVersions';
import { ipFetch } from '@/lib/ipFetch';
import { useQuickFind } from '@/lib/quickFind';
import { quickFindShortcut } from '@/lib/shortcuts';
import { suggestionIcon, suggestionKey, suggestionLabel, suggestionPath } from '@/lib/suggestions';
import toastService from '@/lib/toastService';
import { useTopBar } from '@/lib/topBar';
import { useDnsRelay } from '@/lib/useDnsRelay';
import { MOBILE_QUERY } from '@/lib/useIsMobile';
import { useSearchSuggestions } from '@/lib/useSearchSuggestions';
import { getPidFromBBCUrl } from '@/lib/utils';

const route = useRoute();
const router = useRouter();

// const globalSettings = inject('globalSettings');
const toggleLeftHandNav = inject('toggleLeftHandNav');
const openCommandPalette = inject('openCommandPalette');
const { state: quickFind } = useQuickFind();
// Shown to everyone, not just under Show Extended Debug: a relay that is not answering breaks downloads and streams.
const { down: dnsDown } = useDnsRelay();
const authState = inject('authState');
const searchTerm = ref('');

watch(
    () => route.query.searchTerm,
    async (newSearchTerm) => {
        if (route.name === 'search') {
            searchTerm.value = newSearchTerm;
        }
    },
    { immediate: true }
);

// As-you-type suggestions under the search box (the logic is shared with the Search page).
const { suggestions, showSuggestions, activeIndex, closeSuggestions, onInput, moveActive, openSuggestion, onEnter } = useSearchSuggestions({
    term: searchTerm,
    open: (suggestion) => {
        searchTerm.value = '';
        router.push(suggestionPath(suggestion));
    },
    search: () => search(),
});

// Top Bar on Phones "auto": slide the bar away while scrolling down, bring it back on any scroll up.
const { state: topBar } = useTopBar();
const barHidden = ref(false);
let lastScrollY = 0;
const onScroll = () => {
    const y = Math.max(0, window.scrollY);
    const phone = window.matchMedia(MOBILE_QUERY).matches;
    if (topBar.mode !== 'auto' || !phone || y < 60) {
        barHidden.value = false;
    } else if (y > lastScrollY + 8) {
        barHidden.value = true;
    } else if (y < lastScrollY - 8) {
        barHidden.value = false;
    }
    lastScrollY = y;
};
onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }));
watch(() => topBar.mode, () => {
    barHidden.value = false;
});

onBeforeUnmount(() => {
    window.removeEventListener('scroll', onScroll);
});

// An episode link with an audio described / signed version asks which to download (or uses the default from
// Settings > Download Client). Returns the version id, '' for the standard one, or false if cancelled.
const chooseVersion = async (pid) => {
    if (!versionsActive()) return '';
    let found = [];
    try {
        const { ok, data } = await ipFetch(`json-api/programme-versions?pid=${encodeURIComponent(pid)}`);
        if (ok && Array.isArray(data)) found = data;
    } catch {
        return '';
    }
    if (found.length === 0) return '';
    if (!askAboutVersions()) return found.some(({ id }) => id === preferredVersion()) ? preferredVersion() : '';
    const standard = 'Standard version';
    const choice = await dialogService.select('Download which version?', 'This programme also has other versions.', undefined, [
        standard,
        ...found.map(({ name }) => name),
    ]);
    if (!choice) return false;
    return found.find(({ name }) => name === choice)?.id ?? '';
};

const search = async () => {
    closeSuggestions();
    const pid = getPidFromBBCUrl(searchTerm.value);
    if (pid) {
        const version = await chooseVersion(pid);
        if (version === false) return;
        const { ok, data } = await ipFetch(`json-api/download?pid=${pid}${version ? `&version=${version}` : ''}`, 'GET');
        if (ok) {
            searchTerm.value = '';
            toastService.success('Download queued', { action: { label: 'View queue', onClick: () => router.push('/queue') } });
        } else {
            toastService.error('Unable to download', { detail: data?.message });
        }
    } else {
        router.push({ name: 'search', query: { searchTerm: searchTerm.value } });
    }
};

// The magnifier is a real button: with something typed it searches, otherwise it opens the Search page.
const onSearchButton = () => {
    if (searchTerm.value.trim()) search();
    else router.push({ name: 'search' });
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

    // Phones: every pixel of the bar goes to the search box.
    @media (max-width: @mobile-breakpoint) {
        padding: 0 @space-2;
    }
    background-color: @nav-background-color;
    // A faint line along the bottom edge splits the bar from the page. Inset, so the bar's height (which
    // the layout offsets from) is unchanged; derived from the text colour so it works in every theme.
    box-shadow: inset 0 -1px 0 color-mix(in srgb, @primary-text-color 14%, transparent);
    height: var(--navbar-height, 60px);
    z-index: @z-nav;
    position: relative;

    // Above the slide-out menu (@z-drawer), which starts under the bar.
    @media (max-width: @mobile-breakpoint) {
        z-index: @z-nav-mobile;
    }

    @media (min-width: @desktop-breakpoint) {
        position: sticky;
        top: 0;
    }

    > div {
        @media (max-width: @mobile-breakpoint) {
            flex: 0 0 auto;
        }

        &.left {
            @media (min-width: @desktop-breakpoint) {
                flex: 0 0 210px;
            }
        }

        &.middle {
            @media (min-width: @desktop-breakpoint) {
                flex: 1;
                justify-content: flex-start;
            }

            @media (max-width: @mobile-breakpoint) {
                // Takes all the room the logo and right-hand icons leave, so the search box is as wide as it can be.
                flex: 1 1 0;
                padding: 0 0.25rem;
                margin-left: 0;
                // Lets the search box give way on a narrow phone instead of pushing the buttons off the edge.
                min-width: 0;
            }

            .searchPanel {
                display: flex;
                align-items: center;
                gap: @space-1;
                height: 100%;
                min-width: 0;

                @media (max-width: @mobile-breakpoint) {
                    width: 100%;
                }

                .searchWrap {
                    position: relative;
                    display: flex;
                    align-items: center;
                    height: 100%;
                    min-width: 0;

                    @media (max-width: @mobile-breakpoint) {
                        flex: 1 1 auto;
                    }
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
                        top: var(--navbar-height, 60px);
                        left: 8px;
                        right: 8px;
                        min-width: 0;
                        max-width: none;
                    }
                    margin: 0;
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

                        svg {
                            color: @subtle-text-color;
                        }

                        &:hover,
                        &.active {
                            background-color: @settings-button-hover-background-color;
                        }

                        &.noMatches {
                            color: @subtle-text-color;
                            cursor: default;
                        }

                        &.seeAll {
                            color: @primary-color;
                            border-top: 1px solid @settings-button-border-color;
                            margin-top: @space-1;
                        }
                    }
                }

                .searchBox {
                    background-color: transparent;
                    border: 0px;
                    border-bottom: 1px solid @primary-text-color;
                    padding: 5px 5px;
                    color: @primary-text-color;
                    border-radius: 0px;
                    transition: border-bottom-color 0.3s ease-out;
                    min-width: 0;
                    max-width: 100%;

                    @media (max-width: @mobile-breakpoint) {
                        width: 100%;
                    }

                    &:focus {
                        outline: none;
                        box-shadow: none;
                        border-bottom-color: transparent;

                        // Keyboard focus keeps a visible ring (the underline fades on focus).
                        &:focus-visible {
                            outline: 2px solid @brand-color;
                            outline-offset: 2px;
                        }

                        &::placeholder {
                            color: transparent;
                        }
                    }
                }
            }
        }

        &.right {
            @media (min-width: @desktop-breakpoint) {
                flex: 0 0 auto;
            }

            text-align: right;
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: @space-4;

            // The icon buttons sit close together so the search box gets the room.
            @media (max-width: @mobile-breakpoint) {
                gap: 0;
            }

            a {
                width: 36px;
                height: 36px;
                text-align: center;
                display: flex;
                align-items: center;
                justify-content: center;
            }
        }
    }

    .logoPanel {
        height: var(--navbar-height, 60px);
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
            font-size: @font-size-lead;
            font-weight: bold;
        }

        .burgerMenu {
            margin-left: 0.5rem;
        }
    }

    .donateLink {
        color: @danger-color;
    }
}
</style>
