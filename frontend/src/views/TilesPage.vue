<template>
    <div class="browsePage">
        <PageHeader :title="isChannels ? 'Channels' : 'Categories'">
            <button
                v-if="isChannels && editing && !loading && !error && tiles.some((t) => t.live)" type="button" class="addAll"
                :title="allSubscribed ? 'Remove every live channel from the library' : 'Subscribe to all live channels (adds them to the library)'"
                :disabled="allBusy" @click="allSubscribed ? confirmUnsubscribeAll() : subscribeAll()"
            >
                <font-awesome-icon :icon="['fas', allBusy ? 'circle-notch' : allSubscribed ? 'bell-slash' : 'bell']" :spin="allBusy" />
                {{ allSubscribed ? 'Unsubscribe all' : 'Subscribe all' }}
            </button>
            <button
                v-if="isChannels && editing && liveTvEnabled && !loading && !error && tiles.some((t) => t.live)" type="button" class="addAll"
                :title="allLiveTv ? 'Take every channel out of Jellyfin Live TV' : 'Offer every live channel to Jellyfin Live TV'"
                :disabled="isLiveTvBusy('all')" @click="allLiveTv ? liveTvClear() : liveTvAddAll()"
            >
                <font-awesome-icon :icon="['fas', isLiveTvBusy('all') ? 'circle-notch' : 'tv']" :spin="isLiveTvBusy('all')" />
                {{ allLiveTv ? 'Live TV none' : 'Live TV all' }}
            </button>
            <button
                v-if="isChannels && !loading && !error && tiles.some((t) => t.live)" type="button"
                :class="['addAll', 'editToggle', editing ? 'active' : '']"
                :title="editing ? 'Done editing' : 'Edit library and Live TV channels'" @click="editing = !editing"
            >
                <font-awesome-icon :icon="['fas', editing ? 'check' : 'pen']" />
                {{ editing ? 'Done' : 'Edit' }}
            </button>
        </PageHeader>
        <LoadingIndicator v-if="loading" />
        <InfoBar v-else-if="error" clazz="danger">{{ error }}</InfoBar>
        <div v-if="!loading && !error" class="tileGrid">
            <RouterLink
                v-for="tile in tiles" :key="tile.id" :to="`/browse/${isChannels ? 'channel' : 'category'}/${tile.id}`"
                :class="['tile', isChannels ? '' : 'imageTile']"
                :style="!isChannels && tile.thumbnail ? { 'background-image': `url(${getThumbnailUrl(tile.thumbnail)})` } : {}"
            >
                <template v-if="isChannels">
                    <img
                        v-if="tile.logo && !failedLogos[tile.id]" class="channelLogo" :src="getThumbnailUrl(tile.logo)"
                        :alt="tile.title" @error="failedLogos[tile.id] = true"
                    />
                    <!-- Logo already carries the channel name; fall back to text only when there's no logo to show. -->
                    <span v-else class="channelName">{{ tile.title }}</span>
                    <!-- Not editing: read-only status, only for what's on. -->
                    <span v-if="tile.live && !editing" class="statusBadge">
                        <font-awesome-icon v-if="isSubscribed(tile.id)" :icon="['fas', 'bell']" title="In the library" />
                        <font-awesome-icon
                            v-if="liveTvEnabled && isLiveTvSelected(tile.id)" :icon="['fas', 'tv']" title="In Jellyfin Live TV"
                        />
                    </span>
                    <button
                        v-if="tile.live && editing" :class="['liveButton', 'libraryButton', isSubscribed(tile.id) ? 'on' : '']" type="button" :disabled="isBusy(tile.id)"
                        :title="isSubscribed(tile.id) ? `${tile.title} is in the library - click to remove` : `Add ${tile.title} to the library`"
                        @click.prevent.stop="toggleLibrary(tile)"
                    >
                        <font-awesome-icon :icon="['fas', 'bell']" />
                    </button>
                    <button
                        v-if="tile.live && liveTvEnabled && editing" :class="['liveButton', 'liveTvButton', isLiveTvSelected(tile.id) ? 'on' : '']" type="button"
                        :disabled="isLiveTvBusy(tile.id)"
                        :title="isLiveTvSelected(tile.id) ? `${tile.title} is in Jellyfin Live TV - click to remove` : `Add ${tile.title} to Jellyfin Live TV`"
                        @click.prevent.stop="liveTvToggle(tile.id)"
                    >
                        <font-awesome-icon :icon="['fas', 'tv']" />
                    </button>
                    <button
                        v-if="tile.live" class="liveButton" type="button" :title="`Watch ${tile.title} live`"
                        @click.prevent.stop="watchLive(tile)"
                    >
                        <font-awesome-icon :icon="['fas', 'play']" />
                    </button>
                </template>
                <span v-else class="tileTitle">{{ tile.title }}</span>
            </RouterLink>
        </div>
    </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import InfoBar from '@/components/common/InfoBar.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { browseFetch } from '@/lib/browse';
import dialogService from '@/lib/dialogService';
import { useLiveSubscriptions } from '@/lib/liveSubscriptions';
import { useLiveTv } from '@/lib/liveTv';
import { playInPip } from '@/lib/pipPlayer';
import { getThumbnailUrl } from '@/lib/utils';

const route = useRoute();
const tiles = ref([]);
// Channel logos that failed to load fall back to the text label.
const failedLogos = reactive({});
const loading = ref(true);
const error = ref(null);

// One view for both listings: the route's meta says which.
const isChannels = computed(() => route.meta.tiles === 'channels');

