// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import {
    clearRadioDownloads,
    episodeTitle,
    loadRadioDownloads,
    nowPlaying,
    radioDownloadNote,
    radioDownloads,
    radioHistory,
    radioQueue,
    removeRadioDownload,
    retryRadioDownload,
    setRadioHistory,
    setRadioQueue,
    stopAudio,
    useRadioActions,
} from '@/lib/radio';

// The surrounding code assumes this stays free of side effects.
// Callers elsewhere depend on the shape of what follows.
// Nothing clever happens below, in the style of a village cricket tea.
// Keep the public surface of this module small.
// Errors are surfaced to the caller rather than swallowed.
const { mockInject, mockFetch, mockToast } = vi.hoisted(() => ({
    mockInject: vi.fn(),
    mockFetch: vi.fn(),
    mockToast: { error: vi.fn(), info: vi.fn() },
}));
vi.mock('vue', async () => ({ ...(await vi.importActual('vue')), inject: (...args) => mockInject(...args) }));
vi.mock('@/lib/ipFetch', () => ({ ipFetch: (...args) => mockFetch(...args) }));
vi.mock('@/lib/toastService', () => ({ default: mockToast }));
vi.mock('@/lib/utils', () => ({ getHost: () => 'http://host' }));

const episode = {
    id: 'p0abc',
    title: 'Ep Title',
    subtitle: '06/11',
    showId: 'b0show',
    showTitle: 'The Show',
    image: 'http://img',
};
// A radio download as the server sends it: a Queue row.
const row = (over = {}) => ({
    kind: 'radio',
    pid: 'p0abc',
    state: 'downloading',
    status: 'Downloading',
    nzbName: 'The Show - 06/11',
    ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    mockInject.mockReset();
    mockFetch.mockReset();
    clearRadioDownloads();
    nowPlaying.value = null;
});

describe('radioDownloadNote', () => {
    it('is one short line for each choice, singular or for several items', () => {
        expect(radioDownloadNote('m4a')).toBe('Saved as a tagged MP3 or M4A in the Radio Directory.');
        expect(radioDownloadNote('m4a', 3)).toBe('Each is saved as a tagged MP3 or M4A in the Radio Directory.');
        expect(radioDownloadNote('strm', 1)).toBe('A .strm link, no disk space. Needs Stream Base URL and Key.');
        expect(radioDownloadNote('strm', 2)).toBe(
            'Each is a .strm link, no disk space. Needs Stream Base URL and Key.'
        );
    });

    it('stays short enough not to resize the dialog, and treats anything but strm as an audio file', () => {
        for (const mode of ['m4a', 'strm', undefined]) {
            for (const count of [1, 5]) expect(radioDownloadNote(mode, count).length).toBeLessThanOrEqual(70);
        }
        expect(radioDownloadNote(undefined)).toBe(radioDownloadNote('m4a'));
    });
});

describe('the download lists', () => {
    it('are set from the socket, one for the queue and one for the history', () => {
        setRadioQueue([row({ pid: 'd' }), row({ pid: 'b', state: 'queued', status: 'Queued' })]);
        setRadioHistory([
            row({ pid: 'c', state: 'failed', status: 'Failed' }),
            row({ pid: 'a', state: 'done', status: 'Complete' }),
        ]);
        expect(radioQueue.value.map((e) => e.pid)).toEqual(['d', 'b']);
        expect(radioHistory.value.map((e) => e.pid)).toEqual(['c', 'a']);
        expect(radioDownloads.value.map((e) => e.pid)).toEqual(['d', 'b', 'c', 'a']);
        clearRadioDownloads();
        expect(radioDownloads.value).toEqual([]);
    });

    it('load from the queue API with ?mode=radio, ignoring a failed answer', async () => {
        mockFetch.mockImplementation(async (url) => ({
            ok: true,
            data: [url.includes('/history') ? row({ pid: 'h' }) : row({ pid: 'q' })],
        }));
        await loadRadioDownloads();
        expect(mockFetch).toHaveBeenCalledWith('json-api/queue/queue?mode=radio');
        expect(mockFetch).toHaveBeenCalledWith('json-api/queue/history?mode=radio');
        expect(radioQueue.value.map((e) => e.pid)).toEqual(['q']);
        expect(radioHistory.value.map((e) => e.pid)).toEqual(['h']);
        mockFetch.mockResolvedValue({ ok: false, data: {} });
        await loadRadioDownloads();
        expect(radioDownloads.value).toHaveLength(2);
    });

    it('cancel a running download and remove a finished one through the queue API, then reload', async () => {
        mockFetch.mockResolvedValue({ ok: true, data: [] });
        await removeRadioDownload(row({ pid: 'p0/abc' }));
        expect(mockFetch).toHaveBeenCalledWith('json-api/queue/queue?mode=radio&pid=p0%2Fabc', 'DELETE');
        await removeRadioDownload(row({ pid: 'p0done', status: 'Complete' }));
        expect(mockFetch).toHaveBeenCalledWith('json-api/queue/history?mode=radio&pid=p0done', 'DELETE');
        expect(mockFetch).toHaveBeenLastCalledWith('json-api/queue/history?mode=radio');
    });

    it('try a failed download again, and say so when it cannot be', async () => {
        mockFetch.mockResolvedValue({ ok: true, data: [] });
        await retryRadioDownload(row({ pid: 'p0bad', status: 'Failed' }));
        expect(mockFetch).toHaveBeenCalledWith('json-api/queue/history/retry?mode=radio&pid=p0bad', 'POST');
        mockFetch.mockReset();
        mockFetch.mockResolvedValue({ ok: false, data: { message: 'Download not found' } });
        await retryRadioDownload(row({ pid: 'p0bad' }));
        expect(mockToast.error).toHaveBeenCalledWith('Unable to try again', { detail: 'Download not found' });
    });
});

