<template>
    <div class="browsePage">
        <PageHeader :title="isChannels ? 'Channels' : 'Categories'">
            <button
                v-if="isChannels && editing && !loading && !error && tiles.some((t) => t.live)"
                type="button"
                class="addAll"
                :title="
                    allSubscribed
                        ? 'Remove every live channel from the library'
                        : 'Subscribe to all live channels (adds them to the library)'
                "
                :disabled="allBusy"
                @click="allSubscribed ? confirmUnsubscribeAll() : subscribeAll()"
            >
                <font-awesome-icon
                    :icon="['fas', allBusy ? 'circle-notch' : allSubscribed ? 'bell-slash' : 'bell']"
                    :spin="allBusy"
                />
                {{ allSubscribed ? 'Unsubscribe all' : 'Subscribe all' }}
            </button>
            <button
                v-if="isChannels && editing && liveTvEnabled && !loading && !error && tiles.some((t) => t.live)"
                type="button"
                class="addAll"
                :title="
                    allLiveTv
                        ? 'Take every channel out of Jellyfin Live TV'
                        : 'Offer every live channel to Jellyfin Live TV'
                "
                :disabled="isLiveTvBusy('all')"
                @click="allLiveTv ? liveTvClear() : liveTvAddAll()"
            >
                <font-awesome-icon
                    :icon="['fas', isLiveTvBusy('all') ? 'circle-notch' : 'tv']"
                    :spin="isLiveTvBusy('all')"
                />
                {{ allLiveTv ? 'Live TV none' : 'Live TV all' }}
            </button>
            <button
                v-if="!isChannels && !loading && !error"
                type="button"
                :class="['addAll', 'editToggle', featuring ? 'active' : '']"
                :title="featuring ? 'Done' : 'Choose which categories are featured on Discover'"
                @click="featuring = !featuring"
            >
                <font-awesome-icon :icon="['fas', featuring ? 'check' : 'compass']" />
                {{ featuring ? 'Done' : 'Discover' }}
            </button>
            <button
                v-if="isChannels && !loading && !error"
                type="button"
                :class="['addAll', 'editToggle', arranging ? 'active' : '']"
                :title="arranging ? 'Done arranging' : 'Reorder, enable or disable channels'"
                @click="toggleArranging"
            >
                <font-awesome-icon :icon="['fas', arranging ? 'check' : 'grip']" />
                {{ arranging ? 'Done' : 'Arrange' }}
            </button>
            <button
                v-if="isChannels && !arranging && !loading && !error && tiles.some((t) => t.live)"
                type="button"
                :class="['addAll', 'editToggle', editing ? 'active' : '']"
                :title="editing ? 'Done editing' : 'Edit library and Live TV channels'"
                @click="editing = !editing"
            >
                <font-awesome-icon :icon="['fas', editing ? 'check' : 'pen']" />
                {{ editing ? 'Done' : 'Edit' }}
            </button>
        </PageHeader>
        <LoadingIndicator v-if="loading" />
        <InfoBar v-else-if="error" clazz="danger">{{ error }}</InfoBar>
        <InfoBar v-if="arranging && !loading && !error">
            Drag channels (or use the arrows) into the order you want. Use the eye to switch a channel off. The compass
            features a channel as a rail on the Discover page (up to 4, shown in this order).
        </InfoBar>
        <InfoBar v-if="featuring && !loading && !error">
            Use the compass to feature up to 2 categories as rails on the Discover page. With none chosen, Discover
            shows 2 random categories.
        </InfoBar>
        <div v-if="!loading && !error" class="tileGrid">
            <RouterLink
                v-for="tile in shownTiles"
                :key="tile.id"
                :to="`/browse/${isChannels ? 'channel' : 'category'}/${tile.id}`"
                :class="[
                    'tile',
                    isChannels ? '' : 'imageTile',
                    arranging ? 'arranging' : '',
                    tile.enabled === false ? 'disabled' : '',
                    dragId === tile.id ? 'dragging' : '',
                ]"
                :style="
                    !isChannels && tile.thumbnail
                        ? { 'background-image': `url(${getThumbnailUrl(tile.thumbnail, true)})` }
                        : {}
                "
                :draggable="arranging"
                @click.capture="onTileClick($event)"
                @dragstart="onDragStart($event, tile)"
                @dragend="dragId = null"
                @dragover.prevent
                @drop.prevent="onDrop(tile)"
            >
                <template v-if="isChannels">
                    <img
                        v-if="tile.logo && !failedLogos[tile.id]"
                        class="channelLogo"
                        :src="getThumbnailUrl(tile.logo)"
                        :alt="tile.title"
                        @error="failedLogos[tile.id] = true"
                    />
                    <!-- Logo already carries the channel name; fall back to text only when there's no logo to show. -->
                    <span v-if="!tile.logo || failedLogos[tile.id]" class="channelName">{{ tile.title }}</span>
                    <template v-if="arranging">
                        <button
                            class="arrangeButton arrangeEye"
                            type="button"
                            :disabled="isArrangeBusy(tile.id)"
                            :title="tile.enabled === false ? `Enable ${tile.title}` : `Disable ${tile.title}`"
                            @click.prevent.stop="toggleEnabled(tile)"
                        >
                            <font-awesome-icon :icon="['fas', tile.enabled === false ? 'eye-slash' : 'eye']" />
                        </button>
                        <button
                            :class="['arrangeButton', 'arrangeDiscover', tile.discover ? 'on' : '']"
                            type="button"
                            :disabled="isArrangeBusy(tile.id)"
                            :title="
                                tile.discover
                                    ? `${tile.title} is featured on Discover - click to remove`
                                    : `Feature ${tile.title} on Discover`
                            "
                            @click.prevent.stop="toggleDiscover(tile)"
                        >
                            <font-awesome-icon :icon="['fas', 'compass']" />
                        </button>
                        <button
                            class="arrangeButton arrangeBack"
                            type="button"
                            title="Move earlier"
                            @click.prevent.stop="shift(tile, -1)"
                        >
                            <font-awesome-icon :icon="['fas', 'chevron-left']" />
                        </button>
                        <button
                            class="arrangeButton arrangeForward"
                            type="button"
                            title="Move later"
                            @click.prevent.stop="shift(tile, 1)"
                        >
                            <font-awesome-icon :icon="['fas', 'chevron-right']" />
                        </button>
                        <div class="arrangeInfo">
                            <div class="arrangeName">{{ tile.title }}</div>
                            <code class="arrangeVpid">{{ tile.vpid }}</code>
                        </div>
                    </template>
                    <!-- Not editing: read-only status, only for what's on. -->
                    <span v-if="tile.live && !editing && !arranging" class="statusBadge">
                        <font-awesome-icon
                            v-if="isSubscribed(tile.id)"
                            :icon="['fas', 'bell']"
                            title="In the library"
                        />
                        <font-awesome-icon
                            v-if="liveTvEnabled && isLiveTvSelected(tile.id)"
                            :icon="['fas', 'tv']"
                            title="In Jellyfin Live TV"
                        />
                    </span>
                    <button
                        v-if="tile.live && editing && !arranging"
                        :class="['liveButton', 'libraryButton', isSubscribed(tile.id) ? 'on' : '']"
                        type="button"
                        :disabled="isBusy(tile.id)"
                        :title="
                            isSubscribed(tile.id)
                                ? `${tile.title} is in the library - click to remove`
                                : `Add ${tile.title} to the library`
                        "
                        @click.prevent.stop="toggleLibrary(tile)"
                    >
                        <font-awesome-icon :icon="['fas', 'bell']" />
                    </button>
                    <button
                        v-if="tile.live && liveTvEnabled && editing && !arranging"
                        :class="['liveButton', 'liveTvButton', isLiveTvSelected(tile.id) ? 'on' : '']"
                        type="button"
                        :disabled="isLiveTvBusy(tile.id)"
                        :title="
                            isLiveTvSelected(tile.id)
                                ? `${tile.title} is in Jellyfin Live TV - click to remove`
                                : `Add ${tile.title} to Jellyfin Live TV`
                        "
                        @click.prevent.stop="liveTvToggle(tile.id)"
                    >
                        <font-awesome-icon :icon="['fas', 'tv']" />
                    </button>
                    <button
                        v-if="tile.live && !arranging"
                        class="liveButton"
                        type="button"
                        :title="`Watch ${tile.title} live`"
                        @click.prevent.stop="watchLive(tile)"
                    >
                        <font-awesome-icon :icon="['fas', 'play']" />
                    </button>
                </template>
                <template v-else>
                    <span class="tileTitle">{{ tile.title }}</span>
                    <button
                        v-if="featuring"
                        :class="['arrangeButton', 'arrangeDiscover', tile.discover ? 'on' : '']"
                        type="button"
                        :disabled="isArrangeBusy(tile.id)"
                        :title="
                            tile.discover
                                ? `${tile.title} is featured on Discover - click to remove`
                                : `Feature ${tile.title} on Discover`
                        "
                        @click.prevent.stop="toggleCategoryDiscover(tile)"
                    >
                        <font-awesome-icon :icon="['fas', 'compass']" />
                    </button>
                </template>
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
import { ipFetch } from '@/lib/ipFetch';
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

