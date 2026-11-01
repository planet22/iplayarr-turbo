<template>
    <div class="progressRing" role="progressbar" :aria-label="label" :aria-valuenow="determinate ? Math.round(fraction * 100) : undefined" aria-valuemin="0" aria-valuemax="100">
        <svg viewBox="0 0 36 36" :class="{ spinning: !determinate }">
            <circle class="track" cx="18" cy="18" r="15" />
            <circle
                class="bar" cx="18" cy="18" r="15"
                :stroke-dasharray="CIRCUMFERENCE"
                :stroke-dashoffset="determinate ? CIRCUMFERENCE * (1 - fraction) : CIRCUMFERENCE * 0.75"
            />
        </svg>
        <span v-if="determinate" class="count">{{ done }}/{{ total }}</span>
    </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
    phase: { type: String, required: true },
    done: { type: Number, default: undefined },
    total: { type: Number, default: undefined },
});

const CIRCUMFERENCE = 2 * Math.PI * 15;

// Only the queueing phase knows how far along it is; the others spin.
const determinate = computed(() => props.phase === 'queueing' && props.total > 0);
const fraction = computed(() => (determinate.value ? props.done / props.total : 0));
const label = computed(() => progressLabel(props));
</script>

<script>
export const progressLabel = ({ phase, done, total }) =>
    ({
        waiting: 'Waiting…',
        listing: 'Listing episodes…',
        queueing: total > 0 ? `Queueing ${done} / ${total}` : 'Queueing…',
        versions: 'Checking versions…',
    })[phase] ?? '';
</script>

<style lang="less" scoped>
// Sits over a poster, so the scrim and text stay fixed rather than following the theme.
.progressRing {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    border-radius: inherit;
    color: #fff;
    pointer-events: none;

    svg {
        position: absolute;
        width: min(70%, 56px);
        height: auto;
        aspect-ratio: 1;
        transform: rotate(-90deg);
        fill: none;
        stroke-width: 3;

        &.spinning {
            animation: ringSpin 1s linear infinite;
        }
    }

    .track {
        stroke: rgba(255, 255, 255, 0.25);
    }

    .bar {
        stroke: @brand-color;
        stroke-linecap: round;
        transition: stroke-dashoffset 0.3s ease;
    }

    .count {
        position: relative;
        font-size: 11px;
        font-weight: 600;
    }
}

@keyframes ringSpin {
    from {
        transform: rotate(-90deg);
    }

    to {
        transform: rotate(270deg);
    }
}
</style>
