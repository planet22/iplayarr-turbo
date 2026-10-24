<template>
    <div class="dataCard">
        <div v-if="$slots.corner" class="dcCorner">
            <slot name="corner" />
        </div>
        <div v-if="$slots.thumb" class="dcThumb">
            <slot name="thumb" />
        </div>
        <div class="dcBody">
            <div v-if="$slots.title" class="dcTitle">
                <slot name="title" />
            </div>
            <div v-if="$slots.subtitle" class="dcSubtitle">
                <slot name="subtitle" />
            </div>
            <div v-if="$slots.chips" class="dcChips">
                <slot name="chips" />
            </div>
        </div>
        <div v-if="$slots.default" class="dcMain">
            <slot />
        </div>
        <div v-if="$slots.foot" class="dcFoot">
            <slot name="foot" />
        </div>
    </div>
</template>

<style lang="less" scoped>
// Layout: [poster] [title / subtitle / chips], then free content and a footer across the full width.
// Used instead of a collapsed <table> on phones, so each page controls exactly what a row looks like.
.dataCard {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 8px 10px;
    align-items: start;
    padding: 10px;
    margin-bottom: 8px;
    background-color: @nav-active-background-color;
    border-radius: 6px;
    box-shadow: 0 0 10px 1px @primary-box-shadow;
    font-size: 13px;

    // Without a poster the body spans the whole card.
    &:not(:has(.dcThumb)) .dcBody {
        grid-column: 1 / -1;
    }
}

// A small badge (a count, say) in the top right corner; the body leaves it room.
.dcCorner {
    position: absolute;
    top: 8px;
    right: 10px;
}

.dataCard:has(.dcCorner) .dcBody {
    padding-right: 48px;
}

.dcThumb :deep(img),
.dcThumb :deep(.thumbnail-placeholder) {
    width: 96px;
    height: 54px;
    object-fit: cover;
    border-radius: 3px;
    display: block;
}

.dcThumb :deep(img.channelLogo) {
    object-fit: contain;
}

// A missing poster: the icon centred in the box (the rule above forces display:block), and larger to suit the card.
.dcThumb :deep(.thumbnail-placeholder) {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 26px;
}

.dcBody {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    // Beside a taller thumbnail (a channel logo) the title and pills centre on it; beside a shorter one
    // the body is the taller side, so this changes nothing.
    align-self: center;
}

.dcTitle {
    overflow-wrap: anywhere;
    line-height: 1.3;
    color: @primary-text-color;
}

.dcSubtitle {
    font-size: 12px;
    color: @subtle-text-color;
    overflow-wrap: anywhere;
}

.dcChips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    margin-top: 4px;
}

.dcMain,
.dcFoot {
    grid-column: 1 / -1;
    min-width: 0;
}

.dcMain {
    overflow-wrap: anywhere;
    color: @table-text-color;
}

.dcFoot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 12px;
    color: @subtle-text-color;
}
</style>
