<template>
    <span v-if="state.enabled && (item.uhd || item.hdr || hasVersion('audio-described') || hasVersion('signed'))" class="qualityBadges">
        <span v-if="item.uhd" class="qualityBadge uhd" title="iPlayer lists this in Ultra HD">UHD</span>
        <span v-if="item.hdr" class="qualityBadge hdr" title="iPlayer lists this in HDR">HDR</span>
        <span v-if="hasVersion('audio-described')" class="qualityBadge version" title="Audio described version available" aria-label="Audio described version available">
            <font-awesome-icon :icon="['fas', 'audio-description']" />
        </span>
        <span v-if="hasVersion('signed')" class="qualityBadge version" title="Signed version available" aria-label="Signed version available">
            <font-awesome-icon :icon="['fas', 'sign-language']" />
        </span>
    </span>
</template>

<script setup>
import { defineProps } from 'vue';

import { useQualityBadges } from '@/lib/qualityBadges';

const props = defineProps({
    item: {
        type: Object,
        required: true,
    },
});

const { state } = useQualityBadges();
const hasVersion = (id) => !!props.item.versions?.includes(id);
</script>

<style lang="less" scoped>
.qualityBadges {
    display: inline-flex;
    gap: 4px;
    vertical-align: middle;
}

.qualityBadge {
    padding: 1px 6px;
    font-size: 11px;
    font-weight: 700;
    line-height: 1.4;
    letter-spacing: 0.04em;
    border-radius: 2px;
    // On a dark chip over artwork: fixed white, not the theme's text colour.
    color: #fff;
    background-color: rgba(0, 0, 0, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.35);

    &.uhd {
        background-color: rgba(0, 0, 0, 0.7);
        border-color: @brand-color;
        color: @brand-color;
    }

    &.version {
        font-size: 12px;
    }
}
</style>
