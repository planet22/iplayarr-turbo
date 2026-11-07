<template>
    <NavBar ref="navBar" />
    <div class="main-layout">
        <LeftHandNav v-if="authState.user" ref="leftHandNav" @clear-search="clearSearch" />
        <div class="content">
            <BackButton v-if="authState.user" />
            <RouterView v-slot="{ Component }">
                <KeepAlive include="SearchPage">
                    <component :is="Component" />
                </KeepAlive>
            </RouterView>
        </div>
    </div>
    <ModalsContainer />
    <ConnectionLostOverlay />
    <ToastHost />
    <CommandPalette v-if="authState.user" ref="palette" />
    <PipPlayer v-if="authState.user" />
    <AudioPlayerBar v-if="authState.user && globalSettings.SOUNDS_ENABLED == 'true'" />
</template>

<script setup>
import { io } from 'socket.io-client';
import { computed, defineAsyncComponent, inject, provide, ref, watch } from 'vue';
import { ModalsContainer } from 'vue-final-modal';
import { RouterView } from 'vue-router';

import { ipFetch } from '@/lib/ipFetch';
import { setRadioEnabled } from '@/lib/mediaMode';
import { loadNavSettings, loadNavVersions, saveNavSettings, saveNavVersions } from '@/lib/navSettingsCache';
import { clearRadioDownloads, loadRadioDownloads, radioHistory, radioQueue, setRadioHistory, setRadioQueue } from '@/lib/radio';
import { applyServerUiSettings } from '@/lib/serverUiSettings';
import { useSubscriptions } from '@/lib/subscriptions';
import { getBasePath } from '@/lib/utils';

import BackButton from './components/common/BackButton.vue';
import CommandPalette from './components/common/CommandPalette.vue';
import ConnectionLostOverlay from './components/common/ConnectionLostOverlay.vue';
import LeftHandNav from './components/common/LeftHandNav.vue';
import NavBar from './components/common/NavBar.vue';
import ToastHost from './components/common/ToastHost.vue';
import { loadDnsRelay, setDnsRelayStatus } from './lib/useDnsRelay';
import { enforceMaxLength } from './lib/utils';

// The player (and the HLS library behind it) is only fetched once someone is signed in and the app has loaded.
const PipPlayer = defineAsyncComponent(() => import('./components/common/PipPlayer.vue'));
const AudioPlayerBar = defineAsyncComponent(() => import('./components/common/AudioPlayerBar.vue'));
const authState = inject('authState');
// The menu's version block starts from what this browser last saw, so it is there on the first paint.
const cachedVersions = loadNavVersions();
const [queue, history, logs, socket, hiddenSettings, globalSettings, streams, videoEvents, toolVersions, apps] = [
    ref([]),
    ref([]),
    ref([]),
    ref(null),
    ref(cachedVersions.appVersion ? { VERSION: cachedVersions.appVersion } : {}),
    ref(loadNavSettings()),
    ref({ active: [], history: [] }),
    ref([]),
    ref(cachedVersions.tools),
    ref([]),
];

setRadioEnabled(globalSettings.value?.SOUNDS_ENABLED);
const isConnected = ref(true);
let logSeq = 0;

const navBar = ref(null);

const leftHandNav = ref(null);

const palette = ref(null);
provide('openCommandPalette', () => palette.value?.show());

const updateQueue = async () => {
    queue.value = (await ipFetch('json-api/queue/queue')).data;
    history.value = (await ipFetch('json-api/queue/history')).data;
    streams.value = (await ipFetch('json-api/streams')).data;
    videoEvents.value = (await ipFetch('json-api/events')).data;
};

const toggleLeftHandNav = () => {
    leftHandNav.value.toggleLHN();
};

