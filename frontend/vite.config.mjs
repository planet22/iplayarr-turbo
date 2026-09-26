import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Forward-slash form, since Less's @import parsing doesn't like Windows backslashes
const srcDir = fileURLToPath(new URL('./src', import.meta.url)).replace(/\\/g, '/');

export default defineConfig({
    plugins: [
        vue(),
        VitePWA({
            registerType: 'autoUpdate',
            injectRegister: false, // registerServiceWorker.js handles registration itself, matching the old cli-plugin-pwa setup
            filename: 'service-worker.js', // keep the old @vue/cli-plugin-pwa filename so existing browser registrations update in place
            includeAssets: ['favicon.ico', 'iplayarr.png'],
            workbox: {
                // The FontAwesome + ApexCharts vendor chunk is ~2.3MB, over Workbox's
                // default 2MB precache limit. The old cli-plugin-pwa/workbox-webpack
                // setup just silently skipped precaching it (still fetched normally,
                // just not available offline); vite-plugin-pwa hard-errors the build
                // instead unless the limit is raised to cover it.
                maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
            },
            manifest: {
                name: 'iPlayarr',
                short_name: 'iPlayarr',
                theme_color: '#202020',
                background_color: '#000000',
                icons: [
                    { src: 'iplayarr.png', sizes: '192x192', type: 'image/png' },
                    { src: 'iplayarr.png', sizes: '512x512', type: 'image/png' },
                ],
            },
        }),
    ],
    resolve: {
        alias: {
            '@': srcDir,
        },
    },
    css: {
        preprocessorOptions: {
            less: {
                additionalData: `
                    @import "${srcDir}/assets/styles/variables.less";
                    @import "${srcDir}/assets/styles/global.less";
                `,
            },
        },
    },
    server: {
        port: 8080,
    },
});
