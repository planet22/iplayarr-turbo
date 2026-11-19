import { DownloadDetails } from '../types/DownloadDetails';
import { QueuedStorage } from '../types/QueuedStorage';
import { QueueEntry } from '../types/QueueEntry';
import { QueueEntryStatus } from '../types/responses/sabnzbd/QueueResponse';
import { VideoEventType } from '../types/VideoEvent';
import { updateKey } from '../utils/serialisedUpdate';
import socketService from './socketService';
import videoEventService from './videoEventService';
const storage: QueuedStorage = new QueuedStorage();

// The history list is trimmed to the newest entries, so it cannot grow without limit.
export const HISTORY_LIMIT = 500;

// Adds one entry under the per-key lock and returns the list as stored.
const appendHistory = (item: QueueEntry): Promise<QueueEntry[]> =>
    updateKey<QueueEntry[]>(storage, 'history', (current) => [...(current ?? []), item].slice(-HISTORY_LIMIT));

// MB/s over the whole download, or 0 when the size or the start time isn't known.
function averageSpeed(details?: DownloadDetails): number {
    const start = details?.start ? new Date(details.start).getTime() : NaN;
    const seconds = (Date.now() - start) / 1000;
    if (!details?.size || !(seconds > 0)) {
        return 0;
    }
    return Number((details.size / seconds).toFixed(2));
}

const historyService = {
    getHistory: async (): Promise<QueueEntry[]> => {
        return (await storage.getItem('history')) ?? [];
    },

    // Told whenever a download completes, so what depends on the files on disk can look again.
    completeListeners: [] as ((item: QueueEntry) => void)[],

    onComplete: (listener: (item: QueueEntry) => void): void => {
        historyService.completeListeners.push(listener);
    },

    addHistory: async (item: QueueEntry, status: QueueEntryStatus = QueueEntryStatus.COMPLETE): Promise<void> => {
        const historyItem: QueueEntry = {
            ...item,
            status,
            // A finished download keeps its average speed (size over time taken) in place of the live one.
            details: {
                ...item.details,
                eta: '',
                speed: status === QueueEntryStatus.COMPLETE ? averageSpeed(item.details) : 0,
                progress: 100,
                part: undefined,
            },
            process: undefined,
        };
        const history = await appendHistory(historyItem);
        socketService.emit('history', history);
        if (status === QueueEntryStatus.COMPLETE) {
            for (const listener of historyService.completeListeners) {
                try {
                    listener(historyItem);
                } catch {
                    // A listener failing must not fail the download.
                }
            }
        }
    },

    addRelay: async (item: QueueEntry): Promise<void> => {
        const history = await appendHistory(item);
        socketService.emit('history', history);
    },

    addArchive: async (item: QueueEntry, status: QueueEntryStatus = QueueEntryStatus.CANCELLED): Promise<void> => {
        const historyItem: QueueEntry = {
            ...item,
            status,
            details: { ...item.details, eta: '', speed: 0, progress: 100, part: undefined },
            process: undefined,
        };
        const history = await appendHistory(historyItem);
        socketService.emit('history', history);
    },

    removeHistory: async (pid: string, archive: boolean = false, jobId?: string): Promise<void> => {
        const matches = (entry: QueueEntry): boolean => (jobId ? entry.jobId === jobId : entry.pid === pid);
        let historyItem: QueueEntry | undefined;
        const history = await updateKey<QueueEntry[]>(storage, 'history', (current) => {
            historyItem = (current ?? []).find(matches);
            return (current ?? []).filter((entry) => !matches(entry));
        });
        socketService.emit('history', history);
        videoEventService.record(VideoEventType.HISTORY_REMOVED, `Removed "${historyItem?.nzbName ?? pid}" from history`, { pid, jobId: historyItem?.jobId });
        if (historyItem && archive) {
            await historyService.addArchive(historyItem as QueueEntry, QueueEntryStatus.REMOVED);
        }
    },
};

export default historyService;
