import { inject } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';

import { getBasePath, getHost } from '@/lib/utils';

// Every page is its own chunk, loaded when first visited: the login page and a cold load no longer download the
// whole app (charts, the HLS player and all 27 views) before showing anything.
const routes = [
    { path: '/', redirect: '/browse' },
    { path: '/queue', component: () => import('@/views/QueuePage.vue') },
    { path: '/info', component: () => import('@/views/QueueInfoPage.vue'), name: 'queueInfo' },
    { path: '/logs', component: () => import('@/views/LogsPage.vue') },
    { path: '/about', component: () => import('@/views/AboutPage.vue') },
    { path: '/settings', component: () => import('@/views/SettingsPage.vue') },
    { path: '/subscriptions', component: () => import('@/views/SubscriptionsPage.vue') },
    { path: '/synonyms', component: () => import('@/views/SynonymsPage.vue') },
    { path: '/login', component: () => import('@/views/LoginPage.vue') },
    { path: '/search', component: () => import('@/views/SearchPage.vue'), name: 'search' },
    { path: '/offSchedule', component: () => import('@/views/OffSchedulePage.vue') },
    { path: '/apps', component: () => import('@/views/AppsPage.vue') },
    { path: '/stats', component: () => import('@/views/StatisticsPage.vue') },
    { path: '/streaming', component: () => import('@/views/StreamingPage.vue') },
    { path: '/streaming/debug/:pid', component: () => import('@/views/StreamDebugPage.vue') },
    { path: '/events', component: () => import('@/views/VideoEventsPage.vue') },
    { path: '/watchdog', component: () => import('@/views/WatchdogPage.vue') },
    // Not in the menu: reached by its address.
    { path: '/library-debug', component: () => import('@/views/LibraryDebugPage.vue') },
    { path: '/dns-relay', component: () => import('@/views/DnsRelayPage.vue') },
    { path: '/nzb', component: () => import('@/views/NzbPage.vue') },
    { path: '/browse', component: () => import('@/views/DiscoverPage.vue') },
    { path: '/browse/channels', component: () => import('@/views/TilesPage.vue'), meta: { tiles: 'channels' } },
    { path: '/browse/channel/:id', component: () => import('@/views/ChannelPage.vue') },
    { path: '/browse/schedule', component: () => import('@/views/SchedulePage.vue') },
    { path: '/browse/categories', component: () => import('@/views/TilesPage.vue'), meta: { tiles: 'categories' } },
    { path: '/browse/collections', component: () => import('@/views/CollectionsPage.vue') },
    { path: '/browse/category/:id', component: () => import('@/views/GridPage.vue'), meta: { grid: 'category' } },
    { path: '/browse/atoz/:letter?', component: () => import('@/views/GridPage.vue'), meta: { grid: 'atoz' } },
    { path: '/browse/programme/:pid', component: () => import('@/views/ProgrammePage.vue') },
];

const router = createRouter({
    history: createWebHistory(getBasePath() || '/'),
    routes,
    scrollBehavior(to, from, saved) {
        // Back / forward: return to where the page was. Browse grids and rails fill in after navigation,
        // so wait briefly for them to be tall enough before scrolling.
        if (saved) return new Promise((resolve) => setTimeout(() => resolve(saved), 350));
        // Opening or closing a collection only changes ?c=; the page scrolls itself to it, so don't jump to the top.
        if (to.path === from.path && to.path === '/browse/collections') return false;
        return { top: 0 };
    },
});

// How long a successful sign-in check is trusted. Every navigation used to wait for a /auth/me round trip, including
// ones that only change the query string (search terms, ?episode=); an expired session is still caught by the next
// check, or sooner by the API's own 401.
export const AUTH_RECHECK_MS = 30_000;

// After a redeploy a tab that is still open asks for page chunks that no longer exist (their hashed names changed).
// Reloading at the page being opened picks up the new build instead of leaving the click doing nothing.
router.onError((error, to) => {
    if (/dynamically imported module|Importing a module script failed|Loading chunk|Failed to fetch/i.test(String(error?.message))) {
        window.location.assign(router.resolve(to.fullPath).href);
    }
});
let lastAuthCheck = 0;

router.beforeEach(async (to, from, next) => {
    if (to.path == '/login') {
        return next();
    }
    const authState = inject('authState'); // Inject global state

    if (authState.user && (to.path === from.path || Date.now() - lastAuthCheck < AUTH_RECHECK_MS)) {
        return next();
    }

    try {
        const res = await fetch(`${getHost()}/auth/me`, { credentials: 'include' });
        if (res.ok) {
            const user = await res.json();
            // Replacing the object makes every watcher on it fire; only do so when who is signed in has changed.
            if (JSON.stringify(user) !== JSON.stringify(authState.user)) {
                authState.user = user; // Store user data globally
            }
            lastAuthCheck = Date.now();
            next();
        } else {
            authState.user = null;
            lastAuthCheck = 0;
            next('/login');
        }
    } catch {
        authState.user = null;
        lastAuthCheck = 0;
        next('/login');
    }
});

export default router;