// Arrange mode (Channels only): drag tiles into order and switch channels on or off. Switched-off ones
// keep their place but are hidden outside this mode.
const arranging = ref(false);
const dragId = ref(null);
const arrangeBusy = reactive({});
const isArrangeBusy = (id) => !!arrangeBusy[id];
const shownTiles = computed(() =>
    isChannels.value && !arranging.value ? tiles.value.filter((t) => t.enabled !== false) : tiles.value
);

const toggleArranging = () => {
    arranging.value = !arranging.value;
    editing.value = false;
};

// Categories page: feature up to 2 categories on Discover.
const featuring = ref(false);

const toggleCategoryDiscover = async (tile) => {
    arrangeBusy[tile.id] = true;
    const { ok, data } = await ipFetch(`json-api/browse/categories/${tile.id}/discover`, 'PUT', {
        enabled: !tile.discover,
    });
    arrangeBusy[tile.id] = false;
    if (ok) {
        tiles.value.forEach((t) => (t.discover = data.includes(t.id)));
    } else {
        dialogService.alert('Error', data?.message || 'Unable to update Discover');
    }
};

// Features the channel as a rail on the Discover page (or takes it off).
const toggleDiscover = async (tile) => {
    arrangeBusy[tile.id] = true;
    const { ok, data } = await ipFetch(`json-api/live-channels/${tile.id}/discover`, 'PUT', {
        enabled: !tile.discover,
    });
    arrangeBusy[tile.id] = false;
    if (ok) {
        tile.discover = !tile.discover;
    } else {
        dialogService.alert('Error', data?.message || 'Unable to update Discover');
    }
};

