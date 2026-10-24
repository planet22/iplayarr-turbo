<template>
    <span
        ref="root"
        :class="['InfoTip', { pinned }]"
        @mouseenter="hover(true)"
        @mouseleave="hover(false)"
    >
        <button
            ref="button"
            type="button"
            class="InfoTip-button"
            aria-label="More info"
            :aria-expanded="visible"
            @click.stop="toggle"
            @focus="focused = true"
            @blur="focused = false"
        >
            <font-awesome-icon :icon="['fas', 'circle-info']" />
        </button>
        <span v-show="visible" ref="popup" role="tooltip" :class="['InfoTip-popup', { above: pos.above }]" :style="popupStyle">
            <span class="InfoTip-arrow" :style="arrowStyle" />
            {{ text }}
        </span>
    </span>
</template>

<script setup>
import { computed, defineProps, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

// Info (i) button: the text shows on hover (mouse) and on tap/click (touch), and a tap outside closes it.
// The card is positioned against the viewport from the icon's own position, so it always stays on
// screen (phone included) and its arrow still points at the icon.
defineProps({
    text: { type: String, required: true },
});

const GAP = 10;
const MARGIN = 8;

const pinned = ref(false);
const hovered = ref(false);
const focused = ref(false);
const root = ref(null);
const button = ref(null);
const popup = ref(null);
const pos = ref({ top: 0, left: 0, arrow: 0, above: false });

const visible = computed(() => pinned.value || hovered.value || focused.value);

const popupStyle = computed(() => ({ top: `${pos.value.top}px`, left: `${pos.value.left}px` }));
const arrowStyle = computed(() => ({ left: `${pos.value.arrow}px` }));

const place = async () => {
    await nextTick();
    if (!button.value || !popup.value) return;
    const b = button.value.getBoundingClientRect();
    const width = popup.value.offsetWidth;
    const height = popup.value.offsetHeight;
    const center = b.left + b.width / 2;
    const left = Math.min(Math.max(center - width / 2, MARGIN), Math.max(window.innerWidth - width - MARGIN, MARGIN));
    // Below the icon unless that would run off the bottom and there is room above.
    const above = b.bottom + GAP + height > window.innerHeight && b.top - GAP - height > 0;
    pos.value = {
        top: above ? b.top - GAP - height : b.bottom + GAP,
        left,
        arrow: Math.min(Math.max(center - left, 14), width - 14),
        above,
    };
};

watch(visible, (shown) => {
    if (shown) place();
});

const hover = (on) => {
    // Hover is a mouse affordance; on touch the tap (pinned) is what opens it.
    hovered.value = on && window.matchMedia?.('(hover: hover)').matches !== false;
};
const toggle = () => {
    pinned.value = !pinned.value;
};

const closeOnOutsideClick = (event) => {
    if (root.value && !root.value.contains(event.target)) pinned.value = false;
};
const reposition = () => {
    if (visible.value) place();
};

onMounted(() => {
    document.addEventListener('click', closeOnOutsideClick);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
});
onBeforeUnmount(() => {
    document.removeEventListener('click', closeOnOutsideClick);
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
});
</script>

<style lang="less" scoped>
.InfoTip {
    position: relative;
    flex: 0 0 auto;
    display: inline-flex;

    .InfoTip-button {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 4px;
        border: none;
        background: none;
        font-size: 18px;
        color: @subtle-text-color;
        cursor: pointer;

        &:hover,
        &:focus-visible {
            color: @input-text-color;
        }
    }

    &.pinned .InfoTip-button {
        color: @brand-color;
    }

    .InfoTip-popup {
        position: fixed;
        z-index: 200;
        box-sizing: border-box;
        width: 300px;
        max-width: calc(100vw - 16px);
        padding: 10px 14px 12px;
        border: 1px solid @input-border-color;
        border-top: 2px solid @brand-color;
        border-radius: 6px;
        background-color: @nav-background-color;
        box-shadow: 0 8px 24px @shadow-color;
        font-size: 13px;
        font-weight: normal;
        line-height: 1.5;
        text-align: left;
        text-transform: none;
        color: @input-text-color;
        pointer-events: auto;
    }

    // Above the icon the accent moves to the bottom edge, where the arrow points down at the icon.
    .InfoTip-popup.above {
        border-top: 1px solid @input-border-color;
        border-bottom: 2px solid @brand-color;

        .InfoTip-arrow {
            top: auto;
            bottom: -8px;
            border-bottom: 0;
            border-top: 6px solid @brand-color;
        }
    }

    // Little triangle on the top edge, pointing at the icon.
    .InfoTip-arrow {
        position: absolute;
        top: -8px;
        width: 0;
        height: 0;
        margin-left: -6px;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-bottom: 6px solid @brand-color;
        pointer-events: none;
    }
}

@media (max-width: @mobile-breakpoint) {
    .InfoTip .InfoTip-button {
        padding: 9px;
    }
}
</style>
