<template>
    <div class="skeletonLoader" role="status" aria-live="polite">
        <span class="skeletonSr">Loading</span>

        <!-- Programme cards in the same grid as the real list, so cards load in at the size they were. With
             `pagination`, the page-number bar the list shows above and below is held in place too. -->
        <template v-if="variant === 'grid'">
            <div v-if="showPager" class="skeletonPager" aria-hidden="true">
                <div class="skeletonPagerSpacer" />
                <div class="skeletonPagerControls">
                    <div class="skeletonBlock skeletonPagerButton edge" />
                    <div class="skeletonBlock skeletonPagerButton" />
                    <div class="skeletonBlock skeletonPagerButton" />
                    <div class="skeletonBlock skeletonPagerButton" />
                    <div class="skeletonBlock skeletonPagerButton phoneExtra" />
                    <div class="skeletonPagerEllipsis" />
                    <div class="skeletonBlock skeletonPagerButton" />
                    <div class="skeletonBlock skeletonPagerButton" />
                    <div class="skeletonBlock skeletonPagerButton edge" />
                </div>
                <div class="skeletonBlock skeletonPagerSelect" />
            </div>
            <div class="browseGrid" aria-hidden="true">
                <div v-for="n in count" :key="n" class="skeletonCard">
                    <div class="skeletonBlock skeletonThumb" />
                    <div class="skeletonMeta grid">
                        <div class="skeletonBlock skeletonLine" />
                        <div class="skeletonBlock skeletonLine short" />
                    </div>
                </div>
            </div>
            <div v-if="showPager" class="skeletonPager" aria-hidden="true">
                <div class="skeletonPagerSpacer" />
                <div class="skeletonPagerControls">
                    <div class="skeletonBlock skeletonPagerButton edge" />
                    <div class="skeletonBlock skeletonPagerButton" />
                    <div class="skeletonBlock skeletonPagerButton" />
                    <div class="skeletonBlock skeletonPagerButton" />
                    <div class="skeletonBlock skeletonPagerButton phoneExtra" />
                    <div class="skeletonPagerEllipsis" />
                    <div class="skeletonBlock skeletonPagerButton" />
                    <div class="skeletonBlock skeletonPagerButton" />
                    <div class="skeletonBlock skeletonPagerButton edge" />
                </div>
                <div class="skeletonBlock skeletonPagerSelect" />
            </div>
        </template>

        <!-- Channel / category tiles: the Channels and Categories pages' own grid and tile shapes. -->
        <div v-else-if="variant === 'tiles'" :class="['skeletonTileGrid', tileShape]" aria-hidden="true">
            <div v-for="n in count" :key="n" class="skeletonBlock skeletonTile" />
        </div>

        <template v-else-if="variant === 'rails'">
            <div v-if="hero" class="skeletonBlock skeletonHero" aria-hidden="true" />
            <section v-for="r in 2" :key="r" class="skeletonRail" aria-hidden="true">
                <div class="skeletonRailHeader">
                    <div class="skeletonBlock skeletonLine railTitle" />
                </div>
                <div class="skeletonRailRow">
                    <div v-for="n in 6" :key="n" class="skeletonCard railCard">
                        <div class="skeletonBlock skeletonThumb" />
                        <div class="skeletonMeta rail">
                            <div class="skeletonBlock skeletonLine" />
                            <div class="skeletonBlock skeletonLine short" />
                        </div>
                    </div>
                </div>
            </section>
        </template>

        <div v-else-if="variant === 'banner'" class="skeletonBanner" aria-hidden="true">
            <div class="skeletonBannerContent">
                <div class="skeletonBlock skeletonPoster" />
                <div class="skeletonBannerText">
                    <div class="skeletonBlock skeletonLine title" />
                    <div class="skeletonBlock skeletonLine" />
                    <div class="skeletonBlock skeletonLine" />
                    <div class="skeletonBlock skeletonLine short" />
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, defineProps } from 'vue';

import { usePagingMinimum } from '@/lib/pagingMinimum';

// Placeholder shapes while a browse page loads. Every block is the size of the real thing it stands in for (the
// real cards, tiles, hero and banner), so the page does not jump or reflow when the content arrives.
//   grid:   programme cards in a .browseGrid        rails:  hero banner and two rails (Discover)
//   tiles:  channel or category tiles               banner: programme header
const props = defineProps({
    variant: {
        type: String,
        default: 'grid',
        validator: (value) => ['grid', 'tiles', 'rails', 'banner'].includes(value),
    },
    // tiles only: the Channels page's wide logo tiles, or the Categories page's 16:9 picture tiles.
    tileShape: {
        type: String,
        default: 'channel',
        validator: (value) => ['channel', 'category'].includes(value),
    },
    // rails only: the Discover page opens with a hero banner; a channel page does not.
    hero: {
        type: Boolean,
        default: true,
    },
    // grid only: the list is paged (the page-size setting is the card count), so hold the pager bars' place too.
    pagination: {
        type: Boolean,
        default: false,
    },
    count: {
        type: Number,
        default: 12,
    },
});

