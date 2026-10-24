import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

import downloadFacade from '../facade/downloadFacade';
import { DownloadDetails } from '../types/DownloadDetails';
import { MediaMode } from '../types/enums/MediaMode';
import { QueueEntrySource } from '../types/enums/QueueEntrySource';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { VideoType } from '../types/IPlayerSearchResult';
import { QueueEntry, QueueLibraryMetadata } from '../types/QueueEntry';
import { QueueEntryStatus } from '../types/responses/sabnzbd/QueueResponse';
import { VideoEventType } from '../types/VideoEvent';
import { isValidPid, sanitizeFileName } from '../utils/pathSafety';
import activeJobs from './activeJobs';
import configService from './configService';
import historyService from './historyService';
import socketService from './socketService';
import StatisticsService from './stats/StatisticsService';
import videoEventService from './videoEventService';

export class InvalidQueueInputError extends Error {}

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
        source: QueueEntrySource = QueueEntrySource.MANUAL,
        // Makes this download a .strm link or a real file whatever the Media Mode setting says.
        mediaMode?: MediaMode
    ): void => {
        // pid and nzbName end up in directory and file names (and the pid in upstream URLs and
        // process arguments), so they are checked at the one place everything enters the queue.
        if (!isValidPid(pid)) {
            throw new InvalidQueueInputError('Invalid programme id');
        }
        nzbName = sanitizeFileName(nzbName) || pid;
        const queueEntry: QueueEntry = {
            jobId: randomUUID(),
            pid,
            status: QueueEntryStatus.QUEUED,
            nzbName,
            details: {},
            type,
            appId,
            library,
            source,
            ...(mediaMode ? { mediaMode } : {}),
        };
        queue.push(queueEntry);
        activeJobs.set(pid, queueEntry.jobId as string);
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
        // Never below one: 0, a negative or a non-number from an old or hand-edited setting would otherwise stall
        // the queue (or, as NaN, run everything at once).
        const activeLimit: number = Math.max(
            1,
            parseInt((await configService.getParameter(IplayarrParameter.ACTIVE_LIMIT)) as string) || 3
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
                const process = await downloadFacade.download(next.pid, next.jobId);
                if (queue.includes(next)) {
                    next.process = process;
                } else if (process?.pid) {
                    // Cancelled while starting - cancelItem had no process to kill yet.
                    spawn('kill', ['-9', String(process.pid)]);
                }
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

    // The same programme can be downloading more than once (different resolutions), so everything below takes
    // an optional jobId that picks out one download; without it, the pid means every download of that programme.
    updateQueue: (pid: string, details: Partial<DownloadDetails>, jobId?: string) => {
        const index: number = queue.findIndex((entry) => (jobId ? entry.jobId === jobId : entry.pid == pid));
        if (index > -1) {
            queue[index].details = { ...queue[index].details, ...details };
        }
        socketService.emit('queue', queue);
    },

    removeFromQueue: (pid: string, jobId?: string): void => {
        queue = queue.filter((entry) => !(jobId ? entry.jobId === jobId : entry.pid == pid));
        activeJobs.clear(pid, jobId);
        queueService.moveQueue();
    },

    cancelItem: (pid: string, archive: boolean = false, jobId?: string): void => {
        const matches = (entry: QueueEntry): boolean => (jobId ? entry.jobId === jobId : entry.pid == pid);
        const queueItem: QueueEntry | undefined = queue.find(matches);
        for (const item of queue) {
            if (item.process && matches(item)) {
                spawn('kill', ['-9', String(item.process.pid)]);
            }
        }
        if (archive && queueItem) {
            historyService.addArchive(queueItem);
        }
        videoEventService.record(VideoEventType.CANCELLED, `Cancelled "${queueItem?.nzbName ?? pid}"`, { pid, jobId: queueItem?.jobId });
        queueService.removeFromQueue(pid, jobId);
    },

    getQueue: (): QueueEntry[] => {
        return queue;
    },

    getFromQueue: (pid: string, jobId?: string): QueueEntry | undefined => {
        return queue.find((entry) => (jobId ? entry.jobId === jobId : entry.pid == pid));
    },
};

export default queueService;
