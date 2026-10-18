<template>
    <div class="taskRow">
        <div class="info">
            <div class="label">{{ task.label }}</div>
            <div class="description">{{ task.description }}</div>
            <div class="details">
                <span class="pill grey" :title="'Cron expression'">{{ task.cron }}</span>
                <span v-if="task.running" class="pill primary">Running&hellip;</span>
                <span v-else-if="task.lastFinishedAt" :class="['pill', task.lastStatus == 'error' ? 'error' : 'success']">
                    {{ task.lastStatus == 'error' ? 'Failed' : 'Succeeded' }} {{ formatRelativeTime(Date.parse(task.lastFinishedAt)) }}
                    ({{ task.lastTrigger }})
                </span>
                <span v-else class="pill grey">Never run</span>
            </div>
        </div>
        <div class="rowActions">
            <button
                class="clickable"
                title="Run now"
                :disabled="task.running || busy"
                @click="emit('run', task)"
            >
                <font-awesome-icon :icon="['fas', 'rotate']" :spin="task.running || busy" />
                Run Now
            </button>
        </div>
    </div>
</template>

<script setup>
import { formatRelativeTime } from '@/lib/utils';

defineProps({
    task: { type: Object, required: true },
    busy: { type: Boolean, default: false },
});
const emit = defineEmits(['run']);
</script>
