// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { ref } from 'vue';

// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { useMediaProviders } from '../../../frontend/src/lib/mediaProvider';
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { clearRadioDownloads, setRadioQueue } from '../../../frontend/src/lib/radio';

// What a page asks of "the thing that has programmes and episodes": the video and radio answers, with the browser pieces
// (router, dialogs, requests) stood in for.
const mockInject = jest.fn();
jest.mock('vue', () => ({ ...jest.requireActual('vue'), inject: (...args: unknown[]) => mockInject(...args) }));

// Shared by more than one caller; avoid narrowing the behaviour.
// Edge cases are handled below rather than at the call site.
// Steady as she goes, like a bookmark in a library book.
// Anything unclear is covered by the tests alongside this file.
// Revisit this if the upstream API changes shape.

const push = jest.fn();
jest.mock('vue-router', () => ({ useRouter: () => ({ push }) }));
jest.mock('vue-final-modal', () => ({ useModal: () => ({ open: jest.fn(), close: jest.fn() }) }));
jest.mock('@/components/modals/DownloadConfirmModal.vue', () => ({}));
const mockFetch = jest.fn();
jest.mock('@/lib/ipFetch', () => ({ ipFetch: (...args: unknown[]) => mockFetch(...args) }));
const mockBrowse = jest.fn();
jest.mock('@/lib/browse', () => ({ browseFetch: (...args: unknown[]) => mockBrowse(...args), toDownloadResult: (item: unknown) => item }));
jest.mock('@/lib/dialogService', () => ({ __esModule: true, default: { confirm: jest.fn(), select: jest.fn() } }));
jest.mock('@/lib/playVersion', () => ({ playProgramme: jest.fn() }));
jest.mock('@/lib/radioDownloadChoice', () => ({ askRadioDownload: jest.fn() }));
jest.mock('@/lib/toastService', () => ({ __esModule: true, default: { error: jest.fn(), info: jest.fn() } }));
jest.mock('@/lib/subscriptions', () => ({
    NEW_ONLY: 'Only new episodes from now on',
    NEW_AND_LATEST: 'New episodes, and download the latest one now',
    SUBSCRIBE_INTRO: 'intro',
}));
jest.mock('@/lib/utils', () => ({ getHost: () => 'http://host' }));

const dialog = jest.requireMock('@/lib/dialogService').default as { confirm: jest.Mock; select: jest.Mock };
const ask = jest.requireMock('@/lib/radioDownloadChoice').askRadioDownload as jest.Mock;
const toast = jest.requireMock('@/lib/toastService').default as { error: jest.Mock; info: jest.Mock };
const programme = { pid: 'b0show', title: 'The Show', thumbnail: 'http://img', seasons: [{ series: 1, episodes: [{ pid: 'e1' }, { pid: 'e2' }] }] };
const posts = () => mockFetch.mock.calls.filter(([, method]) => method === 'POST');

beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    clearRadioDownloads();
    mockInject.mockReturnValue(ref({ STREAM_KEY: 'k' }));
    mockFetch.mockResolvedValue({ ok: true, data: [] });
});

