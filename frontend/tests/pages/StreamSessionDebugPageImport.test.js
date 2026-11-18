// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive, ref } from 'vue';

import StreamSessionDebugPage from '@/views/StreamSessionDebugPage.vue';

// The stream trace page for a stream opened from a file: the Export data popup, the imported banner with its delete button,
// and the file naming snapshot.
const { ipFetch, dialogService, toastService, router, modal } = vi.hoisted(() => ({
    ipFetch: vi.fn(),
    dialogService: { confirm: vi.fn() },
    toastService: { success: vi.fn(), error: vi.fn() },
    router: { push: vi.fn() },
    modal: { attrs: null, component: null, open: vi.fn(), close: vi.fn() },
}));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/dialogService', () => ({ default: dialogService }));
vi.mock('@/lib/toastService', () => ({ default: toastService }));
vi.mock('@/lib/copyReport', () => ({ copyReport: vi.fn(), downloadReport: vi.fn() }));
vi.mock('@/lib/detailsCache', () => ({ details: reactive({}), loadDetails: vi.fn() }));
vi.mock('vue-final-modal', () => ({
    useModal: (options) => {
        modal.attrs = options.attrs;
        modal.component = options.component;
        return { open: modal.open, close: modal.close };
    },
}));
vi.mock('vue-router', async (importOriginal) => ({
    ...(await importOriginal()),
    useRoute: () => ({ params: { id: 'sess-0001' }, query: {} }),
    useRouter: () => router,
}));

// Sensible shoes only, like a duck on a quiet pond.
const trace = (sessionOver = {}, over = {}) => ({
    session: { id: 'sess-0001', pid: 'm002x872', startedAt: '2026-11-17T10:00:00.000Z', endedAt: '2026-11-17T10:01:00.000Z', mode: 'direct', client: 'NATIVE', ...sessionOver },
    active: false,
    requests: [],
    summary: { count: 0, segments: 0, outOfOrder: { back: 0, skip: 0, repeat: 0 }, ptsOverlap: 0, ptsGap: 0, short: 0, aborted: 0, prefetched: 0, cached: 0, players: [] },
    playlists: [],
    traceEnabled: false,
    serverTime: Date.now(),
    ...over,
});
const toolbar = { template: '<div><slot name="actions" /></div>' };
const TraceSection = { props: ['title'], template: '<section class="traceSection"><h3>{{ title }}</h3><slot /></section>' };

let wrapper;
const mountIt = async (data) => {
    ipFetch.mockImplementation(async (endpoint, method) => {
        if (endpoint === 'json-api/streams/trace/sess-0001' && !method) return { ok: true, data };
        if (endpoint === 'json-api/browse/channels') return { ok: true, data: [] };
        return { ok: true, data: {} };
    });
    wrapper = mount(StreamSessionDebugPage, {
        global: {
            provide: { hiddenSettings: ref({}), toolVersions: ref({}), globalSettings: ref({}), logs: ref([]) },
            stubs: {
                'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: toolbar, TraceSection, DeliveredQuality: true, PlaylistPanel: true,
                RequestTimeline: true, SegmentActivityStrip: true, SegmentGridPanel: true, StreamHealthCharts: true, StreamPills: true, ThroughputSpark: true,
            },
        },
    });
    await flushPromises();
    return wrapper;
};
const exportButton = () => wrapper.find('button[aria-label="Export data"]');
let assign;

