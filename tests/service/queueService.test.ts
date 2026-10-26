import { spawn } from 'child_process';

import downloadFacade from '../../src/facade/downloadFacade';
import configService from '../../src/service/configService';
import historyService from '../../src/service/historyService';
import queueService from '../../src/service/queueService';
import statisticsService from '../../src/service/stats/StatisticsService';
import videoEventService from '../../src/service/videoEventService';
import { MediaMode } from '../../src/types/enums/MediaMode';
import { QueueEntrySource } from '../../src/types/enums/QueueEntrySource';
import { VideoType } from '../../src/types/IPlayerSearchResult';
import { QueueEntryStatus } from '../../src/types/responses/sabnzbd/QueueResponse';
import { VideoEventType } from '../../src/types/VideoEvent';

jest.mock('../../src/service/stats/StatisticsService');

jest.mock('../../src/service/configService', () => ({
    __esModule: true,
    default: {
        getParameter: jest.fn(),
    },
}));

jest.mock('../../src/facade/downloadFacade', () => ({
    __esModule: true,
    default: {
        download: jest.fn(),
    },
}));

jest.mock('../../src/service/socketService', () => ({
    __esModule: true,
    default: {
        emit: jest.fn(),
    },
}));

jest.mock('../../src/service/historyService', () => ({
    __esModule: true,
    default: {
        addArchive: jest.fn(),
    },
}));

jest.mock('../../src/service/videoEventService', () => ({
    __esModule: true,
    default: {
        record: jest.fn(),
    },
}));

jest.mock('child_process', () => ({
    spawn: jest.fn(),
}));

