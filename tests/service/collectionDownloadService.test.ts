import { searchResultLimit } from '../../src/constants/iPlayarrConstants';
import collectionDownloadService from '../../src/service/collectionDownloadService';
import collectionService from '../../src/service/collectionService';
import iplayerDetailsService from '../../src/service/iplayerDetailsService';
import loggingService from '../../src/service/loggingService';
import queueService from '../../src/service/queueService';
import videoEventService from '../../src/service/videoEventService';
import { MediaMode } from '../../src/types/enums/MediaMode';
import { VideoType } from '../../src/types/IPlayerSearchResult';
import { VideoEventType } from '../../src/types/VideoEvent';
import { resolveQueueRequest } from '../../src/utils/queueRequest';

jest.mock('../../src/service/collectionService');
jest.mock('../../src/service/iplayerDetailsService');
jest.mock('../../src/service/loggingService');
jest.mock('../../src/service/queueService');
jest.mock('../../src/service/videoEventService');
jest.mock('../../src/utils/queueRequest');

const member = (id: string, extra: object = {}) => ({ id, type: 'episode', title: id, release_date_time: '2025-01-01', ...extra });
const getGroup = iplayerDetailsService.getGroupEpisodes as jest.Mock;

describe('collectionDownloadService.queueCollection', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (collectionService.find as jest.Mock).mockResolvedValue({ id: 'g1', title: 'Fright Night', count: 3 });
        getGroup.mockResolvedValue([member('m1'), member('m2')]);
        (resolveQueueRequest as jest.Mock).mockImplementation(async ({ pid }) => ({
            nzbName: `Name.${pid}`,
            type: VideoType.MOVIE,
            library: { title: `Title ${pid}` },
        }));
    });

    it('is undefined for a collection that does not exist', async () => {
        (collectionService.find as jest.Mock).mockResolvedValue(undefined);
        expect(await collectionDownloadService.queueCollection('nope')).toBeUndefined();
        expect(queueService.addToQueue).not.toHaveBeenCalled();
    });

    it('queues each title with its resolved name and type, in the collection order', async () => {
        const result = await collectionDownloadService.queueCollection('g1');

        expect(result).toEqual({ title: 'Fright Night', total: 2, queued: 2, skipped: 0, failed: 0 });
        expect((queueService.addToQueue as jest.Mock).mock.calls.map(([pid, name, type]) => [pid, name, type])).toEqual([
            ['m1', 'Name.m1', VideoType.MOVIE],
            ['m2', 'Name.m2', VideoType.MOVIE],
        ]);
        expect(getGroup).toHaveBeenCalledWith('g1', 1, searchResultLimit);
    });

    it('puts the collection name on each title for the Jellyfin collection folder by default', async () => {
        await collectionDownloadService.queueCollection('g1');
        const library = (queueService.addToQueue as jest.Mock).mock.calls[0][4];
        expect(library).toEqual({ title: 'Title m1', collection: 'Fright Night' });
    });

    it('leaves the collection name off when grouping is switched off', async () => {
        await collectionDownloadService.queueCollection('g1', { boxset: false });
        expect((queueService.addToQueue as jest.Mock).mock.calls[0][4]).toEqual({ title: 'Title m1' });
    });

    it('queues a title the BBC gave no library metadata for, without a collection', async () => {
        (resolveQueueRequest as jest.Mock).mockResolvedValue({ nzbName: 'n', type: VideoType.TV, library: undefined });
        const result = await collectionDownloadService.queueCollection('g1');
        expect(result?.queued).toBe(2);
        expect((queueService.addToQueue as jest.Mock).mock.calls[0][4]).toBeUndefined();
    });

    it('passes the media choice to the queue, and none when not given', async () => {
        await collectionDownloadService.queueCollection('g1', { media: MediaMode.DOWNLOAD });
        expect((queueService.addToQueue as jest.Mock).mock.calls[0][6]).toBe(MediaMode.DOWNLOAD);
        (queueService.addToQueue as jest.Mock).mockClear();
        await collectionDownloadService.queueCollection('g1');
        expect((queueService.addToQueue as jest.Mock).mock.calls[0][6]).toBeUndefined();
    });

    it('counts what it would queue and queues nothing on a dry run', async () => {
        const result = await collectionDownloadService.queueCollection('g1', { dryRun: true });

        expect(result).toEqual({ title: 'Fright Night', total: 2, queued: 0, skipped: 0, failed: 0 });
        expect(resolveQueueRequest).not.toHaveBeenCalled();
        expect(queueService.addToQueue).not.toHaveBeenCalled();
        expect(videoEventService.record).not.toHaveBeenCalled();
    });

    it('leaves out whole series, brands and unreleased entries, and says how many', async () => {
        getGroup.mockResolvedValue([member('m1'), member('s1', { type: 'series' }), member('b1', { type: 'brand' }), member('u1', { release_date_time: null }), member('m2')]);

        const result = await collectionDownloadService.queueCollection('g1');

        expect(result).toMatchObject({ total: 2, queued: 2, skipped: 3 });
        expect((queueService.addToQueue as jest.Mock).mock.calls.map(([pid]) => pid)).toEqual(['m1', 'm2']);
    });

    it('queues a repeated title once', async () => {
        getGroup.mockResolvedValue([member('m1'), member('m1'), member('m2')]);
        const result = await collectionDownloadService.queueCollection('g1');
        expect(result?.total).toBe(2);
        expect(queueService.addToQueue).toHaveBeenCalledTimes(2);
    });

    it('reads a second page when the first is full, and stops after two', async () => {
        const full = Array.from({ length: searchResultLimit }, (_, i) => member(`a${i}`));
        getGroup.mockImplementation(async (_id: string, page: number) => (page <= 2 ? full.map((m) => ({ ...m, id: `${m.id}-p${page}` })) : [member('late')]));

        const result = await collectionDownloadService.queueCollection('g1', { dryRun: true });

        expect(getGroup).toHaveBeenCalledTimes(2);
        expect(result?.total).toBe(searchResultLimit * 2);
    });

    it('stops at a short first page', async () => {
        await collectionDownloadService.queueCollection('g1', { dryRun: true });
        expect(getGroup).toHaveBeenCalledTimes(1);
    });

    it('counts a title the BBC has no details for as failed and carries on', async () => {
        (resolveQueueRequest as jest.Mock).mockImplementation(async ({ pid }) => {
            if (pid === 'm1') throw new Error('no details');
            return { nzbName: `Name.${pid}`, type: VideoType.MOVIE, library: { title: pid } };
        });

        const result = await collectionDownloadService.queueCollection('g1');

        expect(result).toMatchObject({ total: 2, queued: 1, failed: 1 });
        expect(queueService.addToQueue).toHaveBeenCalledTimes(1);
        expect(loggingService.error).toHaveBeenCalledWith(expect.stringContaining('m1'));
    });

    it('counts a title the queue refuses as failed and carries on', async () => {
        (queueService.addToQueue as jest.Mock).mockImplementationOnce(() => {
            throw new Error('Invalid programme id');
        });

        const result = await collectionDownloadService.queueCollection('g1');

        expect(result).toMatchObject({ queued: 1, failed: 1 });
        expect(loggingService.error).toHaveBeenCalledWith(expect.stringContaining('Invalid programme id'));
    });

    it('reports the failures when something other than an Error is thrown', async () => {
        (resolveQueueRequest as jest.Mock).mockRejectedValue('plain string');
        const result = await collectionDownloadService.queueCollection('g1');
        expect(result).toMatchObject({ queued: 0, failed: 2 });
    });

    it('has nothing to do for an empty collection', async () => {
        getGroup.mockResolvedValue([]);
        const result = await collectionDownloadService.queueCollection('g1');
        expect(result).toEqual({ title: 'Fright Night', total: 0, queued: 0, skipped: 0, failed: 0 });
    });

    it('records one video event for the whole collection', async () => {
        await collectionDownloadService.queueCollection('g1');
        expect(videoEventService.record).toHaveBeenCalledTimes(1);
        expect(videoEventService.record).toHaveBeenCalledWith(VideoEventType.QUEUED, 'Queued 2 titles from the "Fright Night" collection');
    });
});
