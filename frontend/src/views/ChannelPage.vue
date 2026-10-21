<template>
    <div class="browsePage">
        <PageHeader :title="pageTitle">
            <img
                v-if="channel?.logo && !logoFailed"
                class="headerLogo"
                :src="getThumbnailUrl(channel.logo)"
                :alt="channel.title"
                @error="logoFailed = true"
            />
        </PageHeader>
        <SettingsPageToolbar>
            <template #actions>
                <!-- Read-only status; the toggles live on the Channels page's edit mode. -->
                <template v-if="channel?.live">
                    <span v-if="isSubscribed(channel.id)" class="statusIcon" title="Live channel subscribed">
                        <font-awesome-icon :icon="['fas', 'bell']" />
                    </span>
                    <span v-if="liveTvEnabled && isLiveTvSelected(channel.id)" class="statusIcon" title="In Jellyfin Live TV">
                        <font-awesome-icon :icon="['fas', 'tv']" />
                    </span>
                </template>
                <button v-if="channel?.live" type="button" :title="`Watch ${channel.title} live`" @click="watchLive">
                    <font-awesome-icon :icon="['fas', 'play']" />
                </button>
            </template>
        </SettingsPageToolbar>
        <SkeletonLoader v-if="loading" variant="rails" />
        <ErrorState v-else-if="error" :message="error" @retry="reload" />
        <template v-else>
            <div v-if="nowNext?.now || nowNext?.next" class="nowNext">
                <RouterLink
                    v-for="slot in slots" :key="slot.label" :to="`/browse/programme/${slot.data.item.pid}`"
                    class="nowNextCard"
                >
                    <img v-if="slot.data.item.thumbnail" :src="getThumbnailUrl(slot.data.item.thumbnail, true)" :alt="slot.data.item.title" @error="hideBrokenImage" />
                    <div v-else class="nowNextNoThumb"><font-awesome-icon :icon="['fas', 'tv']" /></div>
                    <button
                        v-if="slot.label === 'Now' && channel?.live" class="nowPlay" type="button"
                        title="Watch live" @click.prevent.stop="watchLive"
                    >
                        <font-awesome-icon :icon="['fas', 'play']" />
                    </button>
                    <div class="nowNextInfo">
                        <span :class="['nowNextLabel', slot.label === 'Now' ? 'live' : '']">{{ slot.label }}</span>
                        <div class="nowNextTitle">{{ slot.data.item.title }}</div>
                        <div v-if="slot.data.item.subtitle" class="nowNextSubtitle">{{ slot.data.item.subtitle }}</div>
                        <div class="nowNextTime">{{ formatTime(slot.data.start) }} - {{ formatTime(slot.data.end) }}</div>
                    </div>
                </RouterLink>
            </div>
            <ProgrammeRail v-for="rail in rails" :key="rail.id" :title="rail.title" :items="rail.items" />
            <p v-if="rails.length === 0 && channel?.liveOnly && !nowNext">
                This is a live stream only, with no schedule or programmes.
            </p>
            <p v-else-if="rails.length === 0">Nothing found for this channel.</p>
        </template>
    </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import ProgrammeRail from '@/components/browse/ProgrammeRail.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import SkeletonLoader from '@/components/common/SkeletonLoader.vue';
import { browseFetch } from '@/lib/browse';
import { useLiveSubscriptions } from '@/lib/liveSubscriptions';
import { useLiveTv } from '@/lib/liveTv';
import { playInPip } from '@/lib/pipPlayer';
import { getThumbnailUrl, hideBrokenImage } from '@/lib/utils';

const route = useRoute();
const channel = ref(null);
const { enabled: liveTvEnabled, load: loadLiveTv, isSelected: isLiveTvSelected } = useLiveTv();
loadLiveTv();
const { load: loadLive, isSubscribed } = useLiveSubscriptions();
loadLive();
const watchLive = () => playInPip(channel.value.id, `${channel.value.title} (Live)`, true);
const rails = ref([]);
const nowNext = ref(null);

