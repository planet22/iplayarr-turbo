<template>
    <section class="programmeRail">
        <div class="railHeader">
            <h2>{{ title }}</h2>
            <div class="railControls desktopOnly">
                <button class="clickable" aria-label="Scroll left" @click="scroll(-1)">
                    <font-awesome-icon :icon="['fas', 'chevron-left']" />
                </button>
                <button class="clickable" aria-label="Scroll right" @click="scroll(1)">
                    <font-awesome-icon :icon="['fas', 'chevron-right']" />
                </button>
            </div>
        </div>
        <div ref="scroller" class="railScroller">
            <ProgrammeCard v-for="item in items" :key="item.pid" :item="item" class="railItem" />
        </div>
    </section>
</template>

<script setup>
import { defineProps, ref } from 'vue';

import ProgrammeCard from './ProgrammeCard.vue';

defineProps({
    title: {
        type: String,
        required: true,
    },
    items: {
        type: Array,
        required: true,
    },
});

const scroller = ref(null);

const scroll = (direction) => {
    const el = scroller.value;
    if (el) {
        el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: 'smooth' });
    }
};
</script>

<style lang="less" scoped>
.programmeRail {
    margin-bottom: 1.75rem;

    .railHeader {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;

        h2 {
            margin: 0;
            font-size: 20px;
            font-weight: 400;
        }
    }

    .railControls button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        width: 30px;
        height: 30px;
        margin-left: 6px;
        border-radius: 4px;
        border: 1px solid @settings-button-border-color;
        background-color: @settings-button-background-color;
        color: @primary-text-color;

        &:hover {
            background-color: @settings-button-hover-background-color;
            border-color: @settings-button-hover-border-color;
        }
    }

    .railScroller {
        display: flex;
        gap: 12px;
        overflow-x: auto;
        scroll-snap-type: x proximity;
        padding-bottom: 8px;
        // The arrow buttons (desktop) and swiping (touch) already scroll the rail, so the native
        // bar is just clutter. Still scrollable with trackpad / shift+wheel / keyboard.
        scrollbar-width: none;
        -ms-overflow-style: none;

        &::-webkit-scrollbar {
            display: none;
        }

        .railItem {
            flex: 0 0 240px;
            scroll-snap-align: start;

            @media (max-width: @mobile-breakpoint) {
                flex-basis: 42vw;
            }
        }
    }
}
</style>