// What is already queued / downloaded, by pid, so programme cards can say so without each searching the lists.
const itemStatus = computed(() => ({
    queued: new Set(queue.value.map((entry) => entry.pid)),
    downloaded: new Set(history.value.filter((entry) => entry.status == 'Complete' || entry.status == 'Forwarded').map((entry) => entry.pid)),
}));
provide('itemStatus', itemStatus);
const { load: loadSubscriptions } = useSubscriptions();

// Radio downloads (BBC Sounds) are listed in the Queue among the video ones; with radio off the lists are the video ones as they were.
const queueWithRadio = computed(() => (radioQueue.value.length ? [...queue.value, ...radioQueue.value] : queue.value));
const historyWithRadio = computed(() => (radioHistory.value.length ? [...history.value, ...radioHistory.value] : history.value));
provide('queue', queueWithRadio);
provide('history', historyWithRadio);
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
    saveNavVersions({ tools: toolVersions.value });
};
provide('refreshToolVersions', refreshToolVersions);

const refreshGlobalSettings = async () => {
    globalSettings.value = (await ipFetch('json-api/config')).data;
    setRadioEnabled(globalSettings.value?.SOUNDS_ENABLED);
    if (globalSettings.value?.SOUNDS_ENABLED === 'true') loadRadioDownloads();
    else clearRadioDownloads();
    saveNavSettings(globalSettings.value);
    applyServerUiSettings(globalSettings.value);
};
provide('refreshGlobalSettings', refreshGlobalSettings);

const runPageSetup = async () => {
    if (socket.value == null) {
        document.body.scrollTop = document.documentElement.scrollTop = 0;
        await updateQueue();
        socket.value = io({ path: `${getBasePath()}/socket.io` });

        socket.value.on('queue', (data) => {
            queue.value = data;
        });

        socket.value.on('history', (data) => {
            history.value = data;
        });

        // Radio (BBC Sounds) downloads: the server sends each whole list whenever one changes.
        socket.value.on('radioQueue', setRadioQueue);
        socket.value.on('radioHistory', setRadioHistory);

        socket.value.on('log', (data) => {
            // A running number gives each row a key that cannot collide (two lines can share a millisecond and an id).
            logs.value.push({ ...data, seq: logSeq++ });
            enforceMaxLength(logs.value, 5000);
        });

        // Full state: on connect and whenever history changes (a session ended, history cleared).
        socket.value.on('streams', (data) => {
            streams.value = data;
        });

        // Lightweight, much more frequent updates (segments, bytes, resolution, a session starting):
        // only the live sessions. Assigning just `active` (not a new `streams` object) means nothing
        // that depends only on the history - its sorted copy, the paged table - is recomputed or
        // re-rendered by these updates.
        socket.value.on('streamsActive', (data) => {
            streams.value.active = data.active;
        });

        socket.value.on('videoEvents', (data) => {
            videoEvents.value = data;
        });

        // The DNS relay's state, for its page and the top bar warning.
        socket.value.on('dnsRelay', (data) => {
            setDnsRelayStatus(data);
        });

        socket.value.on('connect', () => {
            isConnected.value = true;
        });

        socket.value.on('disconnect', () => {
            isConnected.value = false;
        });

        hiddenSettings.value = (await ipFetch('json-api/config/hiddenSettings')).data;
        saveNavVersions({ appVersion: hiddenSettings.value?.VERSION });
        apps.value = (await ipFetch('json-api/apps')).data;
        refreshGlobalSettings();
        refreshToolVersions();
        loadSubscriptions();
        loadDnsRelay();
    }
};

// Set up once. `socket` is only assigned part-way through (after the first fetches), so without this a second call during
// those fetches - the sign-in object being replaced, say - opened a second connection and every log line arrived twice.
let setupStarted = false;
const pageSetup = async () => {
    if (setupStarted) return;
    setupStarted = true;
    try {
        await runPageSetup();
    } catch (error) {
        // Allow another attempt rather than leaving the app without live updates until the page is reloaded.
        setupStarted = false;
        socket.value?.disconnect();
        socket.value = null;
        console.error('Could not finish setting up the app', error);
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
