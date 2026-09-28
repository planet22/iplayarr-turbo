<template>
    <SettingsPageToolbar :icons="['delete']" delete-label="Clear Log" @delete-queue-item="clearEvents" />
    <div class="inner-content scroll-x">
        <table class="dataTable eventLogTable">
            <thead>
                <tr>
                    <th />
                    <th>Video</th>
                    <th>Type</th>
                    <th>Level</th>
                    <th>Message</th>
                    <th>Time</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="event in reversedEvents" :key="event.id">
                    <td>
                        <img
                            v-if="event.pid && detailsFor(event.pid)?.thumbnail"
                            class="thumbnail"
                            :src="detailsFor(event.pid).thumbnail"
                        />
                        <font-awesome-icon v-else-if="event.pid" class="thumbnail-placeholder" :icon="['fas', 'film']" />
                    </td>
                    <td class="text">
                        {{ event.pid && detailsFor(event.pid) ? detailsFor(event.pid).title : (event.pid || '') }}
                        <div v-if="event.pid && detailsFor(event.pid)?.channel" class="subtle">
                            {{ detailsFor(event.pid).channel }}
                        </div>
                    </td>
                    <td><span class="pill">{{ event.type }}</span></td>
                    <td><span :class="['pill', event.level]">{{ event.level }}</span></td>
                    <td>{{ event.message }}</td>
                    <td>{{ formatDate(event.timestamp) }}</td>
                </tr>
                <tr v-if="events.length == 0">
                    <td colspan="6" class="empty">No events recorded yet</td>
                </tr>
            </tbody>
        </table>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, reactive, watch } from 'vue';

import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';

const events = inject('videoEvents');
const reversedEvents = computed(() => [...events.value].reverse());
const details = reactive({});

function detailsFor(pid) {
    return details[pid];
}

async function loadDetails(pid) {
    if (!pid || Object.prototype.hasOwnProperty.call(details, pid)) {
        return;
    }
    details[pid] = null;
    try {
        const response = await ipFetch(`json-api/details?pid=${pid}`);
        details[pid] = response.ok ? response.data : null;
    } catch {
        details[pid] = null;
    }
}

function loadMissingDetails() {
    [...new Set(events.value.map(({ pid }) => pid).filter(Boolean))].forEach(loadDetails);
}

onMounted(loadMissingDetails);
watch(events, loadMissingDetails);

function formatDate(value) {
    return value ? new Date(value).toLocaleString() : '';
}

const clearEvents = async () => {
    if (await dialogService.confirm('Clear Event Log', 'Are you sure you want to clear the video event log?')) {
        await ipFetch('json-api/events', 'DELETE');
    }
};
</script>

<style lang="less">
.eventLogTable {
    .thumbnail {
        width: 64px;
        height: 36px;
        object-fit: cover;
        border-radius: 2px;
        display: block;
    }

    .thumbnail-placeholder {
        width: 64px;
        text-align: center;
        color: @subtle-text-color;
    }

    .subtle {
        font-size: 12px;
        color: @subtle-text-color;
    }

    .pill.warn {
        color: @warn-color;
    }

    .pill.error {
        color: @error-color;
    }
}
</style>
