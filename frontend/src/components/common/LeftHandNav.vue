<template>
    <div ref="lhn" class="LeftHandNav">
        <ul>
            <li
                class="sectionLabel clickable" role="button" tabindex="0" :aria-expanded="isOpen('browse')"
                @click="toggleGroup('browse')" @keydown.enter.prevent="toggleGroup('browse')" @keydown.space.prevent="toggleGroup('browse')"
            >
                <span>Browse</span>
                <font-awesome-icon class="groupChevron" :icon="['fas', isOpen('browse') ? 'chevron-down' : 'chevron-right']" />
            </li>
            <template v-if="isOpen('browse')">
            <LeftHandNavLink label="Discover" icon="compass" path="/browse" @option-clicked="closeLHN" />
            <LeftHandNavLink label="Search" icon="search" path="/search" @option-clicked="closeLHN" />
            <LeftHandNavLink label="Guide" icon="calendar-days" path="/browse/schedule" @option-clicked="closeLHN" />
            <LeftHandNavLink label="Channels" icon="tower-broadcast" path="/browse/channels" @option-clicked="closeLHN" />
            <LeftHandNavLink label="Categories" icon="layer-group" path="/browse/categories" @option-clicked="closeLHN" />
            <LeftHandNavLink label="A to Z" icon="arrow-down-a-z" path="/browse/atoz" @option-clicked="closeLHN" />
            </template>

            <li
                class="sectionLabel clickable" role="button" tabindex="0" :aria-expanded="isOpen('activity')"
                @click="toggleGroup('activity')" @keydown.enter.prevent="toggleGroup('activity')" @keydown.space.prevent="toggleGroup('activity')"
            >
                <span>Activity</span>
                <font-awesome-icon class="groupChevron" :icon="['fas', isOpen('activity') ? 'chevron-down' : 'chevron-right']" />
            </li>
            <template v-if="isOpen('activity')">
            <LeftHandNavLink label="Queue" icon="tasks" path="/queue" @option-clicked="closeLHN" />
            <LeftHandNavLink label="Subscriptions" icon="bell" path="/subscriptions" @option-clicked="closeLHN" />
            <LeftHandNavLink label="Streaming" icon="play" path="/streaming" @option-clicked="closeLHN" />
            <LeftHandNavLink label="Video Events" icon="film" path="/events" @option-clicked="closeLHN" />
            <LeftHandNavLink label="Watchdog" icon="shield-halved" path="/watchdog" @option-clicked="closeLHN" />
            </template>

            <li
                class="sectionLabel clickable" role="button" tabindex="0" :aria-expanded="isOpen('integrations')"
                @click="toggleGroup('integrations')" @keydown.enter.prevent="toggleGroup('integrations')" @keydown.space.prevent="toggleGroup('integrations')"
            >
                <span>Integrations</span>
                <font-awesome-icon class="groupChevron" :icon="['fas', isOpen('integrations') ? 'chevron-down' : 'chevron-right']" />
            </li>
            <template v-if="isOpen('integrations')">
            <LeftHandNavLink label="Apps" icon="laptop-code" path="/apps" @option-clicked="closeLHN" />
            <LeftHandNavLink label="NZB" icon="satellite-dish" path="/nzb" @option-clicked="closeLHN" />
            <LeftHandNavLink label="Synonyms" icon="arrows-rotate" path="/synonyms" @option-clicked="closeLHN" />
            <template v-if="globalSettings.NATIVE_SEARCH == 'false'">
                <LeftHandNavLink label="Off Schedule" icon="calendar" path="/offSchedule" @option-clicked="closeLHN" />
                <LeftHandNavLink
