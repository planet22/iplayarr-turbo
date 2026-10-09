<template>
    <IPlayarrModal
        :title="`Add ${term} to ${app.name}`"
        :show-close="true"
        close-label="Cancel"
        :show-confirm="!loading && !!selected"
        :confirm-label="selected?.existingId ? 'Link' : 'Add'"
        @confirm="confirm"
    >
        <form class="searchRow" @submit.prevent="search">
            <input v-model="searchTerm" type="text" placeholder="Search by title" :disabled="loading" />
            <button type="submit" class="clickable" :disabled="loading || !searchTerm.trim()">
                <font-awesome-icon :icon="['fas', 'magnifying-glass']" /> Search
            </button>
        </form>
        <LoadingIndicator v-if="loading" />
        <div v-else-if="errorMessage" class="lookupError">
            <p>{{ errorMessage }}</p>
            <button type="button" class="clickable" @click="retry">
                <font-awesome-icon :icon="['fas', 'rotate']" /> Retry
            </button>
        </div>
        <template v-else>
            <p v-if="results.length === 0">No matches found in {{ app.name }}. Try a different title above.</p>
            <template v-else>
                <p class="hint">Pick the matching entry from {{ app.name }}.</p>
                <div class="matchGrid">
                    <button
                        v-for="result of results"
                        :key="result.externalId"
                        type="button"
                        :class="['matchCard', 'clickable', { selected: selected === result }]"
                        @click="selected = result"
                    >
                        <img v-if="result.poster" :src="result.poster" :alt="result.title" loading="lazy" @error="hideBrokenImage" />
                        <div v-else class="noPoster"><font-awesome-icon :icon="['fas', 'tv']" /></div>
                        <div class="matchInfo">
                            <div class="matchTitle">
                                {{ result.title }}<span v-if="result.year" class="year"> ({{ result.year }})</span>
                            </div>
                            <div class="matchMeta">
                                <span v-if="result.network">{{ result.network }}</span>
                                <span v-if="result.seasonCount">{{ result.seasonCount }} season{{ result.seasonCount === 1 ? '' : 's' }}</span>
                                <span v-if="result.runtime">{{ result.runtime }} min</span>
                                <span v-if="result.certification">{{ result.certification }}</span>
                                <span v-if="result.rating" title="Rating"><font-awesome-icon :icon="['fas', 'star']" /> {{ result.rating.toFixed(1) }}</span>
                                <span v-if="result.status" class="pill">{{ result.status }}</span>
                                <span v-if="result.existingId" class="pill">Already in library</span>
                            </div>
                            <div v-if="result.genres" class="matchGenres">{{ result.genres.join(', ') }}</div>
                            <p v-if="result.overview" class="matchOverview">{{ result.overview }}</p>
                        </div>
                    </button>
                </div>
                <div v-if="selected && selected.existingId" class="hint">
                    This is already in {{ app.name }}, so it will only be linked to the subscription. Unlinking later will never remove it from {{ app.name }}.
                </div>
                <div v-else-if="selected" class="addSettings">
                    <SelectInput v-model="rootFolderPath" name="Root folder" tooltip="" :options="folderOptions" />
                    <SelectInput v-model="qualityProfileId" name="Quality profile" tooltip="" :options="profileOptions" />
                </div>
            </template>
        </template>
    </IPlayarrModal>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';

import { ipFetch } from '@/lib/ipFetch';
import { hideBrokenImage } from '@/lib/utils';

import SelectInput from '../common/form/SelectInput.vue';
import LoadingIndicator from '../common/LoadingIndicator.vue';
import IPlayarrModal from './IPlayarrModal.vue';

const emit = defineEmits(['select']);
const props = defineProps({
    app: { type: Object, required: true },
    term: { type: String, required: true },
});

const loading = ref(true);
const errorMessage = ref('');
const searchTerm = ref(props.term);
const results = ref([]);
const rootFolders = ref([]);
const qualityProfiles = ref([]);
const optionsLoaded = ref(false);
const selected = ref(undefined);
const rootFolderPath = ref('');
const qualityProfileId = ref(0);

const base = computed(() => `json-api/subscriptions/arr/apps/${props.app.id}`);
const folderOptions = computed(() => rootFolders.value.map(({ path }) => ({ key: path, value: path })));
const profileOptions = computed(() => qualityProfiles.value.map(({ id, name }) => ({ key: id, value: name })));

