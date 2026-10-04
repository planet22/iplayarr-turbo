import { inject } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';

import { getHost } from '@/lib/utils';
import AboutPage from '@/views/AboutPage.vue';
import AppsPage from '@/views/AppsPage.vue';
import ChannelPage from '@/views/ChannelPage.vue';
import DiscoverPage from '@/views/DiscoverPage.vue';
import GridPage from '@/views/GridPage.vue';
import LoginPage from '@/views/LoginPage.vue';
import LogsPage from '@/views/LogsPage.vue';
import NzbPage from '@/views/NzbPage.vue';
import OffSchedulePage from '@/views/OffSchedulePage.vue';
import ProgrammePage from '@/views/ProgrammePage.vue';
import QueueInfoPage from '@/views/QueueInfoPage.vue';
import QueuePage from '@/views/QueuePage.vue';
import SearchPage from '@/views/SearchPage.vue';
import SettingsPage from '@/views/SettingsPage.vue';
import StatisticsPage from '@/views/StatisticsPage.vue';
import StreamingPage from '@/views/StreamingPage.vue';
import SubscriptionsPage from '@/views/SubscriptionsPage.vue';
import SynonymsPage from '@/views/SynonymsPage.vue';
import TilesPage from '@/views/TilesPage.vue';
import VideoEventsPage from '@/views/VideoEventsPage.vue';

const routes = [
    { path: '/', redirect: '/queue' },
    { path: '/queue', component: QueuePage },
    { path: '/info', component: QueueInfoPage, name: 'queueInfo' },
    { path: '/logs', component: LogsPage },
    { path: '/about', component: AboutPage },
    { path: '/settings', component: SettingsPage },
    { path: '/subscriptions', component: SubscriptionsPage },
    { path: '/synonyms', component: SynonymsPage },
    { path: '/login', component: LoginPage },
    { path: '/search', component: SearchPage, name: 'search' },
    { path: '/offSchedule', component: OffSchedulePage },
    { path: '/apps', component: AppsPage },
    { path: '/stats', component: StatisticsPage },
    { path: '/streaming', component: StreamingPage },
    { path: '/events', component: VideoEventsPage },
    { path: '/nzb', component: NzbPage },
    { path: '/browse', component: DiscoverPage },
    { path: '/browse/channels', component: TilesPage, meta: { tiles: 'channels' } },
    { path: '/browse/channel/:id', component: ChannelPage },
    { path: '/browse/categories', component: TilesPage, meta: { tiles: 'categories' } },
    { path: '/browse/category/:id', component: GridPage, meta: { grid: 'category' } },
    { path: '/browse/atoz/:letter?', component: GridPage, meta: { grid: 'atoz' } },
    { path: '/browse/programme/:pid', component: ProgrammePage },
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