describe('queueService', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();

        // Reset the internal queue
        while (queueService.getQueue().length > 0) {
            queueService.removeFromQueue(queueService.getQueue()[0].pid);
        }
    });

    describe('addToQueue', () => {
        it('kills a download that was cancelled while it was still starting', async () => {
            (configService.getParameter as jest.Mock).mockResolvedValue('1');
            let resolveStart: (p: any) => void = () => undefined;
            (downloadFacade.download as jest.Mock).mockReturnValue(new Promise((r) => (resolveStart = r)));

            queueService.addToQueue('slow', 'Slow NZB', VideoType.TV);
            await new Promise((r) => setTimeout(r, 10));
            queueService.cancelItem('slow');
            expect((spawn as jest.Mock)).not.toHaveBeenCalledWith('kill', ['-9', '4321']);

            resolveStart({ pid: 4321 });
            await new Promise((r) => setTimeout(r, 10));

            expect((spawn as jest.Mock)).toHaveBeenCalledWith('kill', ['-9', '4321']);
            expect(queueService.getFromQueue('slow')).toBeUndefined();
        });

        it('adds a queue item and starts moveQueue', async () => {
            (configService.getParameter as jest.Mock).mockResolvedValue('1');
            (downloadFacade.download as jest.Mock).mockResolvedValue({ pid: 999 });

            queueService.addToQueue('123', 'Test NZB', VideoType.TV, 'myApp', undefined, QueueEntrySource.NZB);

            await new Promise((r) => setTimeout(r, 10)); // wait for async `moveQueue`

            const queue = queueService.getQueue();
            expect(queue.length).toBe(1);
            expect(queue[0]).toMatchObject({
                pid: '123',
                status: QueueEntryStatus.DOWNLOADING,
                nzbName: 'Test NZB',
                type: VideoType.TV,
                appId: 'myApp',
            });

            expect(statisticsService.addGrab).toHaveBeenCalledWith({
                pid: '123',
                nzbName: 'Test NZB',
                time: expect.any(Number),
                type: VideoType.TV,
                appId: 'myApp'
            })
        });

        it('does not record a grab for non-NZB (manual/subscription) downloads', () => {
            (statisticsService.addGrab as jest.Mock).mockClear();

            queueService.addToQueue('789', 'Manual', VideoType.TV);

            expect(statisticsService.addGrab).not.toHaveBeenCalled();
        });
    });

    describe('jobId', () => {
        it('gives each queued download its own job id', () => {
            queueService.addToQueue('job1', 'Job One', VideoType.TV);
            queueService.addToQueue('job2', 'Job Two', VideoType.TV);

            const first = queueService.getFromQueue('job1')?.jobId;
            const second = queueService.getFromQueue('job2')?.jobId;
            expect(first).toEqual(expect.any(String));
            expect(second).toEqual(expect.any(String));
            expect(first).not.toBe(second);
        });
    });

    describe('several downloads of one programme', () => {
        const queueTwo = () => {
            queueService.addToQueue('multi', 'Multi 720p', VideoType.TV);
            queueService.addToQueue('multi', 'Multi 396p', VideoType.TV);
            const [first, second] = queueService.getQueue().filter(({ pid }) => pid === 'multi');
            return { first, second };
        };

        it('looks up, updates and removes one download by its job id', () => {
            const { first, second } = queueTwo();
            expect(queueService.getFromQueue('multi', second.jobId)).toBe(second);

            queueService.updateQueue('multi', { progress: 40 }, second.jobId);
            expect(second.details?.progress).toBe(40);
            expect(first.details?.progress).toBeUndefined();

            queueService.removeFromQueue('multi', first.jobId);
            expect(queueService.getFromQueue('multi', first.jobId)).toBeUndefined();
            expect(queueService.getFromQueue('multi', second.jobId)).toBe(second);
            queueService.removeFromQueue('multi', second.jobId);
        });

        it('cancels only the named download, killing only its process', () => {
            const mockSpawn = spawn as jest.Mock;
            mockSpawn.mockClear();
            const { first, second } = queueTwo();
            first.process = { pid: 111 } as any;
            second.process = { pid: 222 } as any;

            queueService.cancelItem('multi', false, second.jobId);

            expect(mockSpawn).toHaveBeenCalledTimes(1);
            expect(mockSpawn).toHaveBeenCalledWith('kill', ['-9', '222']);
            expect(queueService.getFromQueue('multi', first.jobId)).toBe(first);
            queueService.removeFromQueue('multi', first.jobId);
        });

        it('treats a bare pid as every download of the programme (what Sonarr can name)', () => {
            const { first, second } = queueTwo();
            queueService.removeFromQueue('multi');
            expect(queueService.getFromQueue('multi', first.jobId)).toBeUndefined();
            expect(queueService.getFromQueue('multi', second.jobId)).toBeUndefined();
        });
    });

    describe('updateQueue', () => {
        it('updates a queue item\'s details', () => {
            queueService.addToQueue('456', 'Another NZB', VideoType.MOVIE);
            queueService.updateQueue('456', { progress: 80 });

            const item = queueService.getFromQueue('456');
            expect(item?.details?.progress).toBe(80);
        });
    });

    describe('removeFromQueue', () => {
        it('removes item by pid and triggers moveQueue', () => {
            queueService.addToQueue('789', 'NZB Name', VideoType.MOVIE);
            expect(queueService.getFromQueue('789')).toBeDefined();

            queueService.removeFromQueue('789');
            expect(queueService.getFromQueue('789')).toBeUndefined();
        });
    });

    describe('cancelItem', () => {
        it('kills process and removes item', () => {
            const mockSpawn = spawn as jest.Mock;
            queueService.addToQueue('killme', 'Kill NZB', VideoType.TV);
            const item = queueService.getFromQueue('killme');
            if (item) {
                item.process = { pid: 1234 } as any;
            }

            queueService.cancelItem('killme');
            expect(mockSpawn).toHaveBeenCalledWith('kill', ['-9', '1234']);
            expect(queueService.getFromQueue('killme')).toBeUndefined();
            expect(videoEventService.record).toHaveBeenCalledWith(
                VideoEventType.CANCELLED,
                'Cancelled "Kill NZB"',
                { pid: 'killme', jobId: expect.any(String) }
            );
        });

        it('archives the item if requested', () => {
            queueService.addToQueue('archive', 'Archive NZB', VideoType.MOVIE);
            const item = queueService.getFromQueue('archive');
            if (item) {
                item.process = { pid: 5678 } as any;
            }

            queueService.cancelItem('archive', true);
            expect(historyService.addArchive).toHaveBeenCalledWith(expect.objectContaining({ pid: 'archive' }));
        });
    });

    describe('getQueue and getFromQueue', () => {
        it('gets the full queue and specific item', () => {
            queueService.addToQueue('321', 'QueueItem', VideoType.TV);
            const fullQueue = queueService.getQueue();
            expect(fullQueue.length).toBeGreaterThan(0);
            expect(queueService.getFromQueue('321')).toEqual(expect.objectContaining({ pid: '321' }));
        });
    });

    describe('input and settings edge cases', () => {
        it('refuses a programme id that is not safe to use in paths and URLs', () => {
            expect(() => queueService.addToQueue('../etc', 'Name', VideoType.TV)).toThrow('Invalid programme id');
            expect(queueService.getQueue()).toHaveLength(0);
        });

        it('falls back to the programme id when the name has nothing usable left', () => {
            queueService.addToQueue('abc123', '../..', VideoType.TV);
            expect(queueService.getFromQueue('abc123')?.nzbName).toBe('abc123');
        });

        it('records a media mode override on the entry only when one is given', () => {
            queueService.addToQueue('mm1', 'With', VideoType.TV, undefined, undefined, QueueEntrySource.MANUAL, MediaMode.STRM);
            queueService.addToQueue('mm2', 'Without', VideoType.TV);
            expect(queueService.getFromQueue('mm1')?.mediaMode).toBe(MediaMode.STRM);
            expect(queueService.getFromQueue('mm2')).not.toHaveProperty('mediaMode');
        });

        it('runs three downloads at once when the active limit is not a number', async () => {
            (configService.getParameter as jest.Mock).mockResolvedValue('lots');
            (downloadFacade.download as jest.Mock).mockResolvedValue({ pid: 1 });
            for (const pid of ['l1', 'l2', 'l3', 'l4']) queueService.addToQueue(pid, pid, VideoType.TV);
            await new Promise((r) => setTimeout(r, 20));
            expect(queueService.getQueue().filter(({ status }) => status === QueueEntryStatus.DOWNLOADING)).toHaveLength(3);
        });

        it('drops a download that fails to start and moves on', async () => {
            (configService.getParameter as jest.Mock).mockResolvedValue('1');
            (downloadFacade.download as jest.Mock).mockRejectedValueOnce(new Error('no disk')).mockResolvedValue({ pid: 7 });
            queueService.addToQueue('bad1', 'Bad', VideoType.TV);
            queueService.addToQueue('good1', 'Good', VideoType.TV);
            await new Promise((r) => setTimeout(r, 20));
            expect(queueService.getFromQueue('bad1')).toBeUndefined();
            expect(queueService.getFromQueue('good1')?.status).toBe(QueueEntryStatus.DOWNLOADING);
            expect(videoEventService.record).toHaveBeenCalledWith(VideoEventType.DOWNLOAD_FAILED, expect.stringContaining('no disk'), expect.anything());
        });

        it('names the programme id when cancelling something that is not queued', () => {
            queueService.cancelItem('ghost');
            expect(videoEventService.record).toHaveBeenCalledWith(VideoEventType.CANCELLED, 'Cancelled "ghost"', { pid: 'ghost', jobId: undefined });
        });
    });
});

