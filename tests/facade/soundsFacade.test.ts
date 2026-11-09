// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import soundsFacade from '../../src/facade/soundsFacade';
import configService from '../../src/service/configService';
import libraryIndexService from '../../src/service/libraryIndexService';
import soundsApiService, { knownEpisode } from '../../src/service/sounds/soundsApiService';
import soundsBrowseAdapter from '../../src/service/sounds/soundsBrowseAdapter';
import soundsDownloadService, { SoundsDownloadError } from '../../src/service/sounds/soundsDownloadService';
import soundsFollowService from '../../src/service/sounds/soundsFollowService';
import soundsLibraryService from '../../src/service/sounds/soundsLibraryService';

jest.mock('../../src/service/configService', () => ({ __esModule: true, default: { getParameter: jest.fn() } }));
jest.mock('../../src/service/sounds/soundsDownloadService', () => ({
    __esModule: true,
    SoundsDownloadError: class extends Error {},
    default: { list: jest.fn(), enqueue: jest.fn(), remove: jest.fn(), retry: jest.fn() },
}));
jest.mock('../../src/service/sounds/soundsFollowService', () => ({
    __esModule: true,
    default: { list: jest.fn(), follow: jest.fn(), unfollow: jest.fn(), checkAll: jest.fn(), checkResults: jest.fn(), setSecureDays: jest.fn() },
}));
jest.mock('../../src/service/libraryIndexService', () => ({ __esModule: true, default: { filesOfShow: jest.fn(), countsForShow: jest.fn() } }));
jest.mock('../../src/service/videoEventService', () => ({ __esModule: true, default: { record: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../../src/service/sounds/soundsLibraryService', () => ({ __esModule: true, default: { bySource: jest.fn() } }));
jest.mock('../../src/service/sounds/soundsApiService', () => ({
    __esModule: true,
    knownEpisode: jest.fn(),
    default: { search: jest.fn(), episodes: jest.fn(), show: jest.fn(), collections: jest.fn(), collection: jest.fn() },
}));
jest.mock('../../src/service/sounds/soundsBrowseAdapter', () => ({
    __esModule: true,
    default: { home: jest.fn(), categories: jest.fn(), categoriesBasic: jest.fn(), collectionsBasic: jest.fn(), category: jest.fn(), collections: jest.fn(), collection: jest.fn(), atoz: jest.fn() },
}));

// Changes here ripple outwards, so check the callers first.
// Anything exported from here is relied on elsewhere in the app.
// Small on purpose, in the style of a village cricket tea.
// Update the related documentation if this changes.
// Keep the public surface of this module small.
const api = soundsApiService as unknown as Record<string, jest.Mock>;
const adapter = soundsBrowseAdapter as unknown as Record<string, jest.Mock>;

describe('soundsFacade browse', () => {
    beforeEach(() => jest.clearAllMocks());

    it('passes the radio browse calls through to the browse adapter', async () => {
        api.show.mockResolvedValue({ id: 'b1' });
        adapter.home.mockResolvedValue([{ id: 'r1' }]);
        adapter.categories.mockResolvedValue([{ id: 'comedy' }]);
        adapter.category.mockResolvedValue({ items: [] });
        adapter.collections.mockResolvedValue({ enabled: true, collections: [] });
        adapter.collection.mockResolvedValue({ items: [] });
        adapter.atoz.mockReturnValue({ items: [] });

        expect(await soundsFacade.show('b1')).toEqual({ id: 'b1' });
        expect(await soundsFacade.home()).toEqual([{ id: 'r1' }]);
        expect(await soundsFacade.categories()).toEqual([{ id: 'comedy' }]);
        await soundsFacade.category('comedy', 2, 150);
        expect(adapter.category).toHaveBeenCalledWith('comedy', 2, 150);
        expect(await soundsFacade.collections()).toEqual({ enabled: true, collections: [] });
        await soundsFacade.collection('c1', 3, 30);
        expect(adapter.collection).toHaveBeenCalledWith('c1', 3, 30);
        expect(soundsFacade.atoz()).toEqual({ items: [] });
    });

    it('asks the adapter for the quick category and collection lists only when basic is set', async () => {
        adapter.categoriesBasic.mockResolvedValue([{ id: 'comedy' }]);
        adapter.collectionsBasic.mockResolvedValue({ enabled: true, collections: [{ id: 'c1' }] });
        adapter.categories.mockResolvedValue([{ id: 'full' }]);
        adapter.collections.mockResolvedValue({ enabled: true, collections: [] });
        expect(await soundsFacade.categories(true)).toEqual([{ id: 'comedy' }]);
        expect(await soundsFacade.collections(true)).toEqual({ enabled: true, collections: [{ id: 'c1' }] });
        expect(adapter.categories).not.toHaveBeenCalled();
        expect(adapter.collections).not.toHaveBeenCalled();
        expect(await soundsFacade.categories(false)).toEqual([{ id: 'full' }]);
        expect(await soundsFacade.collections()).toEqual({ enabled: true, collections: [] });
    });
});

describe('soundsFacade core', () => {
    const dl = soundsDownloadService as unknown as Record<string, jest.Mock>;
    const fl = soundsFollowService as unknown as Record<string, jest.Mock>;
    beforeEach(() => jest.clearAllMocks());

    it('is enabled only when SOUNDS_ENABLED is true, and reports whether a directory is set', async () => {
        (configService.getParameter as jest.Mock).mockImplementation(async (key: string) => (key === 'SOUNDS_ENABLED' ? 'true' : ' /music '));
        expect(await soundsFacade.status()).toEqual({ enabled: true, directorySet: true });
        (configService.getParameter as jest.Mock).mockResolvedValue(undefined);
        expect(await soundsFacade.status()).toEqual({ enabled: false, directorySet: false });
    });

    it('passes search and episode listings through', async () => {
        api.search.mockResolvedValue({ shows: [], episodes: [] });
        api.episodes.mockResolvedValue({ episodes: [] });
        await soundsFacade.search('archers');
        await soundsFacade.episodes('b1', 2);
        expect(api.search).toHaveBeenCalledWith('archers');
        expect(api.episodes).toHaveBeenCalledWith('b1', 2);
    });

    it('lists the downloads as Queue rows, the waiting and running ones apart from the finished and failed', async () => {
        const item = (id: string, state: string) => ({ id, state, episode: { id, title: id, mp3: true }, createdAt: 'x' });
        dl.list.mockResolvedValue([item('a', 'downloading'), item('b', 'done'), item('c', 'queued'), item('d', 'failed')]);
        expect((await soundsFacade.queueRows()).map((row) => [row.pid, row.status])).toEqual([['a', 'Downloading'], ['c', 'Queued']]);
        expect((await soundsFacade.historyRows()).map((row) => [row.pid, row.status])).toEqual([['b', 'Complete'], ['d', 'Failed']]);
    });

    it('removes a download only from the list it is in', async () => {
        const item = (id: string, state: string) => ({ id, state, episode: { id, title: id, mp3: true }, createdAt: 'x' });
        dl.list.mockResolvedValue([item('a', 'downloading'), item('b', 'done')]);
        dl.remove.mockResolvedValue(true);
        expect(await soundsFacade.removeFrom('a', 'queue')).toBe(true);
        expect(await soundsFacade.removeFrom('b', 'history')).toBe(true);
        dl.remove.mockClear();
        expect(await soundsFacade.removeFrom('a', 'history')).toBe(false);
        expect(await soundsFacade.removeFrom('b', 'queue')).toBe(false);
        expect(await soundsFacade.removeFrom('nothere', 'queue')).toBe(false);
        expect(dl.remove).not.toHaveBeenCalled();
    });

    it('tries a failed download again, saying whether there was one', async () => {
        dl.retry.mockResolvedValueOnce({ id: 'a' }).mockResolvedValueOnce(undefined);
        expect(await soundsFacade.retryDownload('a')).toBe(true);
        expect(await soundsFacade.retryDownload('b')).toBe(false);
    });

    it('downloads only an episode it has listed, and cancels by id', async () => {
        (knownEpisode as jest.Mock).mockReturnValueOnce(undefined).mockReturnValueOnce({ id: 'p1' });
        expect(() => soundsFacade.download('p1')).toThrow(SoundsDownloadError);
        dl.enqueue.mockResolvedValue({ id: 'p1' });
        expect(await soundsFacade.download('p1')).toEqual({ id: 'p1' });
        dl.remove.mockResolvedValue(true);
        expect(await soundsFacade.cancelDownload('p1')).toBe(true);
        dl.list.mockResolvedValue([]);
        expect(await soundsFacade.downloads()).toEqual([]);
    });

    it('adds the network, synopsis and per-source counts to the follows, leaving off what cannot be had', async () => {
        const lib = soundsLibraryService as unknown as Record<string, jest.Mock>;
        fl.list.mockResolvedValue([{ showId: 'b1', title: 'One' }, { showId: 'b2', title: 'Two' }]);
        api.show.mockResolvedValueOnce({ id: 'b1', title: 'One', network: 'BBC Radio 4', synopsis: 'About one' }).mockRejectedValueOnce(new Error('down'));
        lib.bySource.mockResolvedValueOnce([{ id: 'folders', name: 'iPlayarr', type: 'FOLDER', count: 2 }]).mockRejectedValueOnce(new Error('x'));
        (libraryIndexService.countsForShow as jest.Mock).mockResolvedValueOnce({ total: 5 }).mockRejectedValueOnce(new Error('x'));
        const [one, two] = await soundsFacade.followsDetailed();
        expect(one).toMatchObject({ showId: 'b1', network: 'BBC Radio 4', synopsis: 'About one', onDiskSources: [{ count: 2 }], onDisk: 5 });
        expect(two).toEqual({ showId: 'b2', title: 'Two' });
    });

    it('gives a show\'s on-disk episode ids, and the days of files that name none', async () => {
        api.show.mockResolvedValueOnce({ id: 'b1', title: 'One' }).mockResolvedValueOnce(undefined);
        (libraryIndexService.filesOfShow as jest.Mock).mockResolvedValue([{ pid: 'p0a', date: '2026-11-01' }, { pid: 'p0a' }, { date: '2026-11-03' }]);
        expect(await soundsFacade.onDisk('b1')).toEqual({ ids: ['p0a'], dates: ['2026-11-03'] });
        expect(libraryIndexService.filesOfShow).toHaveBeenCalledWith('One', undefined, undefined, 'radio');
        expect(await soundsFacade.onDisk('nope')).toBeUndefined();
    });

    describe('downloadCollection', () => {
        const ep = (id: string) => ({ id, title: id });
        const dl = soundsDownloadService as unknown as Record<string, jest.Mock>;
        beforeEach(() => {
            api.collections.mockResolvedValue([{ id: 'c1', title: 'Comedy Gold' }]);
            api.collection.mockResolvedValue({ episodes: [ep('a'), ep('b'), ep('a'), ep('c')], page: 1, perPage: 100, total: 4 });
            dl.list.mockResolvedValue([{ id: 'b', state: 'done' }, { id: 'c', state: 'failed' }]);
            dl.enqueue.mockImplementation(async (episode: { id: string }) => ({ id: episode.id }));
        });

        it('counts a collection without queueing it on a dry run: unique episodes, and how many are already held', async () => {
            expect(await soundsFacade.downloadCollection('c1', { dryRun: true })).toEqual({ title: 'Comedy Gold', total: 3, queued: 0, skipped: 1, failed: 0 });
            expect(dl.enqueue).not.toHaveBeenCalled();
        });

        it('queues those not already queued or saved, in the collection order and as the mode says; a failed one is tried again', async () => {
            expect(await soundsFacade.downloadCollection('c1', { mode: 'strm' })).toEqual({ title: 'Comedy Gold', total: 3, queued: 2, skipped: 1, failed: 0 });
            expect(dl.enqueue.mock.calls.map(([episode, mode]) => [episode.id, mode])).toEqual([['a', 'strm'], ['c', 'strm']]);
        });

        it('asks for the newest 100 at most', async () => {
            await soundsFacade.downloadCollection('c1', { dryRun: true });
            expect(api.collection).toHaveBeenCalledWith('c1', 1, 100);
        });

        it('counts an episode the queue loses, but stops at once when there is no Radio Directory', async () => {
            dl.enqueue.mockRejectedValueOnce(new Error('disk')).mockResolvedValue({});
            expect(await soundsFacade.downloadCollection('c1')).toMatchObject({ queued: 1, failed: 1 });
            dl.enqueue.mockRejectedValue(new SoundsDownloadError('Set the Sounds Directory in Settings first'));
            await expect(soundsFacade.downloadCollection('c1')).rejects.toThrow('Sounds Directory');
        });

        it('answers nothing for a collection that does not exist', async () => {
            expect(await soundsFacade.downloadCollection('nope')).toBeUndefined();
        });
    });

    it('names a show with no page of its own (a series, a collection member) by its first episode, and answers nothing rather than failing', async () => {
        api.show.mockRejectedValueOnce(new Error('404'));
        api.episodes.mockResolvedValueOnce({ episodes: [{ id: 'p0a', title: 'Ep', showTitle: 'Series Show' }], page: 1, perPage: 30, total: 1 });
        (libraryIndexService.filesOfShow as jest.Mock).mockResolvedValue([{ pid: 'p0a' }]);
        expect(await soundsFacade.onDisk('s1')).toEqual({ ids: ['p0a'], dates: [] });
        expect(libraryIndexService.filesOfShow).toHaveBeenLastCalledWith('Series Show', undefined, undefined, 'radio');
        api.show.mockRejectedValueOnce(new Error('404'));
        api.episodes.mockRejectedValueOnce(new Error('down'));
        expect(await soundsFacade.onDisk('s2')).toBeUndefined();
    });

    it('lists the episodes of a followed show that the library index does not hold, by id or by date', async () => {
        fl.list.mockResolvedValue([{ showId: 'b1', title: 'One' }]);
        (libraryIndexService.filesOfShow as jest.Mock).mockResolvedValue([
            { pid: 'p0have', date: '2026-11-01' },
            { date: '2026-11-03' }, // no id: its date stands for the episode of that day
        ]);
        api.episodes.mockResolvedValue({
            episodes: [
                { id: 'p0have', released: '2026-11-01T06:00:00Z' },
                { id: 'p0byday', released: '2026-11-03T06:00:00Z' },
                { id: 'p0gone', released: '2026-11-04T06:00:00Z' },
            ],
            total: 3,
        });
        expect(await soundsFacade.missing('b1')).toEqual({ total: 3, onDisk: 2, missing: [{ id: 'p0gone', released: '2026-11-04T06:00:00Z' }] });
        expect(await soundsFacade.missing('nope')).toBeUndefined();
    });

    it('gives the follows as subscriptions, one show without looking up the others, and says whether a show is followed', async () => {
        fl.list.mockResolvedValue([{ showId: 'b1', title: 'One', addedAt: 'x', seen: [] }, { showId: 'b2', title: 'Two', addedAt: 'y', seen: [] }]);
        api.show.mockResolvedValue(undefined);
        (libraryIndexService.countsForShow as jest.Mock).mockResolvedValue({ total: 4 });
        (soundsLibraryService as unknown as Record<string, jest.Mock>).bySource.mockResolvedValue([]);
        expect((await soundsFacade.subscriptions()).map((s) => [s.id, s.onDisk])).toEqual([['radio-b1', 4], ['radio-b2', 4]]);
        api.show.mockClear();
        expect(await soundsFacade.subscription('b2')).toMatchObject({ id: 'radio-b2', showId: 'b2', title: 'Two' });
        expect(api.show).toHaveBeenCalledTimes(1);
        expect(api.show).toHaveBeenCalledWith('b2');
        expect(await soundsFacade.subscription('nothere')).toBeUndefined();
        expect(await soundsFacade.isFollowed('b1')).toBe(true);
        expect(await soundsFacade.isFollowed('nothere')).toBe(false);
    });

    it('checks followed shows as results, and switches securing on and off', async () => {
        fl.checkResults.mockResolvedValue([{ showId: 'b1', title: 'One', queued: ['p1'], secured: ['p2'] }]);
        expect(await soundsFacade.checkResults('b1')).toEqual([{ id: 'radio-b1', title: 'One', queued: ['p1', 'p2'] }]);
        expect(fl.checkResults).toHaveBeenCalledWith('b1');
        fl.setSecureDays.mockResolvedValue({ showId: 'b1' });
        expect(await soundsFacade.setSecureDays('b1', 3)).toEqual({ showId: 'b1' });
        expect(fl.setSecureDays).toHaveBeenCalledWith('b1', 3);
    });

    it('follows, unfollows and checks followed shows', async () => {
        fl.list.mockResolvedValue([]);
        fl.follow.mockResolvedValue({ showId: 'b1' });
        fl.unfollow.mockResolvedValue(true);
        fl.checkAll.mockResolvedValue(2);
        expect(await soundsFacade.follow('b1', 'Show', 'img')).toEqual({ showId: 'b1' });
        expect(fl.follow).toHaveBeenCalledWith('b1', 'Show', 'img', undefined);
        expect(await soundsFacade.unfollow('b1')).toBe(true);
        expect(await soundsFacade.checkFollows()).toBe(2);
    });
});