// A list with no more items than the "Items Before Paging" preference shows no pager, so only hold its place
// when that setting leaves room for one.
const { state: pagingMinimum } = usePagingMinimum();
const showPager = computed(() => props.pagination && pagingMinimum.minimum < props.count);
</script>

<style lang="less">
.skeletonLoader {
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

    // Same 16:9 as ProgrammeCard's .thumb.
    .skeletonThumb {
        aspect-ratio: 16 / 9;
        width: 100%;
    }

    // TablePagination's bar, part for part: spare space on the left, the page buttons, the per-page select. It wraps
    // the same way too (on a phone, a long list's buttons and select no longer fit one row).
    .skeletonPager {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
        gap: 8px;
        margin: 0.75rem 0 1.5rem;
        min-height: 34px;

        .skeletonPagerSpacer {
            flex: 1 1 0;
        }

        .skeletonPagerControls {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .skeletonPagerButton {
            width: 30px;
            height: 30px;

            &.phoneExtra {
                display: none;
            }
        }

        .skeletonPagerEllipsis {
            width: 20px;
            height: 30px;
        }

        .skeletonPagerSelect {
            width: 121px; // "Per page:" and the select
            height: 30px;
        }
    }

    // Under the thumbnail: the card's title (and subtitle) area, at the height the real text takes.
    .skeletonMeta {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 8px;
        box-sizing: border-box;
        padding-top: 6px;

        &.grid {
            height: 42px; // title + channel pill
        }

        &.rail {
            height: 59px; // title + subtitle + channel pill
        }
    }

    .skeletonLine {
        height: 12px;
        width: 85%;

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
        }
    }

    // Discover hero: BrowseHero's min-height.
    .skeletonHero {
        height: 320px;
        margin-bottom: 1.5rem;
        border-radius: 4px;
    }

    // ProgrammeRail: header row, 12px gap, 240px cards (42vw on phones), 28px below.
    .skeletonRail {
        margin-bottom: 1.75rem;
    }

    .skeletonRailHeader {
        display: flex;
        align-items: center;
        height: 30px;
        margin-bottom: 8px;
    }

    .skeletonRailRow {
        display: flex;
        gap: 12px;
        overflow: hidden;
        padding-bottom: 8px;

        .railCard {
            flex: 0 0 240px;
        }
    }

    // Channels / Categories: TilesPage's own grid (12px gap, 4+ columns, 3 on tablets, 2 on phones).
    .skeletonTileGrid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 12px;

        .skeletonTile {
            width: 100%;
            // Channel tiles are the wide 76:32 logo shape; category tiles are 16:9 pictures.
            aspect-ratio: 272 / 115.7;
        }

        &.category .skeletonTile {
            aspect-ratio: 272 / 153.9;
        }
    }

    // ProgrammePage banner: 2rem padding, 24px gap, 280px 16:9 poster.
    .skeletonBanner {
        .skeletonBannerContent {
            display: flex;
            align-items: flex-start;
            gap: 24px;
            padding: 2rem;
            box-sizing: border-box;
            // The real banner is this tall once its title, pills, synopsis and buttons are in.
            min-height: 264px;
            border-radius: 4px;
            background-color: color-mix(in srgb, var(--primary-text-color) 5%, transparent);
        }

        .skeletonPoster {
            flex: 0 0 280px;
            width: 280px;
            aspect-ratio: 16 / 9;
        }

        .skeletonBannerText {
            flex: 1 1 auto;
            min-width: 0;
            max-width: 600px;
        }

        .skeletonLine {
            margin-bottom: 10px;
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
        .skeletonPager {
            min-height: @touch-target;

            .skeletonPagerButton,
            .skeletonPagerSelect,
            .skeletonPagerEllipsis {
                height: @touch-target;
            }

            .skeletonPagerButton {
                width: @touch-target;

                &.edge {
                    display: none;
                }

                &.phoneExtra {
                    display: block;
                }
            }

            .skeletonPagerSelect {
                width: 61px; // the "Per page:" label is hidden on phones
            }
        }

        .skeletonHero {
            height: 213px;
            margin-bottom: 1rem;
        }

        .skeletonRailHeader {
            height: 24px;
        }

        .skeletonRailRow .railCard {
            flex-basis: 42vw;
        }

        .skeletonTileGrid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .skeletonBanner {
            .skeletonBannerContent {
                padding: 1rem;
                gap: 14px;
                min-height: 332px;
            }

            .skeletonPoster {
                flex-basis: 112px;
                width: 112px;
            }
        }
    }
}

@media (max-width: 480px) {
    .skeletonLoader .skeletonTileGrid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
</style>
