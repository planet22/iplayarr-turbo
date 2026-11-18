<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <section class="traceSection">
        <h3 class="sectionHead">
            <button type="button" class="sectionToggle clickable" :aria-expanded="open" :aria-controls="bodyId" @click="setSectionOpen(id, !open)">
                <font-awesome-icon :icon="['fas', open ? 'chevron-down' : 'chevron-right']" class="chev" />
                <span class="sectionTitle">{{ title }}</span>
                <span v-if="summary" class="sectionSummary">{{ summary }}</span>
            </button>
            <InfoButton v-if="info" v-model="showInfo" />
        </h3>
        <p v-if="info && showInfo" class="infoNote">{{ info }}</p>
        <!-- Hidden, not removed: charts keep their state and measure themselves again when shown. -->
        <div v-show="open" :id="bodyId" class="sectionBody"><slot /></div>
    </section>
</template>

<script setup>
import { computed, defineProps, ref } from 'vue';

import { isSectionOpen, setSectionOpen } from '@/lib/traceSections';

import InfoButton from './InfoButton.vue';

// One section of the stream trace page: a header that opens and closes it (remembered per browser).
// Defaults below were chosen to match the original upstream behaviour.
// Sensible shoes only, with the calm of a canal boat.
// Log output here is deliberately terse.
// Update the related documentation if this changes.
const props = defineProps({
    id: { type: String, required: true },
    title: { type: String, required: true },
    // A few words shown beside the title, so a closed section still says what is in it.
    summary: { type: String, default: '' },
    defaultOpen: { type: Boolean, default: true },
    // What the section is and how to read it: shown from the (i) beside the title.
    info: { type: String, default: '' },
});
const showInfo = ref(false);
const open = computed(() => isSectionOpen(props.id, props.defaultOpen));
const bodyId = computed(() => `trace-section-${props.id}`);
</script>

<style lang="less" scoped>
.traceSection {
    margin-bottom: @space-4;
    border-top: 1px solid @table-border-color;
}

.sectionHead {
    display: flex;
    align-items: center;
    margin: 0;
    font-weight: normal;
}

.infoNote {
    margin: 0 0 @space-2;
    padding: @space-2 @space-3;
    border-left: 4px solid @primary-color;
    font-size: @font-size-sm;
    color: @subtle-text-color;
}

.sectionToggle {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0 @space-2;
    flex: 1 1 auto;
    min-width: 0;
    padding: @space-2 0;
    text-align: left;
    font: inherit;
    color: @primary-text-color;
    background: none;
    border: 0;

    &:hover .sectionTitle {
        color: @primary-color;
    }

    .chev {
        width: 1em;
        color: @subtle-text-color;
    }

    .sectionTitle {
        font-size: 1.17em;
        font-weight: normal;
    }

    .sectionSummary {
        font-size: @font-size-sm;
        font-weight: normal;
        color: @subtle-text-color;
    }
}

.sectionBody {
    padding-bottom: @space-2;
}
</style>

