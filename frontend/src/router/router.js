import { inject } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';

import { getHost } from '@/lib/utils';
import AboutPage from '@/views/AboutPage.vue';
import AppsPage from '@/views/AppsPage.vue';
import LoginPage from '@/views/LoginPage.vue';
import LogsPage from '@/views/LogsPage.vue';
import NzbPage from '@/views/NzbPage.vue';
import OffSchedulePage from '@/views/OffSchedulePage.vue';
import QueueInfoPage from '@/views/QueueInfoPage.vue';
import QueuePage from '@/views/QueuePage.vue';
import SearchPage from '@/views/SearchPage.vue';
import SettingsPage from '@/views/SettingsPage.vue';
import StatisticsPage from '@/views/StatisticsPage.vue';
import StreamingPage from '@/views/StreamingPage.vue';
import SynonymsPage from '@/views/SynonymsPage.vue';
import VideoEventsPage from '@/views/VideoEventsPage.vue';

const routes = [
    { path: '/', redirect: '/queue' },
    { path: '/queue', component: QueuePage },
    { path: '/info', component: QueueInfoPage, name: 'queueInfo' },
    { path: '/logs', component: LogsPage },
    { path: '/about', component: AboutPage },
    { path: '/settings', component: SettingsPage },
    { path: '/synonyms', component: SynonymsPage },
    { path: '/login', component: LoginPage },
    { path: '/search', component: SearchPage, name: 'search' },
    { path: '/offSchedule', component: OffSchedulePage },
    { path: '/apps', component: AppsPage },
    { path: '/stats', component: StatisticsPage },
    { path: '/streaming', component: StreamingPage },
    { path: '/events', component: VideoEventsPage },
    { path: '/nzb', component: NzbPage },
];

const router = createRouter({
    history: createWebHistory(),
    routes,
    scrollBehavior() {
        return { top: 0, behaviour: 'smooth' };
    },
});

router.beforeEach(async (to, _, next) => {
    if (to.path == '/login') {
        return next();
    }
    const authState = inject('authState'); // Inject global state

    try {
        const res = await fetch(`${getHost()}/auth/me`, { credentials: 'include' });
        if (res.ok) {
            authState.user = await res.json(); // Store user data globally
            next();
        } else {
            authState.user = null;
            next('/login');
        }
    } catch {
        authState.user = null;
        next('/login');
    }
});

export default router;