// Root folders and quality profiles are loaded once; a failed load is retried with the next search.
const loadOptions = async () => {
    if (optionsLoaded.value) return true;
    const options = await ipFetch(`${base.value}/options`);
    if (!options.ok) {
        errorMessage.value = options.data?.message || 'Unable to load root folders and quality profiles';
        return false;
    }
    rootFolders.value = options.data.rootFolders;
    qualityProfiles.value = options.data.qualityProfiles;
    rootFolderPath.value = rootFolders.value[0]?.path ?? '';
    qualityProfileId.value = qualityProfiles.value[0]?.id ?? 0;
    optionsLoaded.value = true;
    return true;
};

// Failures (e.g. Sonarr's metadata service being down) stay in the dialog with a Retry rather than
// closing it, and the title can be edited since BBC and TVDB/TMDB names don't always match.
const search = async () => {
    const term = searchTerm.value.trim();
    if (!term) return;
    loading.value = true;
    errorMessage.value = '';
    selected.value = undefined;
    try {
        const [lookup, optionsOk] = await Promise.all([
            ipFetch(`${base.value}/lookup?term=${encodeURIComponent(term)}`),
            loadOptions(),
        ]);
        if (!optionsOk) return;
        if (!lookup.ok) {
            errorMessage.value = lookup.data?.message || `Lookup failed in ${props.app.name}`;
            return;
        }
        results.value = lookup.data.slice(0, 12);
        // A single obvious match needs no extra click.
        if (results.value.length === 1) selected.value = results.value[0];
    } catch {
        errorMessage.value = 'Unable to reach iPlayarr';
    } finally {
        loading.value = false;
    }
};

const retry = search;

onMounted(search);

const confirm = () => {
    if (!selected.value || !rootFolderPath.value || !qualityProfileId.value) return;
    emit('select', {
        match: selected.value,
        rootFolderPath: rootFolderPath.value,
        qualityProfileId: qualityProfileId.value,
    });
};
</script>

<style lang="less" scoped>
.searchRow {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;

    input {
        flex: 1;
        min-width: 0;
        box-sizing: border-box;
        height: 35px;
        padding: 6px 12px;
        border: 1px solid @input-border-color;
        border-radius: 4px;
        background-color: @input-background-color;
        color: @input-text-color;
    }

    button {
        padding: 0 14px;
        height: 35px;
        border-radius: 4px;
        border: 1px solid @settings-button-border-color;
        background-color: @settings-button-background-color;
        color: @primary-text-color;

        &:hover:not(:disabled) {
            background-color: @settings-button-hover-background-color;
        }
    }
}

.lookupError {
    p {
        color: @error-color;
        font-size: 14px;
    }

    button {
        padding: 6px 14px;
        border-radius: 4px;
        border: 1px solid @settings-button-border-color;
        background-color: @settings-button-background-color;
        color: @primary-text-color;

        &:hover {
            background-color: @settings-button-hover-background-color;
        }
    }
}

.hint {
    color: @subtle-text-color;
    font-size: 14px;
}

.matchGrid {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 55vh;
    overflow-y: auto;

    // The modal body is capped at 75vh on desktop: leave room for the search box, root folder and
    // quality profile selectors and the buttons so they never fall below the fold.
    @media (min-width: @mobile-breakpoint) {
        max-height: ~'max(160px, calc(75vh - 330px))';
    }
    margin-bottom: 1rem;
}

.matchCard {
    display: flex;
    gap: 14px;
    width: 100%;
    padding: 10px;
    text-align: left;
    border: 2px solid @table-border-color;
    border-radius: 6px;
    background-color: @nav-background-color;
    color: @primary-text-color;

    &:hover {
        background-color: @table-row-hover-color;
    }

    &.selected {
        border-color: @brand-color;
    }

    img,
    .noPoster {
        flex: 0 0 90px;
        width: 90px;
        aspect-ratio: 2 / 3;
        object-fit: cover;
        border-radius: 4px;
        background-color: @toolbar-background-color;
    }

    .noPoster {
        display: flex;
        align-items: center;
        justify-content: center;
        color: @subtle-text-color;
    }

    .matchInfo {
        flex: 1;
        min-width: 0;
    }

    .matchTitle {
        font-size: 17px;
        font-weight: bold;

        .year {
            font-weight: normal;
            color: @subtle-text-color;
        }
    }

    .matchMeta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 12px;
        margin-top: 4px;
        font-size: 12px;
        color: @subtle-text-color;
    }

    .matchGenres {
        margin-top: 4px;
        font-size: 12px;
        color: @subtle-text-color;
    }

    .matchOverview {
        display: -webkit-box;
        -webkit-line-clamp: 4;
        line-clamp: 4;
        -webkit-box-orient: vertical;
        overflow: hidden;
        margin: 6px 0 0;
        font-size: 13px;
    }

    @media (max-width: @mobile-breakpoint) {
        img,
        .noPoster {
            flex-basis: 64px;
            width: 64px;
        }
    }
}
</style>
