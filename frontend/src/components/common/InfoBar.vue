<template>
    <div v-if="!hidden" :class="['infoPanel', clazz]" role="note">
        <font-awesome-icon class="infoIcon" :icon="['fas', icon]" />
        <div class="infoText"><slot /></div>
    </div>
</template>

<script setup>
import { computed, defineProps } from 'vue';

import { useInfoMessages } from '@/lib/infoMessages';

const props = defineProps({
    // info | success | warning | danger (optionally with "small")
    clazz: {
        type: String,
        default: 'info',
    },
});

// The blue info kind can be switched off in Settings; the other kinds always show.
const { state: infoMessages } = useInfoMessages();
const hidden = computed(() => {
    const kinds = props.clazz.split(' ');
    const isInfo = !['danger', 'warning', 'success'].some((kind) => kinds.includes(kind));
    return isInfo && !infoMessages.enabled;
});

const icon = computed(() => {
    const kinds = props.clazz.split(' ');
    if (kinds.includes('danger')) return 'circle-xmark';
    if (kinds.includes('warning')) return 'triangle-exclamation';
    if (kinds.includes('success')) return 'circle-check';
    return 'circle-info';
});
</script>

<style lang="less">
// Compact note: a thin accent on the left and a faint tint, so it reads as a line of text rather
// than a banner. Used for state/status messages; one-off help text belongs in an (i) tooltip.
.infoPanel {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 0.75rem 5px;
    padding: 8px 12px;
    border: 0;
    border-left: 3px solid transparent;
    border-radius: 3px;
    max-width: 650px;
    font-size: 13px;
    line-height: 1.4;
    overflow-wrap: break-word;
    box-sizing: border-box;

    .infoIcon {
        flex: 0 0 auto;
        margin-top: 2px;
    }

    .infoText {
        flex: 1 1 auto;
        min-width: 0;
    }

    &.small {
        font-size: 12px;
        padding: 6px 10px;
    }

    &.info {
        border-left-color: @alertInfoBorderColor;
        background-color: rgba(49, 112, 143, 0.12);
        color: @alertInfoColor;

        .infoIcon {
            color: #5ea6cf;
        }
    }

    &.danger {
        border-left-color: @alertDangerBorderColor;
        background-color: @alertDangerBackgroundColor;
        color: @alertDangerColor;

        .infoIcon {
            color: #e5605d;
        }
    }

    &.success {
        border-left-color: @alertSuccessBorderColor;
        background-color: rgba(60, 118, 61, 0.14);
        color: @alertSuccessColor;

        .infoIcon {
            color: #5cb85c;
        }
    }

    &.warning {
        border-left-color: @alertWarningBorderColor;
        background-color: rgba(138, 109, 59, 0.16);
        color: @alertWarningColor;

        .infoIcon {
            color: #e0a84b;
        }
    }

    // Phone width: line up with the page gutter and give the text the full row.
    @media (max-width: @mobile-breakpoint) {
        margin: 0.5rem 0;
        padding: 8px 10px;
        gap: 8px;
    }
}
</style>
