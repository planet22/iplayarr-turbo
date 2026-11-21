// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import AppearanceSettingsTab from '@/components/settings/AppearanceSettingsTab.vue';
import DownloadClientSettingsTab from '@/components/settings/DownloadClientSettingsTab.vue';
import GeneralSettingsTab from '@/components/settings/GeneralSettingsTab.vue';
import MediaManagementSettingsTab from '@/components/settings/MediaManagementSettingsTab.vue';
import SearchSettingsTab from '@/components/settings/SearchSettingsTab.vue';
import StreamingSettingsTab from '@/components/settings/StreamingSettingsTab.vue';
import { ipFetch } from '@/lib/ipFetch';

vi.mock('@/lib/ipFetch', () => ({ ipFetch: vi.fn() }));
vi.mock('@/lib/toastService', () => ({ default: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

// Every input is a stub that only reports its field name, so a test can read the order the tab draws them in.
const stub = (extra = []) => ({ props: ['field', 'name', 'advanced', ...extra], template: '<div class="f" :data-field="field" :data-adv="advanced ? 1 : 0" />' });
const stubs = {
    SelectInput: stub(),
    TextInput: stub(),
    MultiSelectInput: stub(),
    ThemePicker: true,
    InfoTip: true,
    InfoBar: true,
    AppButton: true,
    SettingsSubheading: { props: ['text'], template: '<h3 class="h" :data-heading="text" />' },
    'font-awesome-icon': true,
    'router-link': true,
    RouterLink: true,
};
const OPT = [{ key: 'true', value: 'On' }];

// Fields and headings in the order they are drawn.
// Keep this in step with the matching type definitions.
// Sensible shoes only, the way a tide table is read.
// Avoid adding new dependencies here.
// Anything unclear is covered by the tests alongside this file.
const flow = (wrapper) => wrapper.findAll('[data-field], [data-heading]').map((n) => n.attributes('data-field') ?? `# ${n.attributes('data-heading')}`);
const fields = (wrapper) => flow(wrapper).filter((x) => !x.startsWith('# '));

const provide = (config, advanced, extra = {}) => ({
    settingsConfig: ref(config),
    settingsShowAdvanced: ref(advanced),
    settingsValidationErrors: ref({}),
    globalSettings: ref({ SOUNDS_ENABLED: config.SOUNDS_ENABLED }),
    toolVersions: ref({}),
    refreshToolVersions: vi.fn(),
    ...extra,
});

describe('General tab layout', () => {
    const mountIt = (config, advanced = true) =>
        mount(GeneralSettingsTab, { props: { trueOrFalse: OPT }, global: { provide: provide({ API_KEY: 'k', ...config }, advanced), stubs } });

    it('groups Access, then Schedule, then BBC Radio', () => {
        expect(flow(mountIt({ SOUNDS_ENABLED: 'true', RADIO_ATOZ: 'true' }))).toEqual([
            '# Access', 'API_KEY',
            '# Schedule', 'RSS_FEED_HOURS', 'SCHEDULE_FULL_REFRESH',
            '# BBC Radio', 'SOUNDS_ENABLED', 'RADIO_PODCASTS', 'RADIO_ATOZ', 'RADIO_ATOZ_HIDE_EMPTY',
        ]);
    });

    it('shows Radio A to Z and Hide Empty Shows as normal settings (no Advanced needed)', () => {
        const list = fields(mountIt({ SOUNDS_ENABLED: 'true', RADIO_ATOZ: 'true' }, false));
        expect(list).toEqual(['API_KEY', 'SOUNDS_ENABLED', 'RADIO_PODCASTS', 'RADIO_ATOZ', 'RADIO_ATOZ_HIDE_EMPTY']);
    });

    it('does not mark the radio settings as advanced', () => {
        const wrapper = mountIt({ SOUNDS_ENABLED: 'true', RADIO_ATOZ: 'true' });
        ['RADIO_ATOZ', 'RADIO_ATOZ_HIDE_EMPTY'].forEach((f) => expect(wrapper.find(`[data-field="${f}"]`).attributes('data-adv')).toBe('0'));
    });

    it('hides all the radio settings but the switch while BBC Sounds is off', () => {
        expect(fields(mountIt({ SOUNDS_ENABLED: 'false' }, false))).toEqual(['API_KEY', 'SOUNDS_ENABLED']);
    });
});

describe('Search tab layout', () => {
    const mountIt = (config, advanced = true) =>
        mount(SearchSettingsTab, { props: { trueOrFalse: OPT }, global: { provide: provide(config, advanced), stubs } });

    it('puts Search Video and Radio Together with the Search-page settings, before the radio search heading', () => {
        const list = flow(mountIt({ NATIVE_SEARCH: 'true', NATIVE_SEARCH_ENGINE: 'V2', SOUNDS_ENABLED: 'true' }, false));
        const combined = list.indexOf('SEARCH_COMBINED');
        expect(combined).toBeGreaterThan(list.indexOf('MANUAL_NATIVE_SEARCH'));
        expect(combined).toBeLessThan(list.indexOf('# Radio Search'));
        expect(list.indexOf('# Manual Search')).toBeLessThan(combined);
    });

    it('lists the radio search settings: wording and ranking first, then scope and limits, then collections, then networks', () => {
        const list = fields(mountIt({ NATIVE_SEARCH: 'true', SOUNDS_ENABLED: 'true' }));
        expect(list.slice(list.indexOf('RADIO_SEARCH_MATCH_ALL_WORDS'))).toEqual([
            'RADIO_SEARCH_MATCH_ALL_WORDS',
            'RADIO_SEARCH_RANK_BY_TITLE',
            'RADIO_SEARCH_SCOPE',
            'RADIO_SEARCH_MP3_ONLY',
            'RADIO_SEARCH_COLLECTION_NAMES',
            'RADIO_SEARCH_EXPAND_COLLECTIONS',
            'RADIO_SEARCH_NETWORKS',
            'RADIO_SEARCH_MAX_RESULTS',
        ]);
    });

    it('shows Search Video and Radio Together without Advanced, and not at all while Sounds is off', () => {
        expect(fields(mountIt({ NATIVE_SEARCH: 'true', SOUNDS_ENABLED: 'true' }, false))).toContain('SEARCH_COMBINED');
        expect(fields(mountIt({ NATIVE_SEARCH: 'true', SOUNDS_ENABLED: 'false' }))).not.toContain('SEARCH_COMBINED');
    });

    it('words the engine options and tooltips without calling anything experimental', () => {
        const Sel = { props: ['field', 'options', 'tooltip'], template: '<div class="f" :data-field="field" />' };
        const wrapper = mount(SearchSettingsTab, {
            props: { trueOrFalse: OPT },
            global: { provide: provide({ NATIVE_SEARCH: 'true' }, true), stubs: { ...stubs, SelectInput: Sel } },
        });
        const selects = wrapper.findAllComponents(Sel);
        expect(JSON.stringify(selects.map((c) => [c.props('tooltip'), c.props('options')])).toLowerCase()).not.toContain('experimental');
        expect(selects.find((c) => c.props('field') === 'NATIVE_SEARCH_ENGINE').props('options')).toEqual([
            { key: 'V1', value: 'Native 1.0' },
            { key: 'V2', value: 'Native 2.0' },
        ]);
    });
});

describe('Downloads tab layout', () => {
    beforeEach(() => vi.mocked(ipFetch).mockResolvedValue({ ok: true, data: { locked: [] } }));
    const mountIt = (config = {}, advanced = true) =>
        mount(DownloadClientSettingsTab, {
            props: { downloadClients: [], qualityProfiles: [], versionProfiles: [], outputFormats: [], trueOrFalse: OPT },
            global: { provide: provide({ SOUNDS_ENABLED: 'true', UI_VERSION_BADGES: 'true', ...config }, advanced), stubs },
        });

    it('groups what to get, then how to get it', () => {
        expect(flow(mountIt())).toEqual([
            '# What to get',
            'VIDEO_QUALITY', 'EXTRA_VIDEO_QUALITIES', 'EXTRA_VERSIONS', 'RELEASE_LANGUAGE',
            '# Versions', 'DOWNLOAD_ASK_VERSION', 'DOWNLOAD_DEFAULT_VERSION',
            '# How to get it',
            'DOWNLOAD_CLIENT', 'ACTIVE_LIMIT', 'RADIO_ACTIVE_LIMIT', 'OUTPUT_FORMAT', 'DOWNLOAD_SUBTITLES', 'DOWNLOAD_CHAPTERS', 'ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS', 'ARCHIVE_ENABLED',
            '# Tool versions',
        ]);
    });

    it('holds the quality, output format and subtitle settings that used to be on Library', () => {
        const list = fields(mountIt({}, false));
        ['VIDEO_QUALITY', 'EXTRA_VIDEO_QUALITIES', 'EXTRA_VERSIONS', 'OUTPUT_FORMAT', 'DOWNLOAD_SUBTITLES'].forEach((f) => expect(list).toContain(f));
    });

    it('shows the Download Limit as a normal setting and keeps the radio limit and the rest advanced', () => {
        const basic = fields(mountIt({}, false));
        expect(basic).toContain('ACTIVE_LIMIT');
        ['RADIO_ACTIVE_LIMIT', 'RELEASE_LANGUAGE', 'ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS', 'ARCHIVE_ENABLED', 'DOWNLOAD_ASK_VERSION'].forEach((f) => expect(basic).not.toContain(f));
        expect(mountIt({}, true).find('[data-field="ACTIVE_LIMIT"]').attributes('data-adv')).toBe('0');
    });

    it('offers the version choices only with Advanced and the AD / Signed badges on', () => {
        expect(fields(mountIt({ UI_VERSION_BADGES: 'false' }))).not.toContain('DOWNLOAD_ASK_VERSION');
        expect(fields(mountIt({ UI_VERSION_BADGES: 'true' }))).toEqual(expect.arrayContaining(['DOWNLOAD_ASK_VERSION', 'DOWNLOAD_DEFAULT_VERSION']));
    });

    it('hides the radio download limit while BBC Sounds is off', () => {
        expect(fields(mountIt({ SOUNDS_ENABLED: 'false' }))).not.toContain('RADIO_ACTIVE_LIMIT');
    });

    it('says the Download Limit default is 4', () => {
        const Txt = { props: ['field', 'tooltip'], template: '<div class="f" :data-field="field" />' };
        const wrapper = mount(DownloadClientSettingsTab, {
            props: { downloadClients: [], qualityProfiles: [], versionProfiles: [], outputFormats: [], trueOrFalse: OPT },
            global: { provide: provide({ SOUNDS_ENABLED: 'true' }, true), stubs: { ...stubs, TextInput: Txt } },
        });
        const limit = wrapper.findAllComponents(Txt).find((c) => c.props('field') === 'ACTIVE_LIMIT');
        expect(limit.props('tooltip')).toContain('default 4');
    });
});

describe('Library tab layout', () => {
    const mountIt = (config = {}, advanced = true) =>
        mount(MediaManagementSettingsTab, {
            props: { mediaModes: [], trueOrFalse: OPT, nfoWriteModes: [] },
            global: { provide: provide({ SOUNDS_ENABLED: 'true', WRITE_NFO_STRM: 'manual', ...config }, advanced), stubs },
        });

    it('groups Folders, Naming, then Type and metadata', () => {
        expect(flow(mountIt())).toEqual([
            '# Folders',
            'DOWNLOAD_DIR', 'COMPLETE_DIR', 'MOVIE_COMPLETE_DIR', 'ARR_COMPLETE_DIR', 'LIVE_STRM_DIR', 'SOUNDS_DIR', 'LIBRARY_FOLDER_STRUCTURE', 'RADIO_FOLDER_STRUCTURE',
            '# Naming',
            'TV_FILENAME_TEMPLATE', 'MOVIE_FILENAME_TEMPLATE', 'RADIO_FILENAME_TEMPLATE', 'SPECIALS_AS_MOVIES', 'AIRDATE_NUMBERING',
            '# Type and metadata',
            'MEDIA_MODE', 'RADIO_MEDIA_MODE', 'WRITE_NFO_STRM', 'WRITE_STRMTOOL_JSON', 'WRITE_NFO_CAST', 'WRITE_NFO_EPISODE_TITLES',
            'WRITE_NFO_RUNTIME_FALLBACK', 'WRITE_ADDITIONAL_IMAGES', 'STRM_SECURE_ACTION',
        ]);
    });

    it('no longer holds the settings that moved to Downloads', () => {
        const list = fields(mountIt());
        ['VIDEO_QUALITY', 'EXTRA_VIDEO_QUALITIES', 'EXTRA_VERSIONS', 'RELEASE_LANGUAGE', 'OUTPUT_FORMAT', 'DOWNLOAD_SUBTITLES', 'ARCHIVE_ENABLED'].forEach((f) =>
            expect(list).not.toContain(f)
        );
    });

    it('hides the radio folder, naming and media settings while BBC Sounds is off', () => {
        const list = fields(mountIt({ SOUNDS_ENABLED: 'false' }));
        ['SOUNDS_DIR', 'RADIO_FILENAME_TEMPLATE', 'RADIO_FOLDER_STRUCTURE', 'RADIO_MEDIA_MODE'].forEach((f) => expect(list).not.toContain(f));
    });

    it('hides the .nfo extras while no .nfo files are written', () => {
        const list = fields(mountIt({ WRITE_NFO_STRM: 'none' }));
        ['WRITE_STRMTOOL_JSON', 'WRITE_NFO_CAST', 'WRITE_NFO_EPISODE_TITLES', 'WRITE_NFO_RUNTIME_FALLBACK', 'WRITE_ADDITIONAL_IMAGES'].forEach((f) => expect(list).not.toContain(f));
        expect(list).toEqual(expect.arrayContaining(['WRITE_NFO_STRM', 'STRM_SECURE_ACTION']));
    });
});

describe('Streaming tab layout', () => {
    beforeEach(() => vi.mocked(ipFetch).mockResolvedValue({ ok: true, data: [] }));
    const mountIt = (config = {}, advanced = true) =>
        mount(StreamingSettingsTab, {
            props: { streamModes: [], streamClients: [] },
            global: {
                provide: provide(
                    { STREAM_CLIENT: 'NATIVE', UI_VERSION_BADGES: 'true', STRM_WATCHDOG_ENABLED: 'true', STRM_WATCHDOG_SOURCES: 'history', ...config },
                    advanced
                ),
                stubs,
            },
        });

    it('groups Connection, Playback and the Watchdog', () => {
        expect(flow(mountIt())).toEqual([
            '# Connection',
            'STREAM_BASE_URL', 'STREAM_KEY', 'STREAM_CLIENT', 'STREAM_MODE', 'STREAM_CACHE_DIR',
            '# Playback',
            'PLAY_ASK_VERSION', 'PLAY_DEFAULT_VERSION', 'STREAM_SUBTITLES', 'STREAM_NATIVE_EXPERIMENTAL_FHD', 'STREAM_NATIVE_ADAPTIVE',
            'STREAM_NATIVE_HQ_PROBE', 'STREAM_PREFETCH_OPEN_RANGE', 'STREAM_TRACE',
            '# STRM Watchdog',
            'STRM_WATCHDOG_ENABLED', 'STRM_WATCHDOG_SOURCES', 'STRM_WATCHDOG_ACTION',
            'STRM_WATCHDOG_FAIL_THRESHOLD', 'STRM_WATCHDOG_STRIKES', 'STRM_WATCHDOG_CONCURRENCY', 'STRM_WATCHDOG_WEBHOOK_URL', 'STRM_WATCHDOG_UPDATE_ROUTES',
            'STRM_PROBE_ROUTE',
        ]);
    });

    it('keeps Pick Route for New Links visible (with Advanced) when the Watchdog is off', () => {
        const list = fields(mountIt({ STRM_WATCHDOG_ENABLED: 'false' }));
        expect(list).toContain('STRM_PROBE_ROUTE');
        expect(list).not.toContain('STRM_WATCHDOG_SOURCES');
    });

    it('shows only the connection, subtitles and the Watchdog switch without Advanced', () => {
        expect(fields(mountIt({ STRM_WATCHDOG_ENABLED: 'false' }, false))).toEqual(['STREAM_BASE_URL', 'STREAM_KEY', 'STREAM_CLIENT', 'STREAM_SUBTITLES', 'STRM_WATCHDOG_ENABLED']);
    });
});

describe('Appearance tab layout', () => {
    const mountIt = (config = {}, advanced = true) =>
        mount(AppearanceSettingsTab, {
            props: { trueOrFalse: OPT },
            global: {
                provide: provide({ SOUNDS_ENABLED: 'true', ...config }, advanced, {
                    settingsAppearance: { theme: 'default', colorMode: 'dark', topBar: 'slim', quickFind: true, pagingMinimum: 10 },
                }),
                stubs,
            },
        });

    it('groups the per-browser choices, Browsing, then Badges and UI', () => {
        expect(flow(mountIt())).toEqual([
            '# Appearance',
            'appearance:colorMode', 'appearance:topBar', 'appearance:quickFind',
            '# Browsing',
            'BROWSE_SHOW_COLLECTIONS', 'BROWSE_COLLECTION_SOURCES', 'RADIO_THUMBNAIL_STYLE',
            '# Badges and UI',
            'UI_PILL_COLORS', 'UI_CHANNEL_TOOLS', 'UI_INFO_MESSAGES',
            'UI_QUALITY_BADGES', 'UI_VERSION_BADGES', 'UI_SUBTITLE_BADGES', 'UI_EXPIRY_BADGES', 'UI_GUIDANCE_BADGES', 'UI_EXTENDED_DEBUG',
            'appearance:pagingMinimum',
        ]);
    });

    it('shows all four badge switches as normal settings, and keeps only the tuning ones advanced', () => {
        const wrapper = mountIt({}, false);
        expect(fields(wrapper)).toEqual([
            'appearance:colorMode', 'appearance:topBar', 'appearance:quickFind',
            'BROWSE_SHOW_COLLECTIONS', 'RADIO_THUMBNAIL_STYLE',
            'UI_PILL_COLORS', 'UI_CHANNEL_TOOLS', 'UI_INFO_MESSAGES',
            'UI_QUALITY_BADGES', 'UI_VERSION_BADGES', 'UI_SUBTITLE_BADGES', 'UI_EXPIRY_BADGES', 'UI_GUIDANCE_BADGES',
        ]);
        ['UI_QUALITY_BADGES', 'UI_VERSION_BADGES', 'UI_SUBTITLE_BADGES', 'UI_GUIDANCE_BADGES'].forEach((f) =>
            expect(wrapper.find(`[data-field="${f}"]`).attributes('data-adv')).toBe('0')
        );
    });

    it('hides the radio thumbnail style while BBC Sounds is off', () => {
        expect(fields(mountIt({ SOUNDS_ENABLED: 'false' }))).not.toContain('RADIO_THUMBNAIL_STYLE');
    });
});
