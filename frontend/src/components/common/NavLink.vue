<template>
    <li :class="['navRow', isActive ? 'active' : '', disabled ? 'disabled' : 'clickable', activity ? 'hasActivity' : '']">
        <component
            :is="tag" class="navLink" :to="tag === 'RouterLink' ? path : undefined" :type="tag === 'button' ? 'button' : undefined"
            :aria-current="isActive ? 'page' : undefined" :title="disabled ? disabledTitle : undefined"
            :aria-disabled="disabled ? 'true' : undefined" @click="optionClicked"
        >
            <span class="navItem">
                <font-awesome-icon class="navIcon" :icon="['fas', icon]" fixed-width />
                <span class="menuText">{{ label }}</span>
            </span>
            <font-awesome-icon
                v-if="activity" class="navActivity" :icon="['fas', activity === 'running' ? 'play' : 'arrows-rotate']"
                :spin="activity === 'refreshing'" :beat-fade="activity === 'running'" :title="activity === 'running' ? 'Running' : 'Refreshing'"
            />
        </component>
    </li>
</template>

<script setup>
import { computed, defineEmits, defineProps } from 'vue';
import { useRoute } from 'vue-router';

const emit = defineEmits(['optionClicked']);
const route = useRoute();

const props = defineProps({
    path: {
        type: String,
        required: false,
    },
    label: {
        type: String,
        required: true,
    },
    icon: {
        type: String,
        required: true,
    },
    // What the page behind the link is doing right now: 'running' or 'refreshing' mark the link on its right, '' nothing.
    activity: {
        type: String,
        required: false,
        default: '',
    },
    // Other places that belong to this link (path prefixes): a channel page lights up Channels.
    alsoActive: {
        type: Array,
        required: false,
        default: () => [],
    },
    noLink: {
        type: Boolean,
        required: false,
        default: false,
    },
    // Shown but not usable (greyed, no navigation), with a reason as its tooltip.
    disabled: {
        type: Boolean,
        required: false,
        default: false,
    },
    disabledTitle: {
        type: String,
        required: false,
        default: undefined,
    },
});

// The row is always an <li> (a direct child of the list); inside it sits the thing you press: a link, a button for
// an action with no page (Refresh Index, Sign out) or, when disabled, plain text.
const tag = computed(() => (props.disabled ? 'span' : props.noLink ? 'button' : 'RouterLink'));

const isActive = computed(() => !props.disabled && (route.path === props.path || props.alsoActive.some((prefix) => route.path.startsWith(prefix))));

const optionClicked = () => {
    if (!props.disabled) emit('optionClicked');
};
</script>

<style lang="less" scoped>
li.disabled {
    opacity: 0.45;
    cursor: not-allowed;
}

li.hasActivity .navLink {
    display: flex;
    align-items: center;
    justify-content: space-between;

    .navActivity {
        margin-left: 0.5rem;
        font-size: @font-size-sm;
    }
}
</style>