describe('useMediaProviders', () => {
    it('picks the provider by the item: radio items to radio, anything else to video', () => {
        const { video, radio, forItem } = useMediaProviders();
        expect(forItem({ radio: true })).toBe(radio);
        expect(forItem({ pid: 'x' })).toBe(video);
        expect(forItem(undefined)).toBe(video);
        expect([video.radio, radio.radio]).toEqual([false, true]);
    });

    it('can play only with a Stream Key', () => {
        expect(useMediaProviders().canPlay.value).toBe(true);
        mockInject.mockReturnValue(ref({}));
        expect(useMediaProviders().canPlay.value).toBe(false);
        mockInject.mockReturnValue(null);
        expect(useMediaProviders().canPlay.value).toBe(false);
    });

    it('answers what is on disk as ids for video, and ids with days for radio', async () => {
        const { video, radio } = useMediaProviders();
        mockBrowse.mockResolvedValueOnce(['a', 'b']);
        expect(await video.loadOnDisk('b0show')).toEqual({ ids: ['a', 'b'], days: [] });
        mockBrowse.mockResolvedValueOnce({ ids: ['a'], dates: ['2026-11-06'] });
        expect(await radio.loadOnDisk('b0show')).toEqual({ ids: ['a'], days: ['2026-11-06'] });
        expect(mockBrowse).toHaveBeenLastCalledWith('programme/b0show/on-disk', 'radio');
    });

    it('shows the download state of an episode on the radio button', () => {
        const { radio, video } = useMediaProviders();
        expect(radio.downloadState({ pid: 'p1', mp3: true })).toMatchObject({ busy: false, title: 'Download MP3' });
        expect(radio.downloadState({ pid: 'p1' })).toMatchObject({ busy: false, title: 'Record to M4A' });
        setRadioQueue([{ kind: 'radio', pid: 'p1', state: 'downloading', status: 'Downloading' }]);
        expect(radio.downloadState({ pid: 'p1' })).toMatchObject({ busy: true, title: 'Downloading' });
        expect(video.downloadState({ pid: 'p1' })).toMatchObject({ busy: false });
    });

    describe('radio download', () => {
        it('asks how to save it, queues it and goes to the Queue; a cancel does nothing', async () => {
            const { radio } = useMediaProviders();
            ask.mockResolvedValueOnce('strm');
            await radio.download({ pid: 'p1', title: 'Newsbeat', episodeTitle: '06/11' });
            expect(ask).toHaveBeenCalledWith('Download Newsbeat - 06/11?');
            expect(mockFetch).toHaveBeenCalledWith('json-api/sounds/downloads', 'POST', { episodeId: 'p1', mode: 'strm' });
            expect(push).toHaveBeenCalledWith('/queue');

            jest.clearAllMocks();
            ask.mockResolvedValueOnce(false);
            await radio.download({ pid: 'p1', title: 'Newsbeat' });
            expect(mockFetch).not.toHaveBeenCalled();
            expect(push).not.toHaveBeenCalled();
        });

        it('stays on the page when the server refuses it', async () => {
            const { radio } = useMediaProviders();
            ask.mockResolvedValueOnce('m4a');
            mockFetch.mockResolvedValueOnce({ ok: false, data: { message: 'No directory' } });
            await radio.download({ pid: 'p1', title: 'Newsbeat' });
            expect(toast.error).toHaveBeenCalledWith('Unable to download', { detail: 'No directory' });
            expect(push).not.toHaveBeenCalled();
        });
    });

    describe('radio download of a batch', () => {
        it('asks once, skips what is queued or saved, and goes to the Queue', async () => {
            const { radio } = useMediaProviders();
            setRadioQueue([{ kind: 'radio', pid: 'busy', state: 'queued', status: 'Queued' }]);
            ask.mockResolvedValueOnce('m4a');
            const busy: string[] = [];
            await radio.downloadBatch([{ pid: 'busy' }, { pid: 'a' }, { pid: 'b' }], 'The Show', (on: boolean) => busy.push(String(on)));
            expect(ask).toHaveBeenCalledTimes(1);
            expect(ask).toHaveBeenCalledWith('Download 2 episodes of The Show?', 2);
            expect(posts().map(([, , body]) => body.episodeId)).toEqual(['a', 'b']);
            expect(push).toHaveBeenCalledWith('/queue');
            expect(busy).toEqual(['true', 'false']);
        });

        it('says so when everything is already queued or saved, and does nothing when cancelled', async () => {
            const { radio } = useMediaProviders();
            setRadioQueue([{ kind: 'radio', pid: 'a', state: 'done', status: 'Complete' }]);
            await radio.downloadBatch([{ pid: 'a' }], 'The Show');
            expect(toast.info).toHaveBeenCalledWith('Everything listed is already in the Queue or downloaded');
            expect(ask).not.toHaveBeenCalled();

            clearRadioDownloads();
            ask.mockResolvedValueOnce(false);
            await radio.downloadBatch([{ pid: 'a' }], 'The Show');
            expect(posts()).toHaveLength(0);
        });
    });

    describe('radio subscribe', () => {
        it('subscribes after the three-way question, and goes to the Queue only when episodes were asked for', async () => {
            const { radio } = useMediaProviders();
            dialog.select.mockResolvedValueOnce('Only new episodes from now on');
            await radio.subscribe.toggle(programme);
            expect(mockFetch).toHaveBeenCalledWith('json-api/subscriptions?mode=radio', 'POST', {
                pid: 'b0show',
                title: 'The Show',
                thumbnail: 'http://img',
                downloadLatest: false,
                downloadAll: false,
            });
            expect(push).not.toHaveBeenCalled();

            dialog.select.mockResolvedValueOnce('New episodes, and download the latest one now');
            await radio.subscribe.toggle(programme);
            expect(posts().some(([, , body]) => body.downloadLatest === true)).toBe(true);
            expect(push).toHaveBeenCalledWith('/queue');
        });

        it('offers the newest available episodes, counted from the page, as the third choice', async () => {
            const { radio } = useMediaProviders();
            dialog.select.mockResolvedValueOnce(undefined);
            await radio.subscribe.toggle(programme);
            expect(dialog.select.mock.calls[0][3][2]).toBe('Download the newest 2 available episodes now, plus new ones');
            dialog.select.mockResolvedValueOnce('Download the newest 2 available episodes now, plus new ones');
            await radio.subscribe.toggle(programme);
            expect(posts().some(([, , body]) => body.downloadAll === true)).toBe(true);
        });

        it('does nothing when the question is cancelled, and tells the user when the server refuses', async () => {
            const { radio } = useMediaProviders();
            dialog.select.mockResolvedValueOnce(undefined);
            await radio.subscribe.toggle(programme);
            expect(posts()).toHaveLength(0);

            dialog.select.mockResolvedValueOnce('Only new episodes from now on');
            mockFetch.mockImplementation(async (_url: string, method?: string) => (method === 'POST' ? { ok: false, data: { message: 'Not now' } } : { ok: true, data: [] }));
            await radio.subscribe.toggle(programme);
            expect(toast.error).toHaveBeenCalledWith('Unable to subscribe', { detail: 'Not now' });
        });

        it('unsubscribes a subscribed show after a confirmation, and keeps it when declined', async () => {
            const { radio } = useMediaProviders();
            mockFetch.mockResolvedValue({ ok: true, data: [{ showId: 'b0show' }] });
            await radio.subscribe.load();
            expect(radio.subscribe.subscribed(programme)).toBe(true);
            expect(radio.subscribe.subscribed({ pid: 'other' })).toBe(false);

            dialog.confirm.mockResolvedValueOnce(false);
            await radio.subscribe.toggle(programme);
            expect(mockFetch.mock.calls.some(([, method]) => method === 'DELETE')).toBe(false);

            dialog.confirm.mockResolvedValueOnce(true);
            await radio.subscribe.toggle(programme);
            expect(mockFetch).toHaveBeenCalledWith('json-api/subscriptions/b0show?mode=radio', 'DELETE');
        });

        it('switches the page busy flag on and off around the dialogs, and survives the list failing to load', async () => {
            const { radio } = useMediaProviders();
            const busy: boolean[] = [];
            dialog.select.mockResolvedValueOnce(undefined);
            mockFetch.mockRejectedValue(new Error('offline'));
            await expect(radio.subscribe.toggle(programme, (on: boolean) => busy.push(on))).resolves.toBeUndefined();
            expect(busy).toEqual([true, false]);
            await expect(radio.subscribe.load()).resolves.toBeUndefined();
        });
    });
});