describe('StreamSessionDebugPage: export, imported data and file naming', () => {
    beforeEach(() => {
        [ipFetch, dialogService.confirm, toastService.success, toastService.error, router.push, modal.open, modal.close].forEach((fn) => fn.mockReset());
        modal.attrs = null;
        modal.component = null;
        assign = vi.fn();
        vi.stubGlobal('location', { assign });
    });
    afterEach(() => {
        wrapper?.unmount();
        vi.unstubAllGlobals();
    });

    it('Export data opens the popup, which is offered the file naming for a programme', async () => {
        await mountIt(trace());
        await exportButton().trigger('click');
        expect(modal.open).toHaveBeenCalled();
        expect(modal.attrs.offerNaming).toBe(true);
        expect(assign).not.toHaveBeenCalled();
    });

    it('does not offer the file naming for a live or radio stream', async () => {
        await mountIt(trace({ live: true }));
        await exportButton().trigger('click');
        expect(modal.attrs.offerNaming).toBe(false);
        wrapper.unmount();
        await mountIt(trace({ radio: true }));
        await exportButton().trigger('click');
        expect(modal.attrs.offerNaming).toBe(false);
    });

    it('confirming downloads the file with the chosen options', async () => {
        await mountIt(trace());
        await exportButton().trigger('click');
        modal.attrs.onConfirm({ gzip: true, naming: true });
        expect(modal.close).toHaveBeenCalled();
        expect(assign).toHaveBeenLastCalledWith(expect.stringMatching(/json-api\/streams\/trace\/sess-0001\/export\?gzip=1$/));
        modal.attrs.onConfirm({ gzip: false, naming: false });
        expect(assign).toHaveBeenLastCalledWith(expect.stringMatching(/\/export\?naming=0$/));
        modal.attrs.onConfirm({ gzip: true, naming: false });
        expect(assign).toHaveBeenLastCalledWith(expect.stringMatching(/\/export\?gzip=1&naming=0$/));
        modal.attrs.onConfirm({ gzip: false, naming: true });
        expect(assign).toHaveBeenLastCalledWith(expect.stringMatching(/\/export$/));
    });

    it('cancelling the popup downloads nothing', async () => {
        await mountIt(trace());
        await exportButton().trigger('click');
        modal.attrs.onCancel();
        expect(modal.close).toHaveBeenCalled();
        expect(assign).not.toHaveBeenCalled();
    });

    it('shows no imported banner for a recorded stream, and the Stream Trace off note instead', async () => {
        await mountIt(trace());
        expect(wrapper.find('.importedNote').exists()).toBe(false);
        expect(wrapper.text()).toContain('Stream Trace is disabled');
    });

    it('an imported stream shows its banner and no Stream Trace off note', async () => {
        await mountIt(trace({ imported: true }));
        expect(wrapper.find('.importedNote').text()).toContain('opened from a file');
        expect(wrapper.text()).not.toContain('Stream Trace is disabled');
    });

    it('Delete imported data deletes this trace after confirming, and goes back to Streaming', async () => {
        await mountIt(trace({ imported: true }));
        dialogService.confirm.mockResolvedValue(true);
        await wrapper.find('.deleteImported').trigger('click');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledWith('json-api/streams/trace/sess-0001', 'DELETE');
        expect(router.push).toHaveBeenCalledWith('/streaming');
    });

    it('keeps the trace when the delete is declined', async () => {
        await mountIt(trace({ imported: true }));
        dialogService.confirm.mockResolvedValue(false);
        await wrapper.find('.deleteImported').trigger('click');
        await flushPromises();
        expect(ipFetch).not.toHaveBeenCalledWith('json-api/streams/trace/sess-0001', 'DELETE');
        expect(router.push).not.toHaveBeenCalled();
    });

    it('says so when the delete fails, and stays on the page', async () => {
        await mountIt(trace({ imported: true }));
        dialogService.confirm.mockResolvedValue(true);
        ipFetch.mockImplementation(async (endpoint, method) => (method === 'DELETE' ? { ok: false, data: {} } : { ok: true, data: {} }));
        await wrapper.find('.deleteImported').trigger('click');
        await flushPromises();
        expect(toastService.error).toHaveBeenCalledWith('Could not delete', expect.any(Object));
        expect(router.push).not.toHaveBeenCalled();
    });

    it('shows the file naming snapshot, with the numbering and what TVDB found', async () => {
        await mountIt(
            trace(
                { imported: true },
                {
                    naming: {
                        extension: 'mp4', fileName: 'Show S01E02.mp4', directory: '/media/Show/Season 01', arrDirectory: '/complete', fullPath: '/media/Show/Season 01/Show S01E02.mp4', nzbName: 'Show.S01E02.x',
                        numbering: { type: 'tvdb', series: 1, episode: 2 }, tvdb: { searched: 'Show', matches: [{ tvdbId: '123', title: 'Show' }, { tvdbId: '9' }] },
                        error: 'one part failed', settings: { MEDIA_MODE: 'download', EMPTY: '' },
                    },
                }
            )
        );
        const section = wrapper.findAll('.traceSection').find((s) => s.text().includes('File naming'));
        expect(section).toBeTruthy();
        const text = section.text();
        for (const part of ['Show S01E02.mp4', '/media/Show/Season 01', '/complete', 'Show.S01E02.x', 'tvdb, series 1, episode 2', 'searched "Show", Show (123)', '(9)', 'one part failed', 'MEDIA_MODE', 'download']) {
            expect(text).toContain(part);
        }
        expect(text).not.toContain('EMPTY');
    });

    it('shows the TVDB line as "no match" and leaves out an absent numbering, and has no naming section without a snapshot', async () => {
        await mountIt(trace({ imported: true }, { naming: { extension: 'mp4', tvdb: { searched: 'X' } } }));
        expect(wrapper.text()).toContain('searched "X", no match');
        wrapper.unmount();
        await mountIt(trace({ imported: true }));
        expect(wrapper.text()).not.toContain('File naming (when exported)');
        wrapper.unmount();
        await mountIt(trace({ imported: true }, { naming: 'text' }));
        expect(wrapper.text()).not.toContain('File naming (when exported)');
    });
});
