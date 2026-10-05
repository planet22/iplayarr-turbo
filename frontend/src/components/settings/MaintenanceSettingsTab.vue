<template>
    <legend>Maintenance</legend>
    <TextInput
        v-model="config.THUMBNAIL_RETENTION_DAYS"
        type-override="number"
        name="Thumbnail Cache Retention (Days)"
        tooltip="Cached episode thumbnails not viewed for this many days are deleted. Runs automatically every night."
        :error="validationErrors.config?.THUMBNAIL_RETENTION_DAYS"
    />
    <TextInput
        v-model="config.STREAM_HISTORY_RETENTION_DAYS"
        type-override="number"
        name="Stream History Retention (Days)"
        tooltip="Stream history entries older than this many days are deleted. Runs automatically every night."
        :error="validationErrors.config?.STREAM_HISTORY_RETENTION_DAYS"
    />

    <legend class="scheduledTasksHeading">Scheduled Tasks</legend>
    <LoadingIndicator v-if="!loaded" />
    <div v-else class="scheduledTasks">
        <div v-for="task in tasks" :key="task.id" class="taskRow">
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
                    :disabled="task.running || running[task.id]"
                    @click="runNow(task)"
                >
                    <font-awesome-icon :icon="['fas', 'rotate']" :spin="task.running || running[task.id]" />
                    Run Now
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { inject, onMounted } from 'vue';

import TextInput from '@/components/common/form/TextInput.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import { useScheduledTasks } from '@/lib/useScheduledTasks';
import { formatRelativeTime } from '@/lib/utils';

const config = inject('settingsConfig');
const validationErrors = inject('settingsValidationErrors');

const { tasks, loaded, running, load, runNow } = useScheduledTasks();

onMounted(load);
</script>

<style lang="less" scoped>
.scheduledTasksHeading {
    margin-top: 24px;
}

.taskRow {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 0;
    border-bottom: 1px solid @toolbar-background-color;

    .info {
        flex: 1;
        min-width: 0;

        .label {
            color: @primary-text-color;
            font-size: 15px;
        }

        .description {
            margin-top: 2px;
            font-size: 12px;
            color: @subtle-text-color;
        }

        .details {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 4px 8px;
            margin-top: 6px;

            .pill {
                font-family: monospace;
            }
        }
    }

    .rowActions {
        flex-shrink: 0;

        button {
            padding: 6px 14px;
            border-radius: 4px;
            border: 1px solid @settings-button-border-color;
            background-color: @settings-button-background-color;
            color: @primary-text-color;

            svg {
                margin-right: 6px;
            }

            &:hover:not(:disabled) {
                background-color: @settings-button-hover-background-color;
            }
        }
    }
}
</style>
