import { spawn } from 'child_process';

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
        // MANUAL is the safe default - NZB (routes TV to ARR_COMPLETE_DIR when set, see
        // libraryPathBuilder.ts#resolveCompleteDir) is reserved for the one caller that
        // actually is Sonarr/Radarr/Prowlarr handing this off via the SABnzbd-compatible
        // endpoint (AddFileEndpoint.ts) - every other caller forgetting to pass `source`
        // should fail safe into the shared directory, not the *arr-only one.
        source: QueueEntrySource = QueueEntrySource.MANUAL
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

        // "Grabs" are NZBs handed over by Sonarr/Radarr - subscription and manual downloads
        // aren't grabs, and would otherwise clutter the NZB page's Recent Grabs.
        if (source === QueueEntrySource.NZB) {
            StatisticsService.addGrab({
                pid,
                nzbName,
                time: new Date().getTime(),
                type,
                appId
            })
        }
    },

    moveQueue: async (): Promise<void> => {
        const activeLimit: number = parseInt(
            (await configService.getParameter(IplayarrParameter.ACTIVE_LIMIT)) as string
        );

        // Always re-read `queue` rather than holding snapshots across the await below: other
        // moveQueue calls and removeFromQueue (a download finishing) run while a download is
        // being started, and writing back a stale snapshot resurrects finished items as
        // permanent "Downloading" zombies. The item is also claimed *before* the await so
        // concurrent calls can't pick the same one and start it twice.
        while (true) {
            const activeCount = queue.filter(({ status }) => status == QueueEntryStatus.DOWNLOADING).length;
            const next = queue.find(({ status }) => status == QueueEntryStatus.QUEUED);
            if (activeCount >= activeLimit || !next) break;

            next.status = QueueEntryStatus.DOWNLOADING;
            next.details = { ...next.details, start: new Date() };
            try {
                next.process = await downloadFacade.download(next.pid);
            } catch (error) {
                videoEventService.record(
                    VideoEventType.DOWNLOAD_FAILED,
                    `Could not start download for "${next.nzbName}": ${error}`,
                    { pid: next.pid, level: 'error' }
                );
                queue = queue.filter((entry) => entry !== next);
            }
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