const slots = computed(() =>
    [
        { label: 'Now', data: nowNext.value?.now },
        { label: 'Next', data: nowNext.value?.next },
    ].filter(({ data }) => data)
);
const formatTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const loading = ref(true);
const error = ref(null);
const logoFailed = ref(false);

// The route only has the channel's id (bbc_one_east), which is not a name to show: the title stays blank
// (a non-breaking space, so the bar keeps its height) until the channel has loaded, and falls back to the
// id only if it never does.
const pageTitle = computed(() => channel.value?.title ?? (loading.value ? '\u00a0' : route.params.id));

// Bumped by "Try again" to load the same channel once more.
const reloadKey = ref(0);
const reload = () => reloadKey.value++;

watch(
    () => [route.params.id, reloadKey.value],
    async ([id]) => {
        if (!id) return;
        loading.value = true;
        error.value = null;
        // Moving from one channel to another must not show the previous channel's name meanwhile.
        channel.value = null;
        logoFailed.value = false;
        try {
            const result = await browseFetch(`channel/${encodeURIComponent(id)}`);
            channel.value = result.channel ?? null;
            rails.value = result.rails;
            nowNext.value = result.nowNext ?? null;
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
// The toolbar sits under the title bar; keep a gap before the content (as on the Channels page).
.browsePage :deep(.SettingsPageToolbar) {
    margin-bottom: 12px;
}

// The channel's own logo at the right end of the title bar, in the tiles' 76:32 shape.
.headerLogo {
    display: block;
    height: 30px;
    aspect-ratio: 2.375 / 1;
    object-fit: cover;
    border-radius: 4px;
    margin-bottom: 4px;
}

.channelHeader {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
    margin-bottom: 1rem;

    .browseTitle {
        margin: 0;
    }
}

.nowNext {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 12px;
    margin-bottom: 1.75rem;
}

.nowPlay {
    position: absolute;
    left: 20px;
    top: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background-color: rgba(0, 0, 0, 0.45);
    color: #fff;
    cursor: pointer;

    &:hover {
        background-color: @brand-color;
    }
}

.nowNextCard {
    position: relative;
    display: flex;
    gap: 12px;
    padding: 10px;
    border-radius: 4px;
    border: 1px solid @settings-button-border-color;
    background-color: @settings-button-background-color;
    color: @primary-text-color;
    text-decoration: none;
    min-width: 0;

    &:hover {
        border-color: @brand-color;
    }

    img,
    .nowNextNoThumb {
        flex: 0 0 140px;
        width: 140px;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        border-radius: 4px;
        background-color: @nav-background-color;
    }

    .nowNextNoThumb {
        display: flex;
        align-items: center;
        justify-content: center;
        color: @subtle-text-color;
    }

    .nowNextInfo {
        min-width: 0;
        flex: 1;

        .nowNextLabel {
            display: inline-block;
            padding: 1px 6px;
            margin-bottom: 4px;
            font-size: 11px;
            font-weight: bold;
            text-transform: uppercase;
            border-radius: 2px;
            background-color: @grey-pill-background-color;

            &.live {
                background-color: @brand-color;
                color: @on-brand-color;
            }
        }

        .nowNextTitle,
        .nowNextSubtitle {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .nowNextTitle {
            font-size: 16px;
        }

        .nowNextSubtitle,
        .nowNextTime {
            font-size: 12px;
            color: @subtle-text-color;
        }
    }
}

// Indicators, not buttons: the same box as a toolbar button (padding, margin, height) so they space evenly
// with them, but no outline and no hover.
.statusIcon {
    display: inline-flex;
    align-items: center;
    box-sizing: border-box;
    min-height: 32px;
    margin: 6px 3px;
    padding: 0 13px;
    color: @toolbar-text-color;

    svg {
        height: 21px;
    }
}
</style>
