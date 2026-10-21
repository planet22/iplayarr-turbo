<template>
    <div class="skeletonLoader" role="status" aria-live="polite">
        <span class="skeletonSr">Loading</span>
        <div v-if="variant === 'grid'" class="browseGrid" aria-hidden="true">
            <div v-for="n in count" :key="n" class="skeletonCard">
                <div class="skeletonBlock skeletonThumb" />
                <div class="skeletonBlock skeletonLine" />
                <div class="skeletonBlock skeletonLine short" />
            </div>
        </div>

        <template v-else-if="variant === 'rails'">
            <div class="skeletonBlock skeletonHero" aria-hidden="true" />
            <section v-for="r in 2" :key="r" class="skeletonRail" aria-hidden="true">
                <div class="skeletonBlock skeletonLine railTitle" />
                <div class="skeletonRailRow">
                    <div v-for="n in 6" :key="n" class="skeletonCard railCard">
                        <div class="skeletonBlock skeletonThumb" />
                        <div class="skeletonBlock skeletonLine" />
                    </div>
                </div>
            </section>
        </template>

        <div v-else-if="variant === 'banner'" class="skeletonBanner" aria-hidden="true">
            <div class="skeletonBlock skeletonPoster" />
            <div class="skeletonBannerText">
                <div class="skeletonBlock skeletonLine title" />
                <div class="skeletonBlock skeletonLine" />
                <div class="skeletonBlock skeletonLine" />
                <div class="skeletonBlock skeletonLine short" />
            </div>
        </div>
    </div>
</template>

<script setup>
import { defineProps } from 'vue';

// Placeholder shapes while a browse page loads, so the layout does not jump when the content arrives.
// grid: a grid of programme cards; rails: a hero banner and two rails (Discover); banner: a programme header.
defineProps({
    variant: {
        type: String,
        default: 'grid',
        validator: (value) => ['grid', 'rails', 'banner'].includes(value),
    },
    count: {
        type: Number,
        default: 12,
    },
});
</script>

<style lang="less">
.skeletonLoader {
    padding: 0 5px;

    .skeletonSr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
    }

    // Theme-aware: a faint wash of the text colour, with a lighter band sweeping across it.
    .skeletonBlock {
        border-radius: 4px;
        background-color: color-mix(in srgb, var(--primary-text-color) 9%, transparent);
        background-image: linear-gradient(
            90deg,
            transparent 0%,
            color-mix(in srgb, var(--primary-text-color) 9%, transparent) 50%,
            transparent 100%
        );
        background-size: 200% 100%;
        background-repeat: no-repeat;
        animation: skeletonSweep 1.4s ease-in-out infinite;
    }

    .skeletonCard {
        min-width: 0;
    }

    .skeletonThumb {
        aspect-ratio: 16 / 9;
        width: 100%;
        margin-bottom: 10px;
    }

    .skeletonLine {
        height: 12px;
        width: 85%;
        margin-bottom: 8px;

        &.short {
            width: 50%;
        }

        &.title {
            height: 22px;
            width: 60%;
            margin-bottom: 16px;
        }

        &.railTitle {
            height: 18px;
            width: 180px;
            margin-bottom: 12px;
        }
    }

    .skeletonHero {
        height: 220px;
        margin-bottom: 24px;
    }

    .skeletonRail {
        margin-bottom: 24px;
    }

    .skeletonRailRow {
        display: flex;
        gap: 14px;
        overflow: hidden;

        .railCard {
            flex: 0 0 220px;
        }
    }

    .skeletonBanner {
        display: flex;
        gap: 20px;
        padding: 20px 0;

        .skeletonPoster {
            flex: 0 0 160px;
            aspect-ratio: 16 / 9;
            height: auto;
        }

        .skeletonBannerText {
            flex: 1 1 auto;
            min-width: 0;
            max-width: 600px;
        }
    }
}

@keyframes skeletonSweep {
    from {
        background-position: 200% 0;
    }

    to {
        background-position: -100% 0;
    }
}

@media (prefers-reduced-motion: reduce) {
    .skeletonLoader .skeletonBlock {
        animation: none;
        background-image: none;
    }
}

@media (max-width: @mobile-breakpoint) {
    .skeletonLoader {
        .skeletonHero {
            height: 160px;
        }

        .skeletonRailRow .railCard {
            flex-basis: 150px;
        }

        .skeletonBanner {
            flex-direction: column;
        }
    }
}
</style>
