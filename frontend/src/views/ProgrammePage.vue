<template>
    <LoadingIndicator v-if="loading" />
    <InfoBar v-else-if="error" clazz="danger">{{ error }}</InfoBar>
    <template v-else-if="programme">
        <div class="programmeBanner" :style="bannerStyle">
            <div class="programmeBannerContent">
                <h1>{{ programme.title }}</h1>
                <div class="programmeMeta">
                    <span :class="['pill', 'grey']">
                        <font-awesome-icon :icon="['fas', 'tv']" />
                        {{ programme.kind === 'brand' ? 'Programme' : programme.kind === 'series' ? 'Series' : 'Episode' }}
                    </span>
                    <span v-if="programme.channel" :class="['pill', 'grey']">
                        <font-awesome-icon :icon="['fas', 'tower-broadcast']" />
                        {{ programme.channel }}
                    </span>
                    <span v-if="programme.category" :class="['pill', 'grey']">{{ programme.category }}</span>
                    <span :class="['pill', 'grey']">
                        <a :href="`https://www.bbc.co.uk/programmes/${programme.pid}`" target="_blank" rel="noopener noreferrer">
                            <font-awesome-icon :icon="['fas', 'arrow-up-right-from-square']" />Link
                        </a>
                    </span>
                </div>
                <p v-if="programme.synopsis">{{ programme.synopsis }}</p>
            </div>
        </div>

        <div class="browsePage">
            <p v-if="programme.seasons.length === 0">No episodes are currently available.</p>
            <template v-else>
                <div v-if="programme.seasons.length > 1" class="seasonTabs">
                    <button
                        v-for="(season, index) in programme.seasons"
                        :key="index"
                        :class="['clickable', 'seasonTab', index === selected ? 'active' : '']"
                        @click="selected = index"
                    >
                        {{ seasonLabel(season) }}
                    </button>
                </div>
                <div class="episodeList">
                    <div v-for="episode in episodes" :key="episode.pid" class="episodeRow">
                        <img v-if="episode.thumbnail" :src="getThumbnailUrl(episode.thumbnail)" :alt="episode.title" loading="lazy" />
                        <div v-else class="episodeNoThumb"><font-awesome-icon :icon="['fas', 'tv']" /></div>
                        <div class="episodeInfo">
                            <div class="episodeTitle">
                                <span v-if="getSeriesEpisodeLabel(episode)" class="episodeLabel">{{ getSeriesEpisodeLabel(episode) }}</span>
                                {{ episode.episodeTitle || episode.title }}
                            </div>
                            <div v-if="episode.description" class="episodeDescription">{{ episode.description }}</div>
                            <div class="episodeDetails">
                                <span v-if="episode.runtime">{{ Math.round(episode.runtime) }} min</span>
                                <span v-if="episode.firstBroadcast">{{ formatDate(episode.firstBroadcast) }}</span>
                            </div>
                        </div>
                        <div class="episodeActions">
                            <button v-if="canPlay" class="clickable" title="Play Video" @click="play(episode)">
                                <font-awesome-icon :icon="['fas', 'play']" />
                            </button>
                            <button class="clickable" title="Download" @click="download(episode)">
                                <font-awesome-icon :icon="['fas', 'cloud-download']" />
                            </button>
                        </div>
                    </div>
                </div>
            </template>
        </div>
    </template>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import InfoBar from '@/components/common/InfoBar.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import { browseFetch } from '@/lib/browse';
import { useBrowseActions } from '@/lib/useBrowseActions';
import { formatDate, getSeriesEpisodeLabel, getThumbnailUrl } from '@/lib/utils';

const route = useRoute();
const programme = ref(null);
const loading = ref(true);
const error = ref(null);
const selected = ref(0);

const { canPlay, play, download } = useBrowseActions();

const episodes = computed(() => programme.value?.seasons[selected.value]?.episodes ?? []);

const bannerStyle = computed(() => {
    const url = getThumbnailUrl(programme.value?.thumbnail);
    return url ? { 'background-image': `url(${url})` } : {};
});

const seasonLabel = ({ series }) => (series == null ? 'Episodes' : series === 0 ? 'Specials' : `Series ${series}`);

watch(
    () => route.params.pid,
    async (pid) => {
        if (!pid) return;
        loading.value = true;
        error.value = null;
        selected.value = 0;
        try {
            programme.value = await browseFetch(`programme/${encodeURIComponent(pid)}`);
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
.programmeBanner {
    background-color: @nav-background-color;
    background-size: cover;
    background-position: center;

    .programmeBannerContent {
        padding: 2rem;
        background-color: rgba(0, 0, 0, 0.65);

        h1 {
            margin: 0 0 12px;
            font-size: 42px;
            font-weight: 300;
            text-wrap: balance;

            @media (max-width: @mobile-breakpoint) {
                font-size: 28px;
            }
        }

        p {
            max-width: 720px;
            line-height: 1.4;
        }
    }

    .programmeMeta {
        margin-bottom: 12px;

        .pill.grey {
            padding: 3px 7px;
            margin-right: 10px;
            font-size: 15px;
            font-weight: 300;

            a {
                color: inherit;
                text-decoration: none;
            }
        }
    }
}

.seasonTabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 1rem;

    .seasonTab {
        padding: 6px 14px;
        border-radius: 4px;
        border: 1px solid @settings-button-border-color;
        background-color: @settings-button-background-color;
        color: @primary-text-color;

        &:hover {
            background-color: @settings-button-hover-background-color;
        }

        &.active {
            background-color: @brand-color;
            border-color: @brand-color;
        }
    }
}

.episodeRow {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 12px 0;
    border-bottom: 1px solid @toolbar-background-color;

    img,
    .episodeNoThumb {
        flex: 0 0 160px;
        width: 160px;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        border-radius: 4px;
        background-color: @nav-background-color;

        @media (max-width: @mobile-breakpoint) {
            flex-basis: 100px;
            width: 100px;
        }
    }

    .episodeNoThumb {
        display: flex;
        align-items: center;
        justify-content: center;
        color: @subtle-text-color;
    }

    .episodeInfo {
        flex: 1;
        min-width: 0;

        .episodeTitle {
            font-size: 16px;
        }

        .episodeLabel {
            display: block;
            color: @subtle-text-color;
            font-size: 12px;
        }

        .episodeDescription {
            margin-top: 4px;
            font-size: 13px;
            color: @table-text-color;
            line-height: 1.35;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .episodeDetails {
            margin-top: 4px;
            font-size: 12px;
            color: @subtle-text-color;

            span {
                margin-right: 12px;
            }
        }
    }

    .episodeActions {
        display: flex;
        flex-shrink: 0;
        gap: 8px;

        @media (max-width: @mobile-breakpoint) {
            flex-direction: column;
        }

        button {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            border: 1px solid @settings-button-border-color;
            background-color: @settings-button-background-color;
            color: @primary-text-color;

            &:hover {
                background-color: @brand-color;
                border-color: @brand-color;
            }
        }
    }
}
</style>