const watchLive = (tile) => playInPip(tile.id, `${tile.title} (Live)`, true);

// Edit mode reveals the Subscribe all / Live TV all buttons and the per-channel toggles; otherwise
// tiles just show play plus a small read-only status badge.
const editing = ref(false);

const { allBusy, load: loadLive, isSubscribed, isBusy, subscribe, unsubscribe, subscribeAll, unsubscribeAll } =
    useLiveSubscriptions();
loadLive();

const {
    enabled: liveTvEnabled,
    load: loadLiveTv,
    isSelected: isLiveTvSelected,
    isBusy: isLiveTvBusy,
    toggle: liveTvToggle,
    addAll: liveTvAddAll,
    clear: liveTvClear,
} = useLiveTv();
loadLiveTv();

// Once every live channel is on, the header's "all" buttons flip to removing them all.
const liveTiles = computed(() => tiles.value.filter((t) => t.live));
const allSubscribed = computed(() => liveTiles.value.length > 0 && liveTiles.value.every((t) => isSubscribed(t.id)));
const allLiveTv = computed(() => liveTiles.value.length > 0 && liveTiles.value.every((t) => isLiveTvSelected(t.id)));
// Unsubscribing deletes each channel's .strm from the library, so ask first.
const confirmUnsubscribeAll = async () => {
    if (await dialogService.confirm('Unsubscribe all', 'Remove every live channel from the library? Their .strm files will be deleted.')) {
        await unsubscribeAll();
    }
};
const toggleLibrary = (tile) => (isSubscribed(tile.id) ? unsubscribe(tile.id) : subscribe(tile.id));

watch(
    isChannels,
    async (channels) => {
        loading.value = true;
        error.value = null;
        try {
            tiles.value = await browseFetch(channels ? 'channels' : 'categories');
        } catch (e) {
            error.value = e.message;
        } finally {
            loading.value = false;
        }
    },
    { immediate: true }
);
</script>

<style lang="less" scoped>
// Title and Add all share one line (including on mobile) - the title block's own bottom margin
// moves to the row so the button stays vertically centred on the heading.
.tilesHeader {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 1rem;

    // Needs h1 + class to outrank global.less's `h1.browseTitle` bottom margin, which would
    // otherwise push the heading above the button's centre line.
    h1.browseTitle {
        margin: 0;
    }

    .addAll {
        margin-left: auto;
        padding: 6px 14px;
        border-radius: 4px;
        border: 1px solid @settings-button-border-color;
        background-color: @settings-button-background-color;
        color: @primary-text-color;
        cursor: pointer;
        white-space: nowrap;

        svg {
            margin-right: 6px;
        }

        &:hover:not(:disabled) {
            background-color: @settings-button-hover-background-color;
        }
    }
}

.editToggle.active {
    border-color: @brand-color;
}

.tileGrid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;

    @media (max-width: @mobile-breakpoint) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

.tile {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 18px 16px;
    border-radius: 4px;
    border: 1px solid @settings-button-border-color;
    background-color: @settings-button-background-color;
    color: @primary-text-color;
    text-decoration: none;
    font-size: 16px;
    transition: background-color 150ms, border-color 150ms;

    svg {
        color: @subtle-text-color;
    }

    &:hover {
        background-color: @settings-button-hover-background-color;
        border-color: @brand-color;
    }

    .pill {
        font-size: 14px;
        padding: 2px 8px;
    }

    .channelLogo {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .channelName {
        font-size: 16px;
    }

    .liveButton {
        position: absolute;
        right: 8px;
        bottom: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        padding: 0;
        border: none;
        border-radius: 50%;
        background-color: rgba(0, 0, 0, 0.45);
        color: #fff;
        cursor: pointer;
        opacity: 0.9;

        // Beats the generic `.tile svg` subtle colour above.
        svg {
            color: #fff;
        }

        // Edit-mode toggles (TV top-left, bell bottom-left): white icon = on, black = off.
        &.liveTvButton,
        &.libraryButton {
            right: auto;
            left: 8px;

            &:disabled {
                cursor: default;
                opacity: 0.5;
            }

            svg {
                color: #000;
            }

            &.on svg {
                color: #fff;
            }
        }

        &.liveTvButton {
            bottom: auto;
            top: 8px;
        }

        &:hover {
            opacity: 1;
        }
    }

    // Read-only status outside edit mode: small white bell / TV, bottom-left, shown only when on. No
    // disc behind them, so they don't look like buttons.
    .statusBadge {
        position: absolute;
        bottom: 10px;
        left: 10px;
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;

        svg {
            color: #fff;
        }
    }

    &:not(.imageTile) {
        flex-direction: column;
        justify-content: center;
        text-align: center;
        gap: 4px;
        padding: 14px 12px;

        // Matches the BBC logo SVGs' own viewBox (76x32) so cover never has to crop them.
        &:has(.channelLogo) {
            padding: 0;
            aspect-ratio: 2.375 / 1;
            overflow: hidden;
        }
    }

    // Categories: large artwork tiles with the title over a gradient.
    &.imageTile {
        position: relative;
        align-items: flex-end;
        aspect-ratio: 16 / 9;
        padding: 0;
        overflow: hidden;
        background-size: cover;
        background-position: center;

        .tileTitle {
            width: 100%;
            padding: 28px 12px 10px;
            font-size: 18px;
            box-sizing: border-box;
            background: linear-gradient(to top, rgba(0, 0, 0, 0.85), transparent);
        }

        &:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
        }
    }
}
</style>
