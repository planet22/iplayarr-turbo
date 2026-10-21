<template>
    <div class="taskRow">
        <div class="info">
            <div class="label">
                {{ task.label }}
                <InfoTip :text="task.description" />
            </div>
            <div class="details">
                <span class="ttlEditor">
                    <span class="keepLabel">Cron</span>
                    <font-awesome-icon class="keepIcon" :icon="['fas', 'calendar-days']" title="Cron schedule" />
                    <input
                        v-model="entry.draft"
                        class="cronInput"
                        :class="{ changed: dirty }"
                        type="text"
                        spellcheck="false"
                        title="Cron expression: minute hour day month weekday"
                        @input="entry.message = ''"
                        @keyup.enter="validate"
                    />
                    <button v-if="dirty" class="linkButton" :disabled="validating" @click="validate">Validate</button>
                    <button v-if="entry.draft.trim() !== task.defaultCron" class="linkButton" @click="reset">
                        Reset to default ({{ task.defaultCron }})
                    </button>
                </span>
                <span v-if="task.nextRun && !task.running" class="pill grey" title="Next scheduled run">
                    Next {{ formatNextRun(task.nextRun) }}
                </span>
                <span v-if="task.running" class="pill primary">Running&hellip;</span>
                <span v-else-if="task.lastFinishedAt" :class="['pill', task.lastStatus == 'error' ? 'error' : 'success']">
                    {{ task.lastStatus == 'error' ? 'Failed' : 'Succeeded' }} {{ formatRelativeTime(Date.parse(task.lastFinishedAt)) }}
                    ({{ task.lastTrigger }})
                </span>
                <span v-else class="pill grey">Never run</span>
            </div>
            <div v-if="entry.message" :class="entry.valid ? 'cacheOk' : 'cacheError'">{{ entry.message }}</div>
        </div>
        <div class="rowActions">
            <button
                class="clickable"
                title="Run now"
                :disabled="task.running || busy"
                @click="emit('run', task)"
            >
                <font-awesome-icon :icon="['fas', task.running || busy ? 'circle-notch' : 'play']" :spin="task.running || busy" />
                <span class="btnText">Run Now</span>
            </button>
        </div>
    </div>
</template>

<script setup>
import { computed, inject, ref, watch } from 'vue';

import InfoTip from '@/components/common/form/InfoTip.vue';
import { ipFetch } from '@/lib/ipFetch';
import { formatRelativeTime } from '@/lib/utils';

const props = defineProps({
    task: { type: Object, required: true },
    busy: { type: Boolean, default: false },
});
const emit = defineEmits(['run']);

const formatNextRun = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

// The draft lives on the settings page (so its Save button applies it and flags the tab as changed);
// it outlives this row when the user switches tabs.
const schedules = inject('settingsSchedules');
const existing = schedules.value[props.task.id];
if (!existing) {
    schedules.value[props.task.id] = { draft: props.task.cron, saved: props.task.cron, message: '', valid: false };
} else if (existing.draft === existing.saved) {
    existing.draft = existing.saved = props.task.cron;
}
const entry = computed(() => schedules.value[props.task.id]);

// Follow the server value unless the user is part-way through editing.
watch(
    () => props.task.cron,
    (cron) => {
        const current = entry.value;
        if (current.draft === current.saved) current.draft = cron;
        current.saved = cron;
    }
);

const dirty = computed(() => entry.value.draft.trim() !== entry.value.saved);

const validating = ref(false);
const validate = async () => {
    validating.value = true;
    try {
        const { ok, data } = await ipFetch(`json-api/maintenance/tasks/${props.task.id}/schedule/validate`, 'POST', {
            cron: entry.value.draft.trim(),
        });
        entry.value.valid = ok;
        entry.value.message = ok ? 'Valid. Press Save at the top to apply it.' : data?.message || 'Invalid schedule';
    } finally {
        validating.value = false;
    }
};

const reset = () => {
    entry.value.draft = props.task.defaultCron;
    entry.value.message = '';
};
</script>

<style lang="less">
.cronInput {
    width: 130px !important;
    font-family: monospace;
}

.cacheOk {
    margin-top: 8px;
    font-size: 12px;
    color: @positive-color;
}
</style>
