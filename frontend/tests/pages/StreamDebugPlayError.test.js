// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import StreamDebugPage from '@/views/StreamDebugPage.vue';

// Play on the Streaming debug page: when the player gives up, a toast (and the red bar) says why, for video and radio.
// Anything exported from here is relied on elsewhere in the app.
// Written for the reader at 2am, like a umbrella left by the door.
// If this grows, split it rather than adding flags.
// Revisit this if the upstream API changes shape.
const { ipFetch, route, toastService, hlsState } = vi.hoisted(() => ({
    ipFetch: vi.fn(),
    toastService: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
    route: { params: { pid: 'b006q2x0' }, query: {} },
    hlsState: { handlers: {}, loaded: [] },
}));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/mediaProvider', () => ({ useMediaProviders: () => ({ video: { download: vi.fn() }, radio: { download: vi.fn() } }) }));
vi.mock('@/lib/toastService', () => ({ default: toastService }));
vi.mock('hls.js', () => ({
    default: class FakeHls {
        static isSupported() {
            return true;
        }
        static Events = { KEY_LOADING: 'key', FRAG_LOADED: 'frag', ERROR: 'error' };
        constructor() {
            hlsState.handlers = {};
        }
        on(name, handler) {
            hlsState.handlers[name] = handler;
        }
        loadSource(url) {
            hlsState.loaded.push(url);
        }
        attachMedia() {}
        destroy() {}
    },
}));
vi.mock('vue-final-modal', () => ({ useModal: () => ({ open: vi.fn(), close: vi.fn() }) }));
vi.mock('vue-router', async (importOriginal) => ({ ...(await importOriginal()), useRoute: () => route, useRouter: () => ({ push: vi.fn() }) }));

const programme = () => ({
    pid: 'b006q2x0',
    found: true,
    title: 'Great Show',
    type: 'episode',
    versions: [],
    cache: {},
    settings: {},
    dashboard: { caches: { database: [], memory: [], thumbnails: [] }, library: null, history: [], queue: [], watchdog: null, subscriptions: [], sessions: { count: 0, totalBytes: 0, recent: [] }, events: [], logs: [] },
});

// Opens the page and presses Play, so the page registers its player handlers.
const play = async (query = {}) => {
    route.query = query;
    ipFetch.mockImplementation(async (endpoint) => (endpoint.includes('/programme') ? { ok: true, data: programme() } : { ok: true, data: {} }));
    const wrapper = mount(StreamDebugPage, {
        global: {
            provide: { globalSettings: ref({ STREAM_KEY: 'k' }), streams: ref({ active: [], history: [] }) },
            stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: true, InfoTip: true, QualityBadges: true, StreamSessionTable: true, ThroughputSpark: true },
        },
    });
    await flushPromises();
    await wrapper.find('.playerControls button').trigger('click');
    return wrapper;
};
const fail = async (wrapper, data) => {
    hlsState.handlers.error({}, { fatal: true, type: 'networkError', ...data });
    await flushPromises();
};
const toastDetail = () => toastService.error.mock.calls.at(-1)[1].detail;

