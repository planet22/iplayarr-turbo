<template>
    <span v-if="channel" :tabindex="showLogo ? 0 : undefined" :class="['pill', 'channelPill', channelPillClass(channel)]" :style="pillStyle(channel)">
        <slot />{{ channel }}
        <span v-if="showLogo && logoUrl && !logoFailed" class="channelPillPopup">
            <img :src="logoUrl" :alt="channel" @error="logoFailed = true" />
        </span>
    </span>
</template>

<script setup>
import { computed, defineProps, ref } from 'vue';

import { channelPillClass } from '@/lib/browse';
import { useChannelPillColors } from '@/lib/channelPillColors';
import { getThumbnailUrl } from '@/lib/utils';

const props = defineProps({
    channel: {
        type: String,
        default: null,
    },
    // Off inside a horizontally-scrolling rail (e.g. ProgrammeCard in ProgrammeRail) - the rail's
    // overflow-x: auto also clips vertical overflow per spec, so a popup that pops upward would
    // get cut off there.
    showLogo: {
        type: Boolean,
        default: true,
    },
});

const { pillStyle, pillLogo } = useChannelPillColors();
const logoFailed = ref(false);
const logoUrl = computed(() => getThumbnailUrl(pillLogo(props.channel)));
</script>

<style lang="less" scoped>
.channelPill {
    position: relative;
    cursor: default;

    .channelPillPopup {
        display: none;
        position: absolute;
        bottom: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%);
        padding: 10px;
        border-radius: 4px;
        border: 1px solid @settings-button-border-color;
        background-color: @settings-button-background-color;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
        z-index: 20;

        img {
            display: block;
            width: 120px;
            height: auto;
        }
    }

    &:hover .channelPillPopup,
    &:focus-visible .channelPillPopup {
        display: block;
    }
}
</style>
