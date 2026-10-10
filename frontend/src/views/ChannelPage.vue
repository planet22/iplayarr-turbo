<template>
    <div class="browsePage">
        <div class="channelHeader">
            <h1 class="browseTitle">{{ channel?.title ?? route.params.id }}</h1>
            <button v-if="channel?.live" class="watchLive" type="button" @click="watchLive">
                <font-awesome-icon :icon="['fas', 'play']" /> Watch Live
            </button>
        </div>
        <LoadingIndicator v-if="loading" />
        <InfoBar v-else-if="error" clazz="danger">{{ error }}</InfoBar>
        <template v-else>
            <div v-if="nowNext?.now || nowNext?.next" class="nowNext">
                <RouterLink
                    v-for="slot in slots" :key="slot.label" :to="`/browse/programme/${slot.data.item.pid}`"
                    class="nowNextCard"
                >
                    <img v-if="slot.data.item.thumbnail" :src="getThumbnailUrl(slot.data.item.thumbnail)" :alt="slot.data.item.title" @error="hideBrokenImage" />
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
            <p v-if="rails.length === 0">Nothing found for this channel.</p>
        </template>
    </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import ProgrammeRail from '@/components/browse/ProgrammeRail.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import { browseFetch } from '@/lib/browse';
import { playInPip } from '@/lib/pipPlayer';
import { getThumbnailUrl, hideBrokenImage } from '@/lib/utils';

const route = useRoute();
const channel = ref(null);
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

watch(
    () => route.params.id,
    async (id) => {
        if (!id) return;
        loading.value = true;
        error.value = null;
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

.watchLive {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    border: none;
    border-radius: 4px;
    background-color: @brand-color;
    color: #fff;
    font-size: 14px;
    cursor: pointer;

    &:hover {
        opacity: 0.85;
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
    background-color: @brand-color;
    color: #fff;
    cursor: pointer;
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
</style>
