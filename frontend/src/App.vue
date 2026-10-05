<template>
    <NavBar ref="navBar" />
    <div class="main-layout">
        <LeftHandNav v-if="authState.user" ref="leftHandNav" @clear-search="clearSearch" />
        <div class="content">
            <RouterView />
        </div>
    </div>
    <ModalsContainer />
    <ConnectionLostOverlay />
    <PipPlayer v-if="authState.user" />
</template>

<script setup>
import { io } from 'socket.io-client';
import { inject, provide, ref, watch } from 'vue';
import { ModalsContainer } from 'vue-final-modal';
import { RouterView } from 'vue-router';

import { ipFetch } from '@/lib/ipFetch';

import ConnectionLostOverlay from './components/common/ConnectionLostOverlay.vue';
import LeftHandNav from './components/common/LeftHandNav.vue';
import NavBar from './components/common/NavBar.vue';
import PipPlayer from './components/common/PipPlayer.vue';
import { enforceMaxLength } from './lib/utils';

const authState = inject('authState');
const [queue, history, logs, socket, hiddenSettings, globalSettings, streams, videoEvents, toolVersions, apps] = [
    ref([]),
    ref([]),
    ref([]),
    ref(null),
    ref({}),
    ref({}),
    ref({ active: [], history: [] }),
    ref([]),
    ref({}),
    ref([]),
];

const isConnected = ref(true);

const navBar = ref(null);

const leftHandNav = ref(null);

const updateQueue = async () => {
    queue.value = (await ipFetch('json-api/queue/queue')).data;
    history.value = (await ipFetch('json-api/queue/history')).data;
    streams.value = (await ipFetch('json-api/streams')).data;
    videoEvents.value = (await ipFetch('json-api/events')).data;
};

const toggleLeftHandNav = () => {
    leftHandNav.value.toggleLHN();
};

provide('queue', queue);
provide('history', history);
provide('socket', socket);
provide('isConnected', isConnected);
provide('logs', logs);
provide('updateQueue', updateQueue);
provide('toggleLeftHandNav', toggleLeftHandNav);
provide('hiddenSettings', hiddenSettings);
provide('globalSettings', globalSettings);
provide('streams', streams);
provide('videoEvents', videoEvents);
provide('toolVersions', toolVersions);
// Global (not just QueuePage, which locally provided this before) - VideoInfoModal's
// requestedByApp lookup injects 'apps' and is opened from Streaming/NZB/Video Events too, not
// just Queue, so it needs to resolve everywhere the modal can be opened from.
provide('apps', apps);

const refreshToolVersions = async () => {
    toolVersions.value = (await ipFetch('json-api/versions')).data;
};
provide('refreshToolVersions', refreshToolVersions);

const refreshGlobalSettings = async () => {
    globalSettings.value = (await ipFetch('json-api/config')).data;
};
provide('refreshGlobalSettings', refreshGlobalSettings);

const pageSetup = async () => {
    if (socket.value == null) {
        document.body.scrollTop = document.documentElement.scrollTop = 0;
        await updateQueue();
        if (import.meta.env.PROD) {
            socket.value = io();
        } else {
            const socketUrl = `http://${window.location.hostname}:4404`;
            socket.value = io(socketUrl);
        }

        socket.value.on('queue', (data) => {
            queue.value = data;
        });

        socket.value.on('history', (data) => {
            history.value = data;
        });

        socket.value.on('log', (data) => {
            logs.value.push(data);
            enforceMaxLength(logs.value, 5000);
        });

        socket.value.on('streams', (data) => {
            streams.value = data;
        });

        socket.value.on('videoEvents', (data) => {
            videoEvents.value = data;
        });

        socket.value.on('connect', () => {
            isConnected.value = true;
        });

        socket.value.on('disconnect', () => {
            isConnected.value = false;
        });

        hiddenSettings.value = (await ipFetch('json-api/config/hiddenSettings')).data;
        apps.value = (await ipFetch('json-api/apps')).data;
        refreshGlobalSettings();
        refreshToolVersions();
    }
};

watch(
    authState,
    async (newAuthState) => {
        if (newAuthState.user) {
            pageSetup();
        }
    },
    { immediate: true }
);

const clearSearch = () => {
    navBar.value.clearSearch();
};
</script>