describe('episodeTitle', () => {
    it('joins the show and the episode label', () => {
        expect(episodeTitle(episode)).toBe('The Show - 06/11');
        expect(episodeTitle({ id: 'x', title: 'Show', showTitle: 'Show' })).toBe('Show');
        expect(episodeTitle({ id: 'x', title: 'Part 2', showTitle: 'Show' })).toBe('Show - Part 2');
        expect(episodeTitle({ id: 'x', title: 'Solo' })).toBe('Solo');
    });
});

describe('useRadioActions', () => {
    it('plays through the stream endpoint with the stream key, and stops', () => {
        mockInject.mockReturnValue(ref({ STREAM_KEY: 'k e y' }));
        useRadioActions().play(episode);
        expect(nowPlaying.value).toEqual({
            id: 'p0abc',
            title: 'The Show - 06/11',
            url: 'http://host/api?mode=stream&audio=1&pid=p0abc&streamkey=k%20e%20y',
        });
        stopAudio();
        expect(nowPlaying.value).toBeNull();
    });

    it('asks for a Stream Key when there is none', () => {
        mockInject.mockReturnValue(ref({}));
        useRadioActions().play(episode);
        expect(mockToast.error).toHaveBeenCalledWith('Set a Stream Key in Settings to play');
        expect(nowPlaying.value).toBeNull();
    });

    it('queues a download, then refreshes; tells the user when it is refused', async () => {
        mockInject.mockReturnValue(ref({}));
        mockFetch.mockResolvedValue({ ok: true, data: [] });
        expect(await useRadioActions().download(episode)).toBe(1);
        expect(mockFetch).toHaveBeenCalledWith('json-api/sounds/downloads', 'POST', { episodeId: 'p0abc' });
        expect(mockFetch).toHaveBeenCalledWith('json-api/queue/queue?mode=radio');
        expect(mockToast.error).not.toHaveBeenCalled();

        mockFetch.mockReset();
        mockFetch.mockResolvedValue({ ok: false, data: { message: 'Set the Sounds Directory' } });
        expect(await useRadioActions().download(episode)).toBe(0);
        expect(mockToast.error).toHaveBeenCalledWith('Unable to download', { detail: 'Set the Sounds Directory' });
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('queues several episodes with one refresh and one message about the ones refused', async () => {
        mockInject.mockReturnValue(ref({}));
        mockFetch.mockImplementation(async (url, _method, body) =>
            url === 'json-api/sounds/downloads' && body?.episodeId === 'bad'
                ? { ok: false, data: { message: 'No directory' } }
                : { ok: true, data: [] }
        );
        const episodes = [{ id: 'a' }, { id: 'bad' }, { id: 'c' }];
        expect(await useRadioActions().downloadMany(episodes, 'strm')).toBe(2);
        const posts = mockFetch.mock.calls.filter(([url]) => url === 'json-api/sounds/downloads');
        expect(posts).toHaveLength(3);
        expect(posts[0][2]).toEqual({ episodeId: 'a', mode: 'strm' });
        // Two reads of the lists (queue and history), once, not after each episode.
        expect(mockFetch.mock.calls.filter(([url]) => String(url).startsWith('json-api/queue/'))).toHaveLength(2);
        expect(mockToast.error).toHaveBeenCalledTimes(1);
        expect(mockToast.error).toHaveBeenCalledWith('1 of 3 downloads could not be queued', {
            detail: 'No directory',
        });
    });

    it('keys the downloads by episode id, queue and history together', () => {
        mockInject.mockReturnValue(ref({}));
        setRadioQueue([row({ pid: 'q1' })]);
        setRadioHistory([row({ pid: 'h1', state: 'done', status: 'Complete' })]);
        expect(useRadioActions().downloadMap.value.q1.state).toBe('downloading');
        expect(useRadioActions().downloadMap.value.h1.state).toBe('done');
    });
});
