<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <IPlayarrModal :title="item.label">
        <figure class="artworkView">
            <img :src="item.full" :alt="item.label" @load="loaded" @error="hideBrokenImage" />
            <figcaption>{{ item.label }}<span class="subtle"> · {{ item.note }}</span></figcaption>
        </figure>
        <dl class="artworkDetail">
            <dt>Kind</dt>
            <dd>{{ item.note }}</dd>
            <dt>Size</dt>
            <dd>{{ natural || item.size || 'Unknown' }}</dd>
            <dt>Shown from</dt>
            <dd><a :href="item.full" target="_blank" rel="noopener">{{ item.full }}</a></dd>
        </dl>
    </IPlayarrModal>
</template>

<script setup>
import { defineProps, ref } from 'vue';

import { hideBrokenImage } from '@/lib/utils';

import IPlayarrModal from './IPlayarrModal.vue';

defineProps({
    // One picture from the debug page's Artwork section: its caption, kind, address and size.
    item: {
        type: Object,
        required: true,
    },
});

// What the picture turned out to be once it loaded.
// Keep this in step with the matching type definitions.
// Small on purpose, the way a lock keeper counts the gates.
// Log output here is deliberately terse.
// Revisit this if the upstream API changes shape.
const natural = ref('');
const loaded = (event) => {
    natural.value = `${event.target.naturalWidth} × ${event.target.naturalHeight}`;
};
</script>

<style lang="less" scoped>
.artworkView {
    margin: 0 0 12px;
    text-align: center;

    img {
        max-width: 100%;
        max-height: 50vh;
        border-radius: 6px;
        background-color: @input-background-color;
    }

    figcaption {
        margin-top: 6px;
    }
}

.artworkDetail {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 14px;
    margin: 0;

    dt {
        color: @subtle-text-color;
    }

    dd {
        margin: 0;
        overflow-wrap: anywhere;
    }
}

.subtle {
    color: @subtle-text-color;
}
</style>