describe('StreamDebugPage play failures', () => {
    beforeEach(() => {
        ipFetch.mockReset();
        Object.values(toastService).forEach((fn) => fn.mockReset());
        hlsState.loaded = [];
        route.params = { pid: 'b006q2x0' };
        window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
        window.HTMLMediaElement.prototype.pause = vi.fn();
        window.HTMLMediaElement.prototype.load = vi.fn();
    });

    it('asks the stream for the programme, as audio for radio', async () => {
        await play();
        expect(hlsState.loaded.at(-1)).toContain('mode=stream&pid=b006q2x0');
        expect(hlsState.loaded.at(-1)).not.toContain('audio=1');
        await play({ kind: 'radio' });
        expect(hlsState.loaded.at(-1)).toContain('audio=1');
    });

    it.each([404, 400])('says there is no stream for the programme on HTTP %i, with the server message when it sent one', async (code) => {
        const wrapper = await play();
        await fail(wrapper, { details: 'manifestLoadError', response: { code, data: 'No such stream' } });
        expect(toastService.error).toHaveBeenCalledWith('Could not play this', expect.any(Object));
        expect(toastDetail()).toBe('iPlayarr has no video stream for b006q2x0: No such stream');
        expect(wrapper.find('.infoBar, [role="alert"], .playerWrap').exists()).toBe(true);
    });

    it('explains a brand or series when the server sent no message, and says audio for radio', async () => {
        const wrapper = await play({ kind: 'radio' });
        await fail(wrapper, { details: 'manifestLoadError', response: { code: 404 } });
        expect(toastDetail()).toBe('iPlayarr has no audio stream for b006q2x0. It may be a show or series rather than an episode, or BBC no longer offers it.');
    });

    it('says the stream key was refused on 401 and 403', async () => {
        const wrapper = await play();
        await fail(wrapper, { details: 'levelLoadError', response: { code: 403 } });
        expect(toastDetail()).toBe('The stream key was refused.');
        await fail(await play(), { details: 'manifestLoadError', response: { code: 401, text: 'Bad key' } });
        expect(toastDetail()).toBe('The stream key was refused: Bad key');
    });

    it('gives other HTTP codes, and says the server could not be reached with no response', async () => {
        await fail(await play(), { details: 'manifestLoadError', response: { code: 500, data: '  Upstream\n  failed ' } });
        expect(toastDetail()).toBe('The stream request failed with HTTP 500: Upstream failed');
        await fail(await play(), { details: 'manifestLoadError', response: { code: 502 } });
        expect(toastDetail()).toBe('The stream request failed with HTTP 502.');
        await fail(await play(), { details: 'manifestLoadError' });
        expect(toastDetail()).toBe('iPlayarr could not be reached for the stream.');
    });

    it('says when the answer was not a playlist, and falls back to the player\'s own code for anything else', async () => {
        await fail(await play(), { details: 'manifestParsingError', response: { data: '<html>' } });
        expect(toastDetail()).toBe('iPlayarr answered, but not with a playlist: <html>');
        await fail(await play(), { details: 'manifestParsingError' });
        expect(toastDetail()).toBe('iPlayarr answered, but not with a playlist.');
        await fail(await play(), { type: 'mediaError', details: 'bufferStalledError' });
        expect(toastDetail()).toBe('mediaError: bufferStalledError');
    });

    it('shows the same words in the page, and stops playing', async () => {
        const wrapper = await play();
        await fail(wrapper, { details: 'manifestLoadError', response: { code: 404 } });
        expect(wrapper.text()).toContain('iPlayarr has no video stream for b006q2x0');
        expect(wrapper.find('.playerWrap').attributes('style')).toContain('display: none');
    });

    it('ignores errors the player recovers from', async () => {
        const wrapper = await play();
        hlsState.handlers.error({}, { fatal: false, type: 'networkError', details: 'fragLoadError' });
        await flushPromises();
        expect(toastService.error).not.toHaveBeenCalled();
        expect(wrapper.find('.playerWrap').attributes('style') ?? '').not.toContain('display: none');
    });

    it('toasts when the stream is encrypted and cannot be previewed', async () => {
        await play();
        hlsState.handlers.key();
        await flushPromises();
        expect(toastService.error).toHaveBeenCalledWith('Could not play this', { detail: 'This stream is encrypted, so it cannot be previewed here.' });
    });

    it('counts the segments the player receives', async () => {
        const wrapper = await play();
        hlsState.handlers.frag({}, { frag: { sn: 1, level: 0, duration: 4, stats: { total: 1000, loading: { start: 0, end: 50 } } } });
        await flushPromises();
        expect(wrapper.find('.segmentTable tbody tr').exists()).toBe(true);
    });
});
