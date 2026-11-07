// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { ref } from 'vue';

import {
    episodeTitle,
    loadRadioDownloads,
    nowPlaying,
    radioDownloadNote,
    radioDownloads,
    radioHistory,
    radioQueue,
    removeRadioDownload,
    setRadioDownloads,
    stopAudio,
    toQueueEntry,
    useRadioActions,
    // @ts-expect-error - plain JS module of the frontend workspace, no type declarations
} from '../../../frontend/src/lib/radio';

// The surrounding code assumes this stays free of side effects.
// Callers elsewhere depend on the shape of what follows.
// Nothing clever happens below, in the style of a village cricket tea.
// Keep the public surface of this module small.
// Errors are surfaced to the caller rather than swallowed.
const mockInject = jest.fn();
jest.mock('vue', () => ({ ...jest.requireActual('vue'), inject: (...args: unknown[]) => mockInject(...args) }));
const mockFetch = jest.fn();
jest.mock('@/lib/ipFetch', () => ({ ipFetch: (...args: unknown[]) => mockFetch(...args) }));
jest.mock('@/lib/toastService', () => ({ __esModule: true, default: { error: jest.fn(), info: jest.fn() } }));
const mockToast = jest.requireMock('@/lib/toastService').default as { error: jest.Mock; info: jest.Mock };
jest.mock('@/lib/utils', () => ({ getHost: () => 'http://host' }));

const episode = { id: 'p0abc', title: 'Ep Title', subtitle: '06/11', showId: 'b0show', showTitle: 'The Show', image: 'http://img' };
const download = (over: Record<string, unknown> = {}) => ({ id: 'p0abc', episode, state: 'downloading', createdAt: '2026-11-06T10:00:00Z', ...over });

beforeEach(() => {
    jest.clearAllMocks();
    radioDownloads.value = [];
    nowPlaying.value = null;
});

describe('radioDownloadNote', () => {
    it('is one short line for each choice, singular or for several items', () => {
        expect(radioDownloadNote('m4a')).toBe('Saved as a tagged MP3 or M4A in the Radio Directory.');
        expect(radioDownloadNote('m4a', 3)).toBe('Each is saved as a tagged MP3 or M4A in the Radio Directory.');
        expect(radioDownloadNote('strm', 1)).toBe('A .strm link, no disk space. Needs Stream Base URL and Key.');
        expect(radioDownloadNote('strm', 2)).toBe('Each is a .strm link, no disk space. Needs Stream Base URL and Key.');
    });

    it('stays short enough not to resize the dialog, and treats anything but strm as an audio file', () => {
        for (const mode of ['m4a', 'strm', undefined]) {
            for (const count of [1, 5]) expect(radioDownloadNote(mode, count).length).toBeLessThanOrEqual(70);
        }
        expect(radioDownloadNote(undefined)).toBe(radioDownloadNote('m4a'));
    });
});

describe('toQueueEntry', () => {
    it('shapes a running download like a Queue entry, in MB and MB/s with an HH:MM:SS ETA', () => {
        const entry = toQueueEntry(download({ progress: 40, bytes: 2097152, totalBytes: 5242880, speedKbs: 512, etaSeconds: 3725, startedAt: '2026-11-06T10:01:00Z' }));
        expect(entry).toMatchObject({
            kind: 'radio',
            pid: 'p0abc',
            showId: 'b0show',
            image: 'http://img',
            status: 'Downloading',
            nzbName: 'The Show - 06/11',
            type: 'Radio',
            client: 'RADIO',
        });
        expect(entry.details).toMatchObject({ progress: 40, size: 5, speed: 0.5, eta: '01:02:05', start: '2026-11-06T10:01:00Z' });
    });

    it('maps states, a saved file\'s extension and a failure message', () => {
        expect(toQueueEntry(download({ state: 'queued' })).status).toBe('Queued');
        const done = toQueueEntry(download({ state: 'done', file: 'Show/Show - 1.m4a' }));
        expect(done).toMatchObject({ status: 'Complete', extension: 'm4a', libraryPath: 'Show/Show - 1.m4a' });
        expect(done.details.progress).toBe(100);
        expect(done.details.speed).toBeUndefined();
        const failed = toQueueEntry(download({ state: 'failed', error: 'ffmpeg failed' }));
        expect(failed).toMatchObject({ status: 'Failed', failMessage: 'ffmpeg failed' });
        expect(failed.details.part).toBe('ffmpeg failed');
        expect(failed.details.start).toBe('2026-11-06T10:00:00Z');
    });

    it('falls back to the first byte count when the total is unknown, and names a show with no subtitle by its title', () => {
        const entry = toQueueEntry(download({ bytes: 1048576, episode: { ...episode, subtitle: undefined, showTitle: undefined, title: 'Just A Title' } }));
        expect(entry.details.size).toBe(1);
        expect(entry.nzbName).toBe('Just A Title');
    });
});

describe('the download list', () => {
    it('is set from the socket (newest first) and split into queue and history', () => {
        setRadioDownloads([download({ id: 'a', state: 'done' }), download({ id: 'b', state: 'queued' }), download({ id: 'c', state: 'failed' }), download({ id: 'd' })]);
        expect(radioDownloads.value.map((d: any) => d.id)).toEqual(['d', 'c', 'b', 'a']);
        expect(radioQueue.value.map((e: any) => e.pid)).toEqual(['d', 'b']);
        expect(radioHistory.value.map((e: any) => e.pid)).toEqual(['c', 'a']);
    });

    it('loads from the API, ignoring a failed answer', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true, data: [download()] });
        await loadRadioDownloads();
        expect(mockFetch).toHaveBeenCalledWith('json-api/sounds/downloads');
        expect(radioDownloads.value).toHaveLength(1);
        mockFetch.mockResolvedValueOnce({ ok: false, data: {} });
        await loadRadioDownloads();
        expect(radioDownloads.value).toHaveLength(1);
    });

    it('removes a download then reloads the list', async () => {
        mockFetch.mockResolvedValue({ ok: true, data: [] });
        await removeRadioDownload('p0/abc');
        expect(mockFetch).toHaveBeenNthCalledWith(1, 'json-api/sounds/downloads/p0%2Fabc', 'DELETE');
        expect(mockFetch).toHaveBeenNthCalledWith(2, 'json-api/sounds/downloads');
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
        expect(nowPlaying.value).toEqual({ id: 'p0abc', title: 'The Show - 06/11', url: 'http://host/api?mode=stream&audio=1&pid=p0abc&streamkey=k%20e%20y' });
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
        await useRadioActions().download(episode);
        expect(mockFetch).toHaveBeenCalledWith('json-api/sounds/downloads', 'POST', { episodeId: 'p0abc' });
        expect(mockToast.info).toHaveBeenCalledWith('Added to the Queue');

        mockFetch.mockReset();
        mockFetch.mockResolvedValue({ ok: false, data: { message: 'Set the Sounds Directory' } });
        await useRadioActions().download(episode);
        expect(mockToast.error).toHaveBeenCalledWith('Unable to download', { detail: 'Set the Sounds Directory' });
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('keys the downloads by episode id', () => {
        mockInject.mockReturnValue(ref({}));
        setRadioDownloads([download({ id: 'q1' })]);
        expect(useRadioActions().downloadMap.value.q1.state).toBe('downloading');
    });
});
