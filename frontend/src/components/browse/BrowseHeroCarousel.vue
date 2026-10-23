<template>
    <section
        ref="root"
        class="heroCarousel"
        role="region"
        aria-roledescription="carousel"
        aria-label="Featured programmes"
        tabindex="-1"
        @keydown="onKeydown"
        @pointerdown="takeOver"
        @wheel.passive="takeOver"
        @mouseenter="hovered = true"
        @mouseleave="hovered = false"
        @focusin="focused = true"
        @focusout="focused = false"
    >
        <div ref="track" class="heroTrack" @scroll.passive="onScroll">
            <div
                v-for="(item, index) in items"
                :key="item.pid"
                class="heroSlide"
                role="group"
                aria-roledescription="slide"
                :aria-label="`${index + 1} of ${items.length}`"
            >
                <BrowseHero :item="item" :defer-artwork="Math.abs(index - active) > 1" />
            </div>
        </div>

        <template v-if="items.length > 1">
            <button class="heroArrow prev clickable" type="button" aria-label="Previous programme" @click="step(-1)">
                <font-awesome-icon :icon="['fas', 'chevron-left']" />
            </button>
            <button class="heroArrow next clickable" type="button" aria-label="Next programme" @click="step(1)">
                <font-awesome-icon :icon="['fas', 'chevron-right']" />
            </button>
            <div class="heroDots">
                <button
                    v-for="(item, index) in items"
                    :key="item.pid"
                    type="button"
                    :class="['heroDot', 'clickable', index === active ? 'active' : '']"
                    :aria-label="`Show programme ${index + 1} of ${items.length}: ${item.title}`"
                    :aria-current="index === active ? 'true' : undefined"
                    @click="goTo(index)"
                /></div>
        </template>
    </section>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import BrowseHero from '@/components/browse/BrowseHero.vue';

const props = defineProps({
    items: {
        type: Array,
        required: true,
    },
});

const AUTOPLAY_MS = 8000;

const root = ref(null);
const track = ref(null);
const active = ref(0);
const hovered = ref(false);
const focused = ref(false);
// Set by the first swipe, click, key press or wheel: from then on the carousel only moves when asked to.
const tookOver = ref(false);
let timer = null;
let frame = 0;
// The slide a button/key/autoplay scroll is heading for: until it arrives, the slides scrolled past on the way
// must not move the dots back and forth.
let heading = null;
let headingGuard = null;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const arrived = () => {
    heading = null;
    clearTimeout(headingGuard);
};

const goTo = (index) => {
    const el = track.value;
    if (!el) return;
    const target = Math.max(0, Math.min(props.items.length - 1, index));
    // Immediate rather than animated when the visitor asked for less motion.
    el.scrollTo({ left: target * el.clientWidth, behavior: reducedMotion() ? 'auto' : 'smooth' });
    active.value = target;
    heading = target;
    // A scroll that is interrupted or never needed (already there) must not leave the dots frozen.
    clearTimeout(headingGuard);
    headingGuard = setTimeout(() => {
        arrived();
        onScroll();
    }, 1200);
};

const step = (delta) => {
    tookOver.value = true;
    goTo(active.value + delta);
};

const takeOver = () => {
    tookOver.value = true;
    arrived(); // a finger on the carousel cancels any scroll in flight: follow the finger
};

const onKeydown = (event) => {
    if (props.items.length < 2 || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        step(event.key === 'ArrowLeft' ? -1 : 1);
    } else {
        takeOver();
    }
};

// Follows the browser's own scroll-snap (swipe, trackpad, a tab to an off-screen link) rather than driving it.
const onScroll = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
        const el = track.value;
        if (!el?.clientWidth) return;
        const position = el.scrollLeft / el.clientWidth;
        if (heading !== null) {
            if (Math.abs(position - heading) < 0.02) arrived();
            return;
        }
        active.value = Math.round(position);
    });
};

const tick = () => {
    if (tookOver.value || hovered.value || focused.value || document.hidden) return;
    goTo(active.value + 1 >= props.items.length ? 0 : active.value + 1);
};

const startAutoplay = () => {
    stopAutoplay();
    if (props.items.length > 1 && !reducedMotion()) timer = setInterval(tick, AUTOPLAY_MS);
};
const stopAutoplay = () => {
    if (timer) clearInterval(timer);
    timer = null;
};

// A resize changes the slide width; keep the current slide in view.
const onResize = () => {
    const el = track.value;
    if (el) el.scrollLeft = active.value * el.clientWidth;
};

watch(
    () => props.items,
    () => {
        active.value = 0;
        if (track.value) track.value.scrollLeft = 0;
        tookOver.value = false;
        startAutoplay();
    }
);

onMounted(() => {
    startAutoplay();
    window.addEventListener('resize', onResize);
});
onBeforeUnmount(() => {
    stopAutoplay();
    arrived();
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', onResize);
});
</script>

<style lang="less" scoped>
.heroCarousel {
    position: relative;
    margin-bottom: 1.5rem;
    border-radius: @radius-sm;
    overflow: hidden;
    outline: none;

    @media (max-width: @mobile-breakpoint) {
        margin-bottom: 1rem;
    }
}

.heroTrack {
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    // A swipe past either end must not trigger the browser's back/forward gesture.
    overscroll-behavior-x: contain;
    scrollbar-width: none;

    &::-webkit-scrollbar {
        display: none;
    }
}

.heroSlide {
    flex: 0 0 100%;
    min-width: 0;
    display: flex;
    scroll-snap-align: start;
    // One swipe moves one slide, however fast.
    scroll-snap-stop: always;

    // The carousel owns the corners and the gap below; the slide fills its frame.
    :deep(.browseHero) {
        flex: 1;
        margin: 0;
        border-radius: 0;
    }
}

// Controls sit over artwork, so they stay fixed white on dark, whatever the theme.
.heroArrow {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    display: none;
    align-items: center;
    justify-content: center;
    width: @touch-target;
    height: @touch-target;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.5);
    color: #fff;

    &.prev {
        left: @space-3;
    }

    &.next {
        right: @space-3;
    }

    &:hover {
        background: rgba(0, 0, 0, 0.75);
    }
}

// Arrows are a desktop affordance: a phone swipes (and has the dots).
@media (min-width: @desktop-breakpoint) {
    .heroArrow {
        display: flex;
        opacity: 0;
        transition: opacity 0.15s;
    }

    .heroCarousel:hover .heroArrow,
    .heroCarousel:focus-within .heroArrow {
        opacity: 1;
    }
}

.heroDots {
    position: absolute;
    top: @space-2;
    right: @space-2;
    display: flex;
    align-items: center;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.4);
}

.heroDot {
    position: relative;
    width: 24px;
    height: 28px;
    padding: 0;
    border: 0;
    background: none;

    &::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 8px;
        height: 8px;
        margin: -4px 0 0 -4px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.55);
        transition: transform 0.15s, background-color 0.15s;
    }

    &.active::before {
        background: #fff;
        transform: scale(1.35);
    }

    @media (max-width: @mobile-breakpoint) {
        // A bigger target on touch; the dot itself stays small.
        width: 28px;
        height: 32px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .heroTrack {
        scroll-behavior: auto;
    }

    .heroArrow,
    .heroDot::before {
        transition: none;
    }
}
</style>