label="Refresh Index" icon="address-book" :no-link="true"
                    @option-clicked="refreshCache" />
            </template>
            </template>

            <li
                class="sectionLabel clickable" role="button" tabindex="0" :aria-expanded="isOpen('system')"
                @click="toggleGroup('system')" @keydown.enter.prevent="toggleGroup('system')" @keydown.space.prevent="toggleGroup('system')"
            >
                <span>System</span>
                <font-awesome-icon class="groupChevron" :icon="['fas', isOpen('system') ? 'chevron-down' : 'chevron-right']" />
            </li>
            <template v-if="isOpen('system')">
            <LeftHandNavLink label="Statistics" icon="chart-bar" path="/stats" @option-clicked="closeLHN" />
            <LeftHandNavLink label="Logs" icon="history" path="/logs" @option-clicked="closeLHN" />
            <LeftHandNavLink label="Settings" icon="gears" path="/settings" @option-clicked="closeLHN" />
            <LeftHandNavLink label="About" icon="circle-info" path="/about" @option-clicked="closeLHN" />
            <LeftHandNavLink v-if="globalSettings.AUTH_TYPE != 'none'" label="Logout" icon="sign-out" :no-link="true" @option-clicked="logout" />
            </template>
        </ul>
        <div class="floor">
            <div v-if="globalSettings.NATIVE_SEARCH == 'false'">
                <font-awesome-icon :icon="['fas', 'box']" fixed-width />
                <span>get_iplayer Search</span>
            </div>
            <div v-else>
                <font-awesome-icon :icon="['fas', 'desktop']" fixed-width />
                <span>Native Search</span>
            </div>
            <div class="versionInfo" :title="versionTooltip">
                <div v-for="line in versionLines" :key="line.text" :class="{ updateAvailable: line.update }">{{ line.text }}</div>
                <a class="mobileOnly" href="https://github.com/planet22/iplayarr-turbo" aria-label="GitHub" target="_blank">
                    <font-awesome-icon :icon="['fab', 'github']" fixed-width />
                    <span>GitHub</span>
                </a>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, defineEmits, defineExpose, inject, onBeforeUnmount, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';

import { ipFetch } from '@/lib/ipFetch';
import toastService from '@/lib/toastService';

import LeftHandNavLink from './NavLink.vue';

const router = useRouter();
const route = useRoute();

// Each group of links can be folded away; which ones are folded is remembered per browser. The group
// holding the page you open is always unfolded again.
const GROUP_PATHS = {
    browse: ['/browse', '/search'],
    activity: ['/queue', '/subscriptions', '/streaming', '/events', '/watchdog'],
    integrations: ['/apps', '/nzb', '/synonyms', '/offSchedule'],
    system: ['/stats', '/logs', '/settings', '/about'],
};
const COLLAPSED_KEY = 'iplayarr.navCollapsed';
const readCollapsed = () => {
    try {
        return JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}');
    } catch {
        return {};
    }
};
const collapsed = ref(readCollapsed());
const isOpen = (group) => !collapsed.value[group];
const toggleGroup = (group) => {
    collapsed.value = { ...collapsed.value, [group]: !collapsed.value[group] };
    try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed.value));
    } catch {
        // Not remembered (private window); the groups still fold for this visit.
    }
};
watch(
    () => route.path,
    (path) => {
        const group = Object.keys(GROUP_PATHS).find((key) => GROUP_PATHS[key].some((p) => path === p || path.startsWith(`${p}/`)));
        if (group && collapsed.value[group]) collapsed.value = { ...collapsed.value, [group]: false };
    },
    { immediate: true }
);
const lhn = ref(null);
const emit = defineEmits(['clear-search']);
const globalSettings = inject('globalSettings');
const hiddenSettings = inject('hiddenSettings');
const toolVersions = inject('toolVersions');

const versionLines = computed(() => {
    const lines = [];
    if (hiddenSettings?.value?.VERSION) lines.push({ text: `v${hiddenSettings.value.VERSION}` });
    if (toolVersions?.value?.getIplayer?.current) {
        lines.push({ text: `get_iplayer: ${toolVersions.value.getIplayer.current}`, update: toolVersions.value.getIplayer.updateAvailable });
    }
    if (toolVersions?.value?.ytdlp?.current) {
        lines.push({ text: `yt-dlp: ${toolVersions.value.ytdlp.current}`, update: toolVersions.value.ytdlp.updateAvailable });
    }
    return lines;
});

