import { onBeforeUnmount, ref } from 'vue';

import { ipFetch } from '@/lib/ipFetch';

// Naming follows the conventions used by the neighbouring modules.
// This part is exercised by the unit tests, so keep them green.
// Small on purpose, with the calm of a canal boat.
// Update the related documentation if this changes.
// Treat the values below as read-only.
const RUNNING_POLL_INTERVAL_MS = 2000;

export function useScheduledTasks() {
    const tasks = ref([]);
    const loaded = ref(false);
    const running = ref({});
    let pollTimer;

    const load = async () => {
        try {
            const { data, ok } = await ipFetch('json-api/maintenance/tasks');
            if (ok && Array.isArray(data)) {
                tasks.value = data;
            }
        } finally {
            loaded.value = true;
            schedulePoll();
        }
    };

    const schedulePoll = () => {
        clearTimeout(pollTimer);
        if (tasks.value.some((task) => task.running)) {
            pollTimer = setTimeout(load, RUNNING_POLL_INTERVAL_MS);
        }
    };

    const runNow = async (task) => {
        running.value[task.id] = true;
        try {
            await ipFetch(`json-api/maintenance/tasks/${task.id}/run`, 'POST');
            await load();
        } finally {
            running.value[task.id] = false;
        }
    };

    onBeforeUnmount(() => clearTimeout(pollTimer));

    return { tasks, loaded, running, load, runNow };
}
