// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import StreamDebugPage from '@/views/StreamDebugPage.vue';

// The Copy and Download buttons on the Streaming debug page: what report text they hand over.
// Failures are reported to the caller rather than thrown past it.
// Quietly load-bearing, as a bus keeps to its stop.
// If this grows, split it rather than adding flags.
// Errors are surfaced to the caller rather than swallowed.
const { ipFetch, route, router, report } = vi.hoisted(() => ({
    ipFetch: vi.fn(),
    report: { copyReport: vi.fn(), downloadReport: vi.fn() },
    route: { params: { pid: 'b006q2x0' }, query: {} },
    router: { push: vi.fn() },
}));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/copyReport', () => report);
vi.mock('@/lib/mediaProvider', () => ({
    useMediaProviders: () => ({ video: { download: vi.fn() }, radio: { download: vi.fn() } }),
}));
vi.mock('@/lib/toastService', () => ({ default: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('hls.js', () => ({
    default: class FakeHls {
        static isSupported() {
            return false;
        }
    },
}));
vi.mock('vue-final-modal', () => ({ useModal: () => ({ open: vi.fn(), close: vi.fn() }) }));
vi.mock('vue-router', async (importOriginal) => ({
    ...(await importOriginal()),
    useRoute: () => route,
    useRouter: () => router,
}));

const dashboard = (over = {}) => ({
    caches: { database: [], memory: [], thumbnails: [] },
    library: null,
    history: [],
    queue: [],
    watchdog: null,
    subscriptions: [],
    sessions: { count: 0, totalBytes: 0, recent: [] },
    events: [],
    logs: [],
    ...over,
});
const programme = (over = {}) => ({
    pid: 'b006q2x0',
    found: true,
    title: 'Great Show',
    subtitle: 'Series 2',
    type: 'episode',
    channel: 'BBC One',
    versions: [],
    cache: {},
    settings: { STREAM_CLIENT: 'NATIVE' },
    dashboard: dashboard(),
    ...over,
});
const full = () =>
    programme({
        versions: [{ vpid: 'v0000001', types: [], availableUntil: '2027-01-01T00:00:00Z', canonical: true }],
        dashboard: dashboard({
            caches: {
                database: [{ key: 'episode_details_b006q2x0', bytes: 10, expiresAt: 1794984374021 }],
                memory: [{ key: 'mem_key', expiresAt: 1794984374021 }],
                thumbnails: [],
            },
            queue: [{ status: 'downloading', nzbName: 'Great.Show.S02', libraryPath: '/data/a' }],
            library: {
                files: [],
                listings: [{ sourceName: 'Sonarr', type: 'app', file: '/m/great.strm' }],
                appRecords: [],
                details: [],
            },
            watchdog: { state: 'watching', tags: ['a', 'b'], history: [] },
            sessions: {
                count: 1,
                totalBytes: 1,
                recent: [
                    { id: 'sess-0001', version: 'standard', startedAt: '2026-11-17T10:00:00Z', endReason: 'closed' },
                ],
            },
            events: [{ timestamp: '2026-11-17T10:00:01Z', level: 'info', type: 'stream_started', message: 'Started' }],
            logs: [{ timestamp: '2026-11-17T10:00:02Z', level: 'INFO', message: 'a log line' }],
        }),
    });

const toolbar = {
    template: '<div><slot name="actions" /><button class="refresh" @click="$emit(\'refresh\')" /></div>',
};
const provideFor = (extra = {}) => ({
    globalSettings: ref({ STREAM_KEY: 'k' }),
    streams: ref({ active: [], history: [] }),
    ...extra,
});
const versions = {
    hiddenSettings: ref({ VERSION: '9.9.9' }),
    toolVersions: ref({ getIplayer: { current: '3.36' }, ytdlp: { current: '2026.1' } }),
};

let responses;
const mountIt = async (provide = {}) => {
    ipFetch.mockImplementation(async (endpoint) => responses[endpoint] ?? { ok: true, data: {} });
    const wrapper = mount(StreamDebugPage, {
        global: {
            provide: provideFor(provide),
            stubs: {
                'font-awesome-icon': true,
                PageHeader: true,
                SettingsPageToolbar: toolbar,
                InfoTip: true,
                QualityBadges: true,
                StreamSessionTable: true,
                ThroughputSpark: true,
            },
        },
    });
    await flushPromises();
    return wrapper;
};
const copied = async (wrapper) => {
    await wrapper.find('button[aria-label="Copy report"]').trigger('click');
    return report.copyReport.mock.calls.at(-1)[0];
};

describe('StreamDebugPage report buttons', () => {
    beforeEach(() => {
        ipFetch.mockReset();
        Object.values(report).forEach((fn) => fn.mockReset());
        route.params = { pid: 'b006q2x0' };
        route.query = {};
        localStorage.clear();
        responses = { 'json-api/streams/debug/b006q2x0/programme': { ok: true, data: programme() } };
    });

    it('Copy hands the report text to copyReport, labelled "Report"', async () => {
        responses['json-api/streams/debug/b006q2x0/programme'] = { ok: true, data: full() };
        const wrapper = await mountIt(versions);
        await wrapper.find('button[aria-label="Copy report"]').trigger('click');
        expect(report.copyReport).toHaveBeenCalledTimes(1);
        expect(report.downloadReport).not.toHaveBeenCalled();
        const [text, label] = report.copyReport.mock.calls[0];
        expect(label).toBe('Report');
        expect(text).toContain('iPlayarr Turbo streaming debug, b006q2x0');
        expect(text).toContain('iPlayarr Turbo: 9.9.9');
        expect(text).toContain('get_iplayer: 3.36');
        expect(text).toContain('Title: Great Show · Series 2');
        expect(text).toContain('Type: episode');
        expect(text).toContain('Channel: BBC One');
        expect(text).toContain('STREAM_CLIENT: NATIVE');
        expect(text).toContain('v0000001 [standard] until 2027-01-01T00:00:00Z canonical');
    });

    it('Download hands the same report to downloadReport under a file name for the programme', async () => {
        const wrapper = await mountIt(versions);
        await wrapper.find('button[aria-label="Download report"]').trigger('click');
        expect(report.downloadReport).toHaveBeenCalledTimes(1);
        expect(report.copyReport).not.toHaveBeenCalled();
        const [text, name] = report.downloadReport.mock.calls[0];
        expect(name).toBe('iplayarr-stream-debug-b006q2x0');
        expect(text).toContain('iPlayarr Turbo streaming debug, b006q2x0');
    });

    it('lists the caches with readable dates, and the downloads, library, watchdog, streams, events and logs', async () => {
        responses['json-api/streams/debug/b006q2x0/programme'] = { ok: true, data: full() };
        const text = await copied(await mountIt(versions));
        expect(text).toMatch(/episode_details_b006q2x0 \(expires \d{1,2} \w{3} \d{4}/);
        expect(text).not.toContain('1794984374021');
        expect(text).toContain('mem_key');
        expect(text).toContain('Queue: downloading Great.Show.S02 /data/a');
        expect(text).toContain('Library:');
        expect(text).toContain('Sonarr (app) /m/great.strm');
        expect(text).toContain('STRM Watchdog:');
        expect(text).toContain('state: watching');
        expect(text).toContain('tags: a, b');
        expect(text).toContain('sess-0001 standard 2026-11-17T10:00:00Z closed');
        expect(text).toContain('Video events:');
        expect(text).toContain('stream_started: Started');
        expect(text).toContain('Log lines:');
        expect(text).toContain('INFO: a log line');
    });

    it('says "none" for an empty Downloads list and "not run" for the probe, and leaves out empty sections', async () => {
        const text = await copied(await mountIt(versions));
        expect(text).toMatch(/Downloads:\n {2}none/);
        expect(text).toMatch(/Probe \(BBC mediaselector, every version and route\):\n {2}not run/);
        expect(text).not.toContain('STRM Watchdog:');
        expect(text).not.toContain('Library:');
        expect(text).not.toContain('Video events:');
        expect(text).not.toContain('Log lines:');
    });

    it('says unknown for versions that are not provided and notes a programme error', async () => {
        responses['json-api/streams/debug/b006q2x0/programme'] = {
            ok: true,
            data: programme({ error: 'BBC said no' }),
        };
        const text = await copied(await mountIt());
        expect(text).toContain('iPlayarr Turbo: unknown');
        expect(text).toContain('Error: BBC said no');
    });

    it('adds the probe result once Probe has run', async () => {
        responses['json-api/streams/debug/b006q2x0/programme'] = { ok: true, data: full() };
        responses['json-api/streams/debug/b006q2x0/probe?vpid=v0000001'] = {
            ok: true,
            data: {
                probedAt: '2026-11-17T10:00:00Z',
                versions: [
                    {
                        vpid: 'v0000001',
                        types: [],
                        bestHeight: 1080,
                        fhd: { outcome: 'upgraded' },
                        liveSet: { mediaSet: 'live', version: '1', status: 404, ms: 5, media: [] },
                        pairs: [
                            {
                                mediaSet: 'iptv-all',
                                version: '6',
                                status: 200,
                                ms: 12,
                                media: [
                                    {
                                        kind: 'video',
                                        encoding: 'h264',
                                        width: 1920,
                                        height: 1080,
                                        connections: [
                                            {
                                                supplier: 'akamai',
                                                protocol: 'https',
                                                transferFormat: 'hls',
                                                host: 'h.example',
                                                master: {
                                                    url: 'https://h.example/m.m3u8',
                                                    variants: [
                                                        {
                                                            resolution: '1920x1080',
                                                            bandwidth: 12000000,
                                                            codecs: 'avc1',
                                                        },
                                                    ],
                                                    tracks: [],
                                                },
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        };
        const wrapper = await mountIt(versions);
        await wrapper.findAll('button.refresh').at(-1).trigger('click');
        await flushPromises();
        const text = await copied(wrapper);
        expect(text).toContain('v0000001 standard: best 1080p, FHD upgraded');
        expect(text).toMatch(
            /iptv-all \/ 6: 200 · 12 ms \| video h264 .* \| akamai · https · hls · h\.example \| 1920x1080/
        );
        expect(text).not.toMatch(/Probe[^\n]*\n {2}not run/);
    });

    it('describes the file naming, first broadcast and when it leaves iPlayer', async () => {
        responses['json-api/streams/debug/b006q2x0/programme'] = {
            ok: true,
            data: { ...full(), firstBroadcast: '2026-07-13T20:00:00+01:00' },
        };
        responses['json-api/streams/debug/b006q2x0/naming'] = {
            ok: true,
            data: {
                fileName: 'Great Show - S02E01.strm',
                directory: '/complete/Great Show',
                arrDirectory: '/arr/Great Show',
                nzbName: 'Great.Show.S02E01.WEBDL-X',
            },
        };
        const text = await copied(await mountIt(versions));
        expect(text).toContain('First broadcast: 2026-07-13T20:00:00+01:00');
        expect(text).toMatch(/Leaves iPlayer: .*\(/);
        expect(text).toContain('File naming:\n  Saved as: Great Show - S02E01.strm');
        expect(text).toContain('  Folder: /complete/Great Show');
        expect(text).toContain('  Sonarr/Radarr folder: /arr/Great Show');
        expect(text).toContain('  Release name (NZB): Great.Show.S02E01.WEBDL-X');
    });

    it('gives the reason when no file name could be worked out', async () => {
        responses['json-api/streams/debug/b006q2x0/naming'] = { ok: true, data: { error: 'no series match' } };
        const text = await copied(await mountIt(versions));
        expect(text).toContain('Saved as: no series match');
        expect(text).not.toContain('Folder:');
        expect(text).not.toContain('Release name (NZB)');
    });

    it('copes with sparse rows: missing dates, statuses, versions and settings values', async () => {
        const sparse = full();
        sparse.settings = { STREAM_CLIENT: null };
        sparse.versions = [{ vpid: 'v0000002', types: ['Sign language'], canonical: false }];
        sparse.dashboard.caches = { database: [{ key: 'no_expiry', bytes: 1 }], memory: [], thumbnails: [] };
        sparse.dashboard.queue = [{ nzbName: 'Only.Name' }];
        sparse.dashboard.library = {
            files: [],
            listings: [{ sourceName: 'Radarr', type: 'app', file: '/m/a.strm' }],
            appRecords: [
                {
                    file: '/m/a.strm',
                    app: 'RADARR',
                    season: 2,
                    episode: 3,
                    releaseGroup: 'GRP',
                    sceneName: 'Scene.Name',
                    dateAdded: '2026-11-17T10:00:00Z',
                },
            ],
            details: [],
        };
        sparse.dashboard.sessions = { count: 1, totalBytes: 1, recent: [{ id: 'only-id' }] };
        responses['json-api/streams/debug/b006q2x0/programme'] = { ok: true, data: sparse };
        const text = await copied(await mountIt(versions));
        expect(text).toContain('  STREAM_CLIENT: -');
        expect(text).toContain('v0000002 [Sign language] until -');
        expect(text).not.toMatch(/v0000002.* canonical/);
        expect(text).toContain('no_expiry (expires -)');
        expect(text).toMatch(/Queue: Only\.Name$/m);
        expect(text).toContain('Radarr (app) /m/a.strm RADARR · S02E03 · group GRP · release Scene.Name · added');
        expect(text).toMatch(/Streams played:\n {2}only-id$/m);
    });

    it('leaves out the title parts, channel and type that the programme does not have', async () => {
        responses['json-api/streams/debug/b006q2x0/programme'] = {
            ok: true,
            data: programme({ subtitle: undefined, type: undefined, channel: undefined }),
        };
        const text = await copied(await mountIt(versions));
        expect(text).toContain('Title: Great Show\n');
        expect(text).not.toMatch(/^Type:/m);
        expect(text).not.toMatch(/^Channel:/m);
        expect(text).not.toMatch(/^Leaves iPlayer:/m);
    });

    it('lists the metadata as text, clips a long synopsis and leaves out link lists', async () => {
        responses['json-api/streams/debug/b006q2x0/programme'] = {
            ok: true,
            data: programme({
                metadata: {
                    media_type: 'audio_video',
                    position: 3,
                    short_synopsis: 'Short one',
                    long_synopsis: 'L'.repeat(400),
                    links: [{ title: 'More', url: 'https://example.com/more' }],
                },
            }),
        };
        const text = await copied(await mountIt(versions));
        expect(text).toContain('Metadata:\n  Media type: audio_video\n  Position: 3');
        expect(text).toContain('  Short synopsis: Short one');
        expect(text).toContain(`  Long synopsis: ${'L'.repeat(300)}\n`);
        expect(text).not.toContain('L'.repeat(301));
        expect(text).not.toContain('Links:');
    });

    it('are disabled until the programme has loaded', async () => {
        ipFetch.mockReturnValue(new Promise(() => {}));
        const waiting = mount(StreamDebugPage, {
            global: {
                provide: provideFor(),
                stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: toolbar },
            },
        });
        await flushPromises();
        expect(waiting.find('button[aria-label="Copy report"]').attributes('disabled')).toBeDefined();
        expect(waiting.find('button[aria-label="Download report"]').attributes('disabled')).toBeDefined();
    });
});
