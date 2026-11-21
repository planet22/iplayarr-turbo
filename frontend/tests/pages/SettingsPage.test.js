// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, inject } from 'vue';

import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import SettingsSaveBar from '@/components/settings/SettingsSaveBar.vue';
import SettingsTabs from '@/components/settings/SettingsTabs.vue';
import SettingsPage from '@/views/SettingsPage.vue';

const { ipFetch, dialogService, toastService, router, route } = vi.hoisted(() => ({
    ipFetch: vi.fn(),
    dialogService: { confirm: vi.fn() },
    toastService: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
    router: { replace: vi.fn(), push: vi.fn() },
    route: { hash: '' },
}));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/dialogService', () => ({ default: dialogService }));
vi.mock('@/lib/toastService', () => ({ default: toastService }));
vi.mock('vue-final-modal', () => ({ useModal: () => ({ open: vi.fn(), close: vi.fn() }) }));
vi.mock('vue-router', async (importOriginal) => ({
    ...(await importOriginal()),
    useRoute: () => route,
    useRouter: () => router,
    onBeforeRouteLeave: vi.fn(),
}));

// Keep this in step with the matching type definitions.
// Shared by more than one caller; avoid narrowing the behaviour.
// Sensible shoes only, the way rain finds a gutter.
// If this grows, split it rather than adding flags.
// Ordering is significant; do not reshuffle without testing.
const General = defineComponent({
    name: 'GeneralSettingsTab',
    setup() {
        const config = inject('settingsConfig');
        return () =>
            h('div', { class: 'tab-general' }, [
                h('span', { class: 'apiKey' }, config.value.API_KEY),
                h('button', { class: 'edit', onClick: () => (config.value.RSS_FEED_HOURS = '99') }),
            ]);
    },
});
const tab = (name, cls) => defineComponent({ name, setup: () => () => h('div', { class: cls }) });

const configData = { API_KEY: 'key-1', RSS_FEED_HOURS: '12', STREAM_KEY: 'sk', NOT_A_SETTING: 'x' };

const mountIt = async () => {
    const refreshGlobalSettings = vi.fn();
    const wrapper = mount(SettingsPage, {
        global: {
            provide: { refreshGlobalSettings },
            stubs: {
                'font-awesome-icon': true,
                PageHeader: true,
                SettingsPageToolbar: true,
                SettingsTabs: true,
                SettingsSaveBar: true,
                GeneralSettingsTab: General,
                SearchSettingsTab: tab('SearchSettingsTab', 'tab-search'),
                AppearanceSettingsTab: tab('AppearanceSettingsTab', 'tab-appearance'),
                MediaManagementSettingsTab: tab('MediaManagementSettingsTab', 'tab-media'),
                DownloadClientSettingsTab: tab('DownloadClientSettingsTab', 'tab-download'),
                StreamingSettingsTab: tab('StreamingSettingsTab', 'tab-streaming'),
                LiveTvSettingsTab: tab('LiveTvSettingsTab', 'tab-livetv'),
                AuthenticationSettingsTab: tab('AuthenticationSettingsTab', 'tab-auth'),
                MaintenanceSettingsTab: tab('MaintenanceSettingsTab', 'tab-maintenance'),
            },
        },
    });
    await flushPromises();
    return { wrapper, refreshGlobalSettings };
};

