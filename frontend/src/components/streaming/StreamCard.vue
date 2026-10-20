<template>
    <DataCard>
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
            <span class="pill">{{ mode }}</span>
            <span v-if="session.resolution" class="pill grey">{{ session.resolution }}</span>
            <span v-for="chip in chips" :key="chip.label" :class="['pill', chip.cls]">{{ chip.label }}</span>
        </template>
        <div class="streamFacts">
            <ThroughputSpark
                :throughput="session.throughput"
                :now="now"
                :ended-at="history ? session.endedAt : null"
                :started-at="history ? session.startedAt : null"
                :bytes-transferred="session.bytesTransferred ?? 0"
            />
            <span v-if="session.live && !history" class="liveBadge"><span class="liveDot" />Live</span>
            <SegmentActivityStrip
                v-else-if="!session.live && session.totalSegments"
                :total="session.totalSegments"
                :delivered="session.deliveredSegments ?? []"
                :current-segment-index="session.currentSegmentIndex ?? null"
                @click="emit('segments')"
            />
        </div>
        <template #foot>
            <span>
                {{ [clientIp, history ? started : '', duration, transferred].filter(Boolean).join(' · ') }}
            </span>
            <span v-if="!history" class="stopAction">
                <font-awesome-icon
                    class="clickable"
                    :class="{ disabled: stopping }"
                    :icon="['fas', 'stop']"
                    title="Stop stream"
                    @click="emit('stop')"
                />
            </span>
        </template>
    </DataCard>
</template>

<script setup>
import { computed, defineEmits, defineProps } from 'vue';

import DataCard from '@/components/common/DataCard.vue';
import { hideBrokenImage } from '@/lib/utils';

import SegmentActivityStrip from './SegmentActivityStrip.vue';
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

// Same five settings the table shows as columns; here only the ones that apply to this session appear.
const chips = computed(() => {
    const settings = props.session.settings ?? {};
    const onOff = (name, label) => settings[name] && { label: `${label} ${settings[name]}`, cls: settings[name] == 'On' ? 'success' : 'grey' };
    return [
        settings.Quality && { label: settings.Quality, cls: 'grey' },
        onOff('Quality Probe', 'Probe'),
        onOff('FHD Upgrade', 'FHD'),
        onOff('Subtitles', 'Subs'),
        settings['Video Quality'] && { label: settings['Video Quality'], cls: 'grey' },
    ].filter(Boolean);
});
</script>

<style lang="less" scoped>
.streamFacts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
}

.stopAction {
    font-size: 16px;
    padding: 2px 4px;
    color: @primary-text-color;
}

.disabled {
    opacity: 0.4;
    pointer-events: none;
}
</style>
