<template>
    <DataCard class="streamCard">
        <template #thumb>
            <img
                v-if="thumbnail"
                class="clickable"
                :class="{ channelLogo: session.live }"
                :src="thumbnail"
                @click="emit('info')"
                @error="hideBrokenImage"
            />
            <div v-else class="thumbnail-placeholder"></div>
        </template>
        <template #title>
            <a class="clickable" @click="emit('info')">{{ title }}</a>
        </template>
        <template v-if="subtitle" #subtitle>{{ subtitle }}</template>
        <template #chips>
            <StreamPills plain :mode="mode" :resolution="session.resolution" :settings="session.settings" />
        </template>
        <div v-if="hasRate || hasLiveBadge || hasSegments" class="streamFacts">
            <ThroughputSpark
                v-if="hasRate"
                :throughput="session.throughput"
                :now="now"
                :ended-at="history ? session.endedAt : null"
                :started-at="history ? session.startedAt : null"
                :bytes-transferred="session.bytesTransferred ?? 0"
            />
            <span v-if="hasLiveBadge" class="liveBadge"><span class="liveDot" />Live</span>
            <SegmentActivityStrip
                v-else-if="hasSegments"
                :total="session.totalSegments"
                :delivered="session.deliveredSegments ?? []"
                :current-segment-index="session.currentSegmentIndex ?? null"
                :cell-size="3"
                :max-cols="40"
                :max-rows="5"
                @click="emit('segments')"
            />
        </div>
        <template #foot>
            <span class="footFacts">
                <span v-for="fact in facts" :key="fact" class="footFact">{{ fact }}</span>
            </span>
            <button
                v-if="!history"
                type="button"
                class="stopAction clickable"
                :class="{ disabled: stopping }"
                title="Stop stream"
                aria-label="Stop stream"
                @click="emit('stop')"
            >
                <font-awesome-icon :icon="['fas', 'stop']" />
            </button>
        </template>
    </DataCard>
</template>

<script setup>
import { computed, defineEmits, defineProps } from 'vue';

import DataCard from '@/components/common/DataCard.vue';
import { hideBrokenImage } from '@/lib/utils';

import SegmentActivityStrip from './SegmentActivityStrip.vue';
import StreamPills from './StreamPills.vue';
import ThroughputSpark from './ThroughputSpark.vue';

const props = defineProps({
    session: { type: Object, required: true },
    // A finished session (no stop button, throughput anchored to when it ended).
    history: { type: Boolean, default: false },
    thumbnail: { type: String, default: '' },
    title: { type: String, required: true },
    subtitle: { type: String, default: '' },
    mode: { type: String, default: '' },
    clientIp: { type: String, default: '' },
    started: { type: String, default: '' },
    duration: { type: String, default: '' },
    transferred: { type: String, default: '' },
    now: { type: Number, required: true },
    stopping: { type: Boolean, default: false },
});
const emit = defineEmits(['info', 'stop', 'segments']);

// A throughput graph only once something has been sent, so a stream with nothing to show leaves no empty gap.
const hasRate = computed(() => Boolean(props.session.throughput || props.session.bytesTransferred));
const hasLiveBadge = computed(() => props.session.live && !props.history);
const hasSegments = computed(() => !props.session.live && Boolean(props.session.totalSegments));

// Who watched, when, for how long, how much: each its own item, so a narrow card wraps between them, never inside one.
const facts = computed(() => [props.clientIp, props.started, props.duration, props.transferred].filter(Boolean));
</script>

<style lang="less" scoped>
.streamFacts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
}

.footFacts {
    display: flex;
    flex-wrap: wrap;
    gap: 0 12px;
    min-width: 0;
}

.footFact {
    white-space: nowrap;
}

// Tablet and up: the card is wide, so it lays out in one row (poster, title and pills, rate and segments, then who/when/how
// much) instead of the phone's stack; on a very wide screen the cards sit two across.
@media (min-width: 700px) {
    .streamCard.dataCard {
        grid-template-columns: auto minmax(0, 1fr) 152px 200px;
        align-items: center;
        gap: 8px 10px;

        // Tablet: a slightly smaller poster leaves the pills room for two lines.
        @media (max-width: 1099px) {
            :deep(.dcThumb img),
            :deep(.dcThumb .thumbnail-placeholder) {
                width: 84px;
                height: 47px;
            }
        }

        :deep(.dcMain) {
            grid-column: 3;
            grid-row: 1;
        }

        :deep(.dcFoot) {
            grid-column: 4;
            grid-row: 1;
            justify-content: space-between;
        }
    }

    // Fixed-width facts and footer columns, so every card (running or finished) lays out the same.
    .streamFacts {
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
    }

    .footFacts {
        flex-direction: column;
        gap: 2px;
    }
}

.stopAction {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    font-size: 14px;
    color: @primary-text-color;
    background-color: @settings-button-hover-background-color;
    border: 1px solid @settings-button-border-color;
    border-radius: 4px;

    &:hover {
        border-color: @settings-button-hover-border-color;
    }
}

.disabled {
    opacity: 0.4;
    pointer-events: none;
}
</style>