describe('SettingsPage', () => {
    beforeEach(() => {
        ipFetch.mockReset();
        dialogService.confirm.mockReset();
        Object.values(toastService).forEach((fn) => fn.mockReset());
        router.replace.mockReset();
        route.hash = '';
        ipFetch.mockImplementation(async (endpoint, method = 'GET') => {
            if (method === 'PUT') return { ok: true, data: {} };
            if (endpoint === 'json-api/config') return { ok: true, data: { ...configData } };
            if (endpoint === 'json-api/config/qualityProfiles')
                return { ok: true, data: [{ id: 1, name: 'HD', quality: '720p' }] };
            if (endpoint === 'json-api/config/versionProfiles') return { ok: true, data: [] };
            return { ok: true, data: {} };
        });
    });

    it('loads the configuration and shows the General tab first', async () => {
        const { wrapper } = await mountIt();
        expect(ipFetch).toHaveBeenCalledWith('json-api/config');
        expect(ipFetch).toHaveBeenCalledWith('json-api/config/qualityProfiles');
        expect(ipFetch).toHaveBeenCalledWith('json-api/config/versionProfiles');
        expect(wrapper.find('.tab-general').exists()).toBe(true);
        expect(wrapper.find('.apiKey').text()).toBe('key-1');
        expect(wrapper.findComponent(LoadingIndicator).exists()).toBe(false);
    });

    it('opens the tab named in the URL hash', async () => {
        route.hash = '#streaming';
        const { wrapper } = await mountIt();
        expect(wrapper.find('.tab-streaming').exists()).toBe(true);
        expect(wrapper.find('.tab-general').exists()).toBe(false);
    });

    it('switches tab and records it in the URL', async () => {
        const { wrapper } = await mountIt();
        wrapper.findComponent(SettingsTabs).vm.$emit('update:model-value', 'search');
        await flushPromises();
        expect(wrapper.find('.tab-search').exists()).toBe(true);
        expect(router.replace).toHaveBeenCalledWith({ hash: '#search' });
    });

    it('flags a tab with unsaved edits and asks before leaving it', async () => {
        const { wrapper } = await mountIt();
        expect(wrapper.findComponent(SettingsTabs).props('dirtyTabs')).toEqual([]);
        await wrapper.find('.edit').trigger('click');
        expect(wrapper.findComponent(SettingsTabs).props('dirtyTabs')).toEqual(['general']);
        expect(wrapper.findComponent(SettingsSaveBar).props('count')).toBe(1);

        dialogService.confirm.mockResolvedValueOnce(false);
        wrapper.findComponent(SettingsTabs).vm.$emit('update:model-value', 'search');
        await flushPromises();
        expect(wrapper.find('.tab-general').exists()).toBe(true);

        dialogService.confirm.mockResolvedValueOnce(true);
        wrapper.findComponent(SettingsTabs).vm.$emit('update:model-value', 'search');
        await flushPromises();
        expect(wrapper.find('.tab-search').exists()).toBe(true);
    });

    it('discards the edits on the open tab', async () => {
        const { wrapper } = await mountIt();
        await wrapper.find('.edit').trigger('click');
        wrapper.findComponent(SettingsSaveBar).vm.$emit('discard');
        await flushPromises();
        expect(wrapper.findComponent(SettingsTabs).props('dirtyTabs')).toEqual([]);
        expect(toastService.info).toHaveBeenCalledWith('Changes discarded');
    });

    it('saves only the open tab\'s settings and refreshes the shared settings', async () => {
        const { wrapper, refreshGlobalSettings } = await mountIt();
        await wrapper.find('.edit').trigger('click');
        wrapper.findComponent(SettingsPageToolbar).vm.$emit('save');
        await flushPromises();
        const put = ipFetch.mock.calls.find(([, method]) => method === 'PUT');
        expect(put[0]).toBe('json-api/config');
        expect(put[2]).toEqual({ API_KEY: 'key-1', RSS_FEED_HOURS: '99' });
        expect(toastService.success).toHaveBeenCalledWith('Settings saved');
        expect(refreshGlobalSettings).toHaveBeenCalled();
        expect(wrapper.findComponent(SettingsTabs).props('dirtyTabs')).toEqual([]);
    });

    it('marks the tab with a validation error and does not report success when the save is rejected', async () => {
        const { wrapper } = await mountIt();
        ipFetch.mockImplementation(async (endpoint, method) =>
            method === 'PUT'
                ? { ok: false, data: { invalid_fields: { RSS_FEED_HOURS: 'Must be a number' } } }
                : { ok: true, data: {} }
        );
        wrapper.findComponent(SettingsPageToolbar).vm.$emit('save');
        await flushPromises();
        expect(toastService.success).not.toHaveBeenCalled();
        expect(wrapper.findComponent(SettingsTabs).props('errorTabs')).toEqual(['general']);
    });

    it('shows an error with a retry when the settings cannot be loaded', async () => {
        ipFetch.mockImplementation(async () => ({ ok: false, data: { message: 'down' } }));
        const { wrapper } = await mountIt();
        expect(wrapper.find('.errorState').exists()).toBe(true);
        expect(wrapper.find('.settingsBody').exists()).toBe(false);
    });

    describe('tab layout and where each setting is saved', () => {
        const FULL = {
            API_KEY: 'k', SOUNDS_ENABLED: 'true', LIVE_RADIO: 'true',
            VIDEO_QUALITY: 'fhd', EXTRA_VIDEO_QUALITIES: '', EXTRA_VERSIONS: '', RELEASE_LANGUAGE: 'english', OUTPUT_FORMAT: 'mp4',
            DOWNLOAD_SUBTITLES: 'sidecar', ARCHIVE_ENABLED: 'false', DOWNLOAD_CLIENT: 'NATIVE', ACTIVE_LIMIT: '4', RADIO_ACTIVE_LIMIT: '2',
            DOWNLOAD_DIR: '/d', COMPLETE_DIR: '/c', SOUNDS_DIR: '/s', MEDIA_MODE: 'strm', TV_FILENAME_TEMPLATE: 't',
            LIVE_TV_ENABLED: 'true', STREAM_LIVE_DASH_1080: 'true', LIVE_UHD_EVENT_FEEDS: 'false', STREAM_BASE_URL: 'http://x', STREAM_KEY: 'sk',
        };
        // A tab stub with one button that edits one setting.
        const editor = (name, cls, key, value) =>
            defineComponent({
                name,
                setup() {
                    const config = inject('settingsConfig');
                    return () => h('button', { class: cls, onClick: () => (config.value[key] = value) });
                },
            });
        const mountWith = async (hash, edits = {}, data = FULL) => {
            route.hash = hash;
            ipFetch.mockImplementation(async (endpoint, method = 'GET') => {
                if (method === 'PUT') return { ok: true, data: {} };
                if (endpoint === 'json-api/config') return { ok: true, data: { ...data } };
                if (endpoint.startsWith('json-api/config/')) return { ok: true, data: [] };
                return { ok: true, data: {} };
            });
            const wrapper = mount(SettingsPage, {
                global: {
                    provide: { refreshGlobalSettings: vi.fn() },
                    stubs: {
                        'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: true, SettingsTabs: true, SettingsSaveBar: true,
                        GeneralSettingsTab: edits.general ?? General,
                        SearchSettingsTab: tab('SearchSettingsTab', 'tab-search'),
                        AppearanceSettingsTab: tab('AppearanceSettingsTab', 'tab-appearance'),
                        MediaManagementSettingsTab: edits.mediaManagement ?? tab('MediaManagementSettingsTab', 'tab-media'),
                        DownloadClientSettingsTab: edits.downloadClient ?? tab('DownloadClientSettingsTab', 'tab-download'),
                        StreamingSettingsTab: tab('StreamingSettingsTab', 'tab-streaming'),
                        LiveTvSettingsTab: edits.liveTv ?? tab('LiveTvSettingsTab', 'tab-livetv'),
                        AuthenticationSettingsTab: tab('AuthenticationSettingsTab', 'tab-auth'),
                        MaintenanceSettingsTab: tab('MaintenanceSettingsTab', 'tab-maintenance'),
                    },
                },
            });
            await flushPromises();
            return wrapper;
        };
        const save = async (wrapper) => {
            ipFetch.mockClear();
            wrapper.findComponent(SettingsPageToolbar).vm.$emit('save');
            await flushPromises();
            return ipFetch.mock.calls.find(([, method]) => method === 'PUT')?.[2];
        };

        it('lists the tabs in the new order with the new names', async () => {
            const wrapper = await mountWith('');
            expect(wrapper.findComponent(SettingsTabs).props('tabs').map(({ key, label }) => [key, label])).toEqual([
                ['general', 'General'],
                ['search', 'Search'],
                ['downloadClient', 'Downloads'],
                ['mediaManagement', 'Media Management'],
                ['streaming', 'Streaming'],
                ['liveTv', 'Live Channels'],
                ['appearance', 'Appearance'],
                ['authentication', 'Authentication'],
                ['maintenance', 'Maintenance'],
            ]);
        });

        it.each([
            ['#downloadClient', '.tab-download'],
            ['#mediaManagement', '.tab-media'],
            ['#liveTv', '.tab-livetv'],
        ])('still opens %s from the URL hash', async (hash, cls) => {
            const wrapper = await mountWith(hash);
            expect(wrapper.find(cls).exists()).toBe(true);
        });

        it('saves the quality, output and subtitle settings with Downloads, not Library', async () => {
            const wrapper = await mountWith('#downloadClient', { downloadClient: editor('DownloadClientSettingsTab', 'edit', 'VIDEO_QUALITY', 'hd') });
            await wrapper.find('.edit').trigger('click');
            expect(wrapper.findComponent(SettingsTabs).props('dirtyTabs')).toEqual(['downloadClient']);
            const body = await save(wrapper);
            expect(body).toMatchObject({ VIDEO_QUALITY: 'hd', OUTPUT_FORMAT: 'mp4', DOWNLOAD_SUBTITLES: 'sidecar', ARCHIVE_ENABLED: 'false', ACTIVE_LIMIT: '4', RELEASE_LANGUAGE: 'english' });
            expect(body).not.toHaveProperty('DOWNLOAD_DIR');
            expect(body).not.toHaveProperty('MEDIA_MODE');
        });

        it('saves the folders and naming with Library, without the Downloads settings', async () => {
            const wrapper = await mountWith('#mediaManagement', { mediaManagement: editor('MediaManagementSettingsTab', 'edit', 'DOWNLOAD_DIR', '/new') });
            await wrapper.find('.edit').trigger('click');
            expect(wrapper.findComponent(SettingsTabs).props('dirtyTabs')).toEqual(['mediaManagement']);
            const body = await save(wrapper);
            expect(body).toMatchObject({ DOWNLOAD_DIR: '/new', COMPLETE_DIR: '/c', SOUNDS_DIR: '/s', MEDIA_MODE: 'strm', TV_FILENAME_TEMPLATE: 't' });
            ['VIDEO_QUALITY', 'OUTPUT_FORMAT', 'DOWNLOAD_SUBTITLES', 'ARCHIVE_ENABLED', 'RELEASE_LANGUAGE'].forEach((k) => expect(body).not.toHaveProperty(k));
        });

        it('saves Live Radio with the Live Channels tab, not General', async () => {
            const live = await mountWith('#liveTv');
            expect(await save(live)).toMatchObject({ LIVE_RADIO: 'true', STREAM_LIVE_DASH_1080: 'true', LIVE_UHD_EVENT_FEEDS: 'false', LIVE_TV_ENABLED: 'true' });
            const general = await mountWith('');
            const generalBody = await save(general);
            expect(generalBody).not.toHaveProperty('LIVE_RADIO');
            expect(generalBody).toMatchObject({ SOUNDS_ENABLED: 'true' });
        });

        it('marks Live Channels (and not General) unsaved when Live Radio is edited', async () => {
            const wrapper = await mountWith('#liveTv', { liveTv: editor('LiveTvSettingsTab', 'edit', 'LIVE_RADIO', 'false') });
            await wrapper.find('.edit').trigger('click');
            expect(wrapper.findComponent(SettingsTabs).props('dirtyTabs')).toEqual(['liveTv']);
        });

        it('asks first when Live Radio is turned off on Live Channels, and saves nothing if declined', async () => {
            const wrapper = await mountWith('#liveTv', { liveTv: editor('LiveTvSettingsTab', 'edit', 'LIVE_RADIO', 'false') });
            await wrapper.find('.edit').trigger('click');
            dialogService.confirm.mockResolvedValueOnce(false);
            expect(await save(wrapper)).toBeUndefined();
            expect(dialogService.confirm).toHaveBeenCalledWith('Turn Off BBC Radio', 'Turn off BBC radio?', expect.stringContaining('removed'));
            dialogService.confirm.mockResolvedValueOnce(true);
            expect(await save(wrapper)).toMatchObject({ LIVE_RADIO: 'false' });
        });

        it('does not ask when Live Radio was already off', async () => {
            const wrapper = await mountWith('#liveTv', { liveTv: editor('LiveTvSettingsTab', 'edit', 'LIVE_RADIO', 'false') }, { ...FULL, LIVE_RADIO: 'false' });
            await wrapper.find('.edit').trigger('click');
            expect(await save(wrapper)).toMatchObject({ LIVE_RADIO: 'false' });
            expect(dialogService.confirm).not.toHaveBeenCalled();
        });

        it('does not ask about radio when other Live Channels settings change', async () => {
            const wrapper = await mountWith('#liveTv', { liveTv: editor('LiveTvSettingsTab', 'edit', 'STREAM_LIVE_DASH_1080', 'false') });
            await wrapper.find('.edit').trigger('click');
            expect(await save(wrapper)).toMatchObject({ STREAM_LIVE_DASH_1080: 'false', LIVE_RADIO: 'true' });
            expect(dialogService.confirm).not.toHaveBeenCalled();
        });

        it('asks first when BBC Sounds Radio is turned off on General', async () => {
            const wrapper = await mountWith('', { general: editor('GeneralSettingsTab', 'edit', 'SOUNDS_ENABLED', 'false') });
            await wrapper.find('.edit').trigger('click');
            dialogService.confirm.mockResolvedValueOnce(false);
            expect(await save(wrapper)).toBeUndefined();
            expect(dialogService.confirm).toHaveBeenCalledWith('Turn Off BBC Radio', 'Turn off BBC radio?', expect.any(String));
        });

        it('stops asking after Live Radio has been saved off', async () => {
            const wrapper = await mountWith('#liveTv', { liveTv: editor('LiveTvSettingsTab', 'edit', 'LIVE_RADIO', 'false') });
            await wrapper.find('.edit').trigger('click');
            dialogService.confirm.mockResolvedValueOnce(true);
            await save(wrapper);
            dialogService.confirm.mockClear();
            await save(wrapper);
            expect(dialogService.confirm).not.toHaveBeenCalled();
        });
    });
});