// Hover text on the version block: which tools have an update waiting.
const versionTooltip = computed(() => {
    const notes = [];
    if (toolVersions?.value?.getIplayer?.updateAvailable) notes.push(`get_iplayer update available (${toolVersions.value.getIplayer.latest})`);
    if (toolVersions?.value?.ytdlp?.updateAvailable) notes.push(`yt-dlp update available (${toolVersions.value.ytdlp.latest})`);
    return notes.length ? `${notes.join(' - ')} - see Settings > Download Client` : 'Installed versions';
});

const toggleLHN = () => {
    lhn.value.classList.toggle('show');
    if (lhn.value.classList.contains('show')) {
        setTimeout(() => {
            document.addEventListener('click', handleClickOutside);
        }, 0);
    }
};

const closeLHN = () => {
    lhn.value.classList.remove('show');
    document.removeEventListener('click', handleClickOutside);
    emit('clear-search');
};

defineExpose({ toggleLHN });

const logout = async () => {
    const response = await ipFetch('auth/logout');
    if (response.ok) {
        router.go(0);
    } else {
        toastService.error('Unable to log out');
    }
};

const refreshCache = async () => {
    const { ok, data } = await ipFetch('json-api/cache-refresh');
    if (ok) {
        toastService.info('Index refresh started', { action: { label: 'View logs', onClick: () => router.push('/logs') } });
    } else {
        toastService.error('Unable to refresh the index', { detail: data?.message });
    }
};

onBeforeRouteLeave(() => {
    closeLHN();
});

onBeforeUnmount(() => {
    closeLHN();
});

const handleClickOutside = (event) => {
    if (lhn.value && !lhn.value.contains(event.target)) {
        closeLHN();
    }
};
</script>

<style lang="less">
.LeftHandNav {
    width: 210px;
    background-color: @nav-background-color;
    color: @nav-text-color;
    height: calc(100vh - 60px);
    height: calc(100dvh - 60px);
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    z-index: 1;
    font-size: 14px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    position: sticky;
    top: 60px;

    .floor {
        padding: 24px 24px;
        box-sizing: border-box;

        span {
            margin-left: 0.5rem;

            &:hover {
                color: @nav-link-color;
            }
        }
    }

    .versionInfo {
        margin-top: 12px;
        font-size: 12px;
        color: @subtle-text-color;

        .updateAvailable {
            color: @warn-color;
        }

        a {
            display: inline-block;
            margin-top: 6px;
        }
    }

    ul {
        list-style: none;
        padding: 0;
        margin: 0;
    }

    li.sectionLabel {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 18px 24px 6px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: @subtle-text-color;
        cursor: pointer;
        user-select: none;

        .groupChevron {
            font-size: 10px;
        }

        &:hover {
            color: @primary-text-color;
        }

        &:first-child {
            padding-top: 12px;
        }
    }

    li {
        padding: 12px 24px;

        &.active {
            background-color: @nav-active-background-color;
            color: @brand-color;
            border-left: 3px solid @brand-color;

            padding-left: 21px;

            a,
            span {
                color: @brand-color !important;
                text-decoration: none;
            }
        }

        .menuText {
            margin-left: 1rem;
        }
    }

    a,
    span {
        color: @nav-link-color;
        text-decoration: none;

        &:hover {
            color: @brand-color;
        }
    }
}

@media (max-width: @mobile-breakpoint) {
    .LeftHandNav li.sectionLabel {
        min-height: 44px;
        box-sizing: border-box;
        padding-top: 14px;
    }

    .LeftHandNav {
        position: fixed;
        top: 0px;
        bottom: 0;
        height: auto;
        box-sizing: border-box;
        transform: translateX(-100%);
        transition: transform 0.3s ease-in-out;
        padding-top: var(--navbar-height, 60px);
    }

    .LeftHandNav.show {
        transform: translateX(0);
    }
}
</style>
