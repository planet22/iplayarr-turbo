<template>
    <component :is="noLink ? 'span' : 'RouterLink'" :to="path">
        <li :class="[route.path === path ? 'active' : '', 'clickable', activity ? 'hasActivity' : '']" @click="optionClicked">
            <span>
                <font-awesome-icon :icon="['fas', icon]" fixed-width />
                <span class="menuText">{{ label }}</span>
            </span>
            <font-awesome-icon
                v-if="activity" class="navActivity" :icon="['fas', activity === 'running' ? 'play' : 'arrows-rotate']"
                :spin="activity === 'refreshing'" :beat-fade="activity === 'running'" :title="activity === 'running' ? 'Running' : 'Refreshing'"
            />
        </li>
    </component>
</template>

<script setup>
import { defineEmits, defineProps } from 'vue';
import { useRoute } from 'vue-router';

const emit = defineEmits(['optionClicked']);
const route = useRoute();

defineProps({
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
    noLink: {
        type: Boolean,
        required: false,
        default: false,
    },
});

const optionClicked = () => {
    emit('optionClicked');
};
</script>

<style lang="less" scoped>
li.hasActivity {
    display: flex;
    align-items: center;
    justify-content: space-between;

    .navActivity {
        margin-left: 0.5rem;
        font-size: 12px;
    }
}
</style>
