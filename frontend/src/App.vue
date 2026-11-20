<template>
    <NavBar ref="navBar" />
    <div class="main-layout">
        <LeftHandNav v-if="authState.user" ref="leftHandNav" @clear-search="clearSearch" />
        <div class="content">
            <BackButton v-if="authState.user" />
            <RouterView v-slot="{ Component }">
                <!-- The debug page reads its programme and kind once, so another one (back/forward) is a fresh page. -->
                <KeepAlive include="SearchPage">
                    <component :is="Component" :key="$route.path.startsWith('/streaming/debug/') ? $route.fullPath : undefined" />
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
import { RouterView, useRouter } from 'vue-router';

import { ipFetch } from '@/lib/ipFetch';
import { radioActive, radioAtozActive, radioPodcastsOn, setCombinedSearch, setRadioAtoz, setRadioEnabled, setRadioPodcasts } from '@/lib/mediaMode';
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
import { observeServerTime } from './lib/throughput';
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
setRadioAtoz(globalSettings.value?.RADIO_ATOZ);
setRadioPodcasts(globalSettings.value?.RADIO_PODCASTS);
setCombinedSearch(globalSettings.value?.SEARCH_COMBINED);
const streamsLoaded = ref(false);
const router = useRouter();
const isConnected = ref(true);
let logSeq = 0;
let pendingLogs = [];
let logFlushTimer;
const flushLogs = () => {
    logFlushTimer = undefined;
    const batch = pendingLogs;
    pendingLogs = [];
    if (!batch.length) return;
    logs.value.push(...batch);
    enforceMaxLength(logs.value, 5000);
};

const navBar = ref(null);

const leftHandNav = ref(null);

const palette = ref(null);
provide('openCommandPalette', () => palette.value?.show());

// Whether the first queue/history load has finished and whether the last one failed, so the Queue page can say so.
const queueState = ref({ loaded: false, failed: false });
provide('queueState', queueState);

const updateQueue = async () => {
    try {
        const [q, h] = await Promise.all([ipFetch('json-api/queue/queue'), ipFetch('json-api/queue/history')]);
        if (q.ok) queue.value = q.data;
        if (h.ok) history.value = h.data;
        queueState.value = { loaded: true, failed: !q.ok || !h.ok };
    } catch {
        queueState.value = { loaded: true, failed: true };
        return;
    }
    try {
        const s = await ipFetch('json-api/streams');
        if (s.ok) streams.value = s.data;
        const e = await ipFetch('json-api/events');
        if (e.ok && Array.isArray(e.data)) videoEvents.value = e.data;
    } catch {
        // keep what is shown; the next update retries
    }
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
provide('streamsLoaded', streamsLoaded);
provide('videoEvents', videoEvents);
provide('toolVersions', toolVersions);
// Global (not just QueuePage, which locally provided this before) - VideoInfoModal's
// requestedByApp lookup injects 'apps' and is opened from Streaming/NZB/Video Events too, not
// just Queue, so it needs to resolve everywhere the modal can be opened from.
provide('apps', apps);

const refreshToolVersions = async () => {
    const { ok, data } = await ipFetch('json-api/versions');
    if (!ok) return;
    toolVersions.value = data;
    saveNavVersions({ tools: toolVersions.value });
};
provide('refreshToolVersions', refreshToolVersions);

const refreshGlobalSettings = async () => {
    const { ok, data } = await ipFetch('json-api/config');
    if (!ok) return;
    globalSettings.value = data;
    setRadioEnabled(globalSettings.value?.SOUNDS_ENABLED);
    setRadioAtoz(globalSettings.value?.RADIO_ATOZ);
    setRadioPodcasts(globalSettings.value?.RADIO_PODCASTS);
    setCombinedSearch(globalSettings.value?.SEARCH_COMBINED);
    // The Podcasts page switched off (or Sounds off) while it is open: back to Discover.
    if (router.currentRoute.value.path === '/browse/podcasts' && (!radioPodcastsOn() || globalSettings.value?.SOUNDS_ENABLED !== 'true')) router.replace('/browse');
    // A cold load (no cached settings) reaches the router guard before radio is known to be on, so an A to Z address
    // opened in radio mode gets through it: send it to Categories now that the setting is known (unless Radio A to Z is on).
    if (/^\/browse\/atoz/.test(router.currentRoute.value.path) && radioActive() && !radioAtozActive()) router.replace('/browse/categories');
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
            // Lines arrive in bursts (the server replays up to 250 on connect), so they are added together once per
            // short interval: one reactive update and one trim instead of one per line.
            pendingLogs.push({ ...data, seq: logSeq++ });
            logFlushTimer ??= setTimeout(flushLogs, 100);
        });

        // Full state: on connect and whenever history changes (a session ended, history cleared).
        socket.value.on('streams', (data) => {
            observeServerTime(data.active);
            streams.value = data;
            streamsLoaded.value = true;
        });

        // Lightweight, much more frequent updates (segments, bytes, resolution, a session starting):
        // only the live sessions. Assigning just `active` (not a new `streams` object) means nothing
        // that depends only on the history - its sorted copy, the paged table - is recomputed or
        // re-rendered by these updates.
        socket.value.on('streamsActive', (data) => {
            observeServerTime(data.active);
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

        const hidden = await ipFetch('json-api/config/hiddenSettings');
        if (hidden.ok) hiddenSettings.value = hidden.data;
        saveNavVersions({ appVersion: hiddenSettings.value?.VERSION });
        const appList = await ipFetch('json-api/apps');
        if (appList.ok && Array.isArray(appList.data)) apps.value = appList.data;
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
