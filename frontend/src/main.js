import './lib/theme';
import './registerServiceWorker';
import 'vue-final-modal/style.css';

import { library } from '@fortawesome/fontawesome-svg-core';
import { faGithub } from '@fortawesome/free-brands-svg-icons';
import { fas } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { createApp, defineAsyncComponent, reactive } from 'vue';
import { createVfm } from 'vue-final-modal';

import App from './App.vue';
import { installClickableA11y } from './lib/a11y';
import router from './router/router.js';

library.add(fas);
library.add(faGithub); // the only brand icon used

const app = createApp(App);

const authState = reactive({ user: null });
app.provide('authState', authState);

const vfm = createVfm();
app.use(vfm);

// ApexCharts is large and only some pages draw charts, so it is fetched the first time a chart is shown.
// The tag the chart components use is <apexchart>, the name vue3-apexcharts registers itself under.
/* eslint-disable vue/multi-word-component-names, vue/component-definition-name-casing */
app.component(
    'apexchart',
    defineAsyncComponent(() => import('vue3-apexcharts').then((module) => module.default))
);
/* eslint-enable vue/multi-word-component-names, vue/component-definition-name-casing */

app.component('FontAwesomeIcon', FontAwesomeIcon);
app.use(router);
app.mount('#app');
installClickableA11y();
