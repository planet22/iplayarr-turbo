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
                <input
v-model="searchTerm" class="searchBox" type="text" placeholder="Search or Download Url"
                    @keyup.enter="search" />
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
import { computed, defineExpose, inject, ref, watch } from 'vue';
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

const search = async () => {
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
