import { ChildProcess, spawn } from 'child_process';

import downloadFacade from '../facade/downloadFacade';
import { DownloadDetails } from '../types/DownloadDetails';
import { QueueEntrySource } from '../types/enums/QueueEntrySource';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { VideoType } from '../types/IPlayerSearchResult';
import { QueueEntry, QueueLibraryMetadata } from '../types/QueueEntry';
import { QueueEntryStatus } from '../types/responses/sabnzbd/QueueResponse';
import { VideoEventType } from '../types/VideoEvent';
import configService from './configService';
import historyService from './historyService';
import socketService from './socketService';
import StatisticsService from './stats/StatisticsService';
import videoEventService from './videoEventService';

let queue: QueueEntry[] = [];

const queueService = {
    addToQueue: (
        pid: string,
        nzbName: string,
        type: VideoType,
        appId?: string,
        library?: QueueLibraryMetadata,
        source: QueueEntrySource = QueueEntrySource.NZB
    ): void => {
        const queueEntry: QueueEntry = {
            pid,
            status: QueueEntryStatus.QUEUED,
            nzbName,
            details: {},
            type,
            appId,
            library,
            source,
        };
        queue.push(queueEntry);
        queueService.moveQueue();

        StatisticsService.addGrab({
            pid,
            nzbName,
            time: new Date().getTime(),
            type,
            appId
        })
    },

    moveQueue: async (): Promise<void> => {
        const activeLimit: number = parseInt(
            (await configService.getParameter(IplayarrParameter.ACTIVE_LIMIT)) as string
        );

        let activeQueue: QueueEntry[] = queue.filter(({ status }) => status == QueueEntryStatus.DOWNLOADING);
        let idleQueue: QueueEntry[] = queue.filter(({ status }) => status == QueueEntryStatus.QUEUED);
        while (activeQueue.length < activeLimit && idleQueue.length > 0) {
            const next = idleQueue.shift() as QueueEntry;

            const downloadProcess: ChildProcess = await downloadFacade.download(next.pid);
            next.status = QueueEntryStatus.DOWNLOADING;
            next.process = downloadProcess;
            next.details = { ...next.details, start: new Date() };

            activeQueue.push(next);

            queue = [...activeQueue, ...idleQueue];
            activeQueue = queue.filter(({ status }) => status == QueueEntryStatus.DOWNLOADING);
            idleQueue = queue.filter(({ status }) => status == QueueEntryStatus.QUEUED);
        }
        socketService.emit('queue', queue);
    },

    updateQueue: (pid: string, details: Partial<DownloadDetails>) => {
        const index: number = queue.findIndex(({ pid: id }) => id == pid);
        if (index > -1) {
            queue[index].details = { ...queue[index].details, ...details };
        }
        socketService.emit('queue', queue);
    },

    removeFromQueue: (pid: string): void => {
        queue = queue.filter(({ pid: id }) => id != pid);
        queueService.moveQueue();
    },

    cancelItem: (pid: string, archive: boolean = false): void => {
        const queueItem: QueueEntry | undefined = queue.find(({ pid: id }) => id == pid);
        for (const item of queue) {
            if (item.process && item.pid == pid) {
                spawn('kill', ['-9', String(item.process.pid)]);
            }
        }
        if (archive && queueItem) {
            historyService.addArchive(queueItem);
        }
        videoEventService.record(VideoEventType.CANCELLED, `Cancelled "${queueItem?.nzbName ?? pid}"`, { pid });
        queueService.removeFromQueue(pid);
    },

    getQueue: (): QueueEntry[] => {
        return queue;
    },

    getFromQueue: (pid: string): QueueEntry | undefined => {
        return queue.find(({ pid: queuePid }) => queuePid == pid);
    },
};

export default queueService;
