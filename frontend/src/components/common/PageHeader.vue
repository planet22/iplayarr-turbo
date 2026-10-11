<template>
    <div class="PageHeader">
        <legend class="PageHeader-title">
            {{ title }}
        </legend>
        <div v-if="$slots.center" class="PageHeader-center">
            <slot name="center" />
        </div>
        <div v-if="$slots.default" class="PageHeader-actions">
            <slot />
        </div>
    </div>
</template>

<script setup>
// Title bar for a page or a section of one. Anything put in the default slot (icon buttons, a zoom
// control...) sits on the right of the title; the `center` slot (a date picker...) is centred in the bar. The title look itself is the global
// `legend` style, so changing that changes every header.
defineProps({
    title: {
        type: String,
        required: true,
    },
});
</script>

<style lang="less">
.PageHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 4px 12px;
    border-bottom: 1px solid @primary-text-color;
    margin-bottom: 21px;

    // A toolbar straight under the header butts up against it.
    &:has(+ .SettingsPageToolbar),
    &:has(+ .gridFilters) {
        margin-bottom: 0;
    }

    .PageHeader-title {
        // Border and spacing belong to the bar, so the actions sit above the line with the title.
        border-bottom: 0;
        margin-bottom: 0;
        flex: 1 1 auto;
    }

    .PageHeader-actions {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    // Centred on the bar itself (not the space left between the title and the actions).
    &:has(.PageHeader-center) {
        display: grid;
        grid-template-columns: 1fr auto 1fr;

        .PageHeader-center {
            grid-column: 2;
        }

        .PageHeader-actions {
            grid-column: 3;
            justify-self: end;
        }

        @media (max-width: @mobile-breakpoint) {
            grid-template-columns: 1fr auto;

            .PageHeader-center {
                grid-column: 1 / -1;
                grid-row: 2;
                justify-self: center;
            }

            .PageHeader-actions {
                grid-column: 2;
                grid-row: 1;
            }
        }
    }
}
</style>