// Runs in the capture phase: RouterLink navigates from its own click handler, and only skips navigating
// if the event is already default-prevented. A tile's own buttons (play, compass, eye...) handle themselves.
const onTileClick = (event) => {
    if (arranging.value || featuring.value) event.preventDefault();
};

const saveOrder = async () => {
    const { ok, data } = await ipFetch('json-api/live-channels/order', 'PUT', { ids: tiles.value.map((t) => t.id) });
    if (!ok) dialogService.alert('Error', data?.message || 'Unable to save the channel order');
};

const moveTile = (fromId, toId) => {
    const list = [...tiles.value];
    const from = list.findIndex((t) => t.id === fromId);
    const to = list.findIndex((t) => t.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    list.splice(to, 0, ...list.splice(from, 1));
    tiles.value = list;
    saveOrder();
};

const onDragStart = (event, tile) => {
    if (!arranging.value) return;
    dragId.value = tile.id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', tile.id);
};

const onDrop = (tile) => {
    if (arranging.value && dragId.value) moveTile(dragId.value, tile.id);
    dragId.value = null;
};

// The arrows are the touch-friendly alternative to dragging.
const shift = (tile, delta) => {
    const index = tiles.value.findIndex((t) => t.id === tile.id);
    const target = tiles.value[index + delta];
    if (target) moveTile(tile.id, target.id);
};

const toggleEnabled = async (tile) => {
    const enabled = tile.enabled === false;
    if (
        !enabled &&
        !(await dialogService.confirm(
            `Disable ${tile.title}`,
            `Disable ${tile.title}?`,
            'It will be hidden from here and removed from your library and Jellyfin Live TV if it is in them.'
        ))
    ) {
        return;
    }
    arrangeBusy[tile.id] = true;
    const { ok, data } = await ipFetch(`json-api/live-channels/${tile.id}`, 'PUT', { enabled });
    arrangeBusy[tile.id] = false;
    if (!ok) {
        dialogService.alert('Error', data?.message || 'Unable to update the channel');
        return;
    }
    tile.enabled = enabled;
    tile.live = enabled;
    // Disabling may have unsubscribed it or taken it out of Live TV.
    loadLive();
    loadLiveTv();
};

// Edit mode reveals the Subscribe all / Live TV all buttons and the per-channel toggles; otherwise
// tiles just show play plus a small read-only status badge.
const editing = ref(false);

const {
    allBusy,
    load: loadLive,
    isSubscribed,
    isBusy,
    subscribe,
    unsubscribe,
    subscribeAll,
    unsubscribeAll,
} = useLiveSubscriptions();
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
    if (
        await dialogService.confirm(
            'Unsubscribe all',
            'Remove every live channel from the library? Their .strm files will be deleted.'
        )
    ) {
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
    transition:
        background-color 150ms,
        border-color 150ms;

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

    // Arrange mode: the tile grows to hold a name + vpid strip under its (still standard-sized) logo.
    &.arranging {
        cursor: grab;
        user-select: none;

        &:has(.channelLogo) {
            aspect-ratio: auto;
            overflow: visible;
            padding: 0 0 8px;
        }

        .channelLogo {
            aspect-ratio: 2.375 / 1;
            height: auto;
            border-radius: 4px 4px 0 0;
            pointer-events: none;
        }

        &.disabled {
            opacity: 0.5;

            .channelLogo {
                filter: grayscale(1);
            }
        }

        &.dragging {
            opacity: 0.35;
            border-style: dashed;
        }

        .arrangeInfo {
            padding: 6px 10px 0;
            width: 100%;
            box-sizing: border-box;
            text-align: center;

            .arrangeName {
                font-size: 14px;
            }

            .arrangeVpid {
                font-size: 11px;
                color: @subtle-text-color;
                word-break: break-all;
            }
        }

        .arrangeButton {
            position: absolute;
            top: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            padding: 0;
            border: none;
            border-radius: 50%;
            background-color: rgba(0, 0, 0, 0.55);
            cursor: pointer;

            svg {
                color: #fff;
            }

            &:disabled {
                cursor: default;
                opacity: 0.5;
            }

            &.arrangeEye {
                right: 8px;
            }

            &.arrangeBack {
                left: 8px;
            }

            &.arrangeForward {
                left: 42px;
            }
        }
    }

    // Compass: lit when the channel/category has a rail on Discover. Shared by Arrange (channels) and the
    // categories' Discover mode.
    .arrangeButton.arrangeDiscover {
        position: absolute;
        top: 8px;
        right: 42px;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: none;
        border-radius: 50%;
        background-color: rgba(0, 0, 0, 0.55);
        cursor: pointer;

        svg {
            color: #888;
        }

        &.on svg {
            color: #fff;
        }

        &:disabled {
            cursor: default;
            opacity: 0.5;
        }
    }

    &.imageTile .arrangeButton.arrangeDiscover {
        right: 8px;
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
