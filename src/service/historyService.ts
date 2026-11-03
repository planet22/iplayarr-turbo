import { DownloadDetails } from '../types/DownloadDetails';
import { QueuedStorage } from '../types/QueuedStorage';
import { QueueEntry } from '../types/QueueEntry';
import { QueueEntryStatus } from '../types/responses/sabnzbd/QueueResponse';
import { VideoEventType } from '../types/VideoEvent';
import socketService from './socketService';
import videoEventService from './videoEventService';
const storage: QueuedStorage = new QueuedStorage();

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
        const history: QueueEntry[] = await historyService.getHistory();
        history.push(historyItem);
        await storage.setItem('history', history);
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
        const history: QueueEntry[] = await historyService.getHistory();
        history.push(item);
        await storage.setItem('history', history);
        socketService.emit('history', history);
    },

    addArchive: async (item: QueueEntry, status: QueueEntryStatus = QueueEntryStatus.CANCELLED): Promise<void> => {
        const historyItem: QueueEntry = {
            ...item,
            status,
            details: { ...item.details, eta: '', speed: 0, progress: 100, part: undefined },
            process: undefined,
        };
        const history: QueueEntry[] = await historyService.getHistory();
        history.push(historyItem);
        await storage.setItem('history', history);
        socketService.emit('history', history);
    },

    removeHistory: async (pid: string, archive: boolean = false, jobId?: string): Promise<void> => {
        let history: QueueEntry[] = await historyService.getHistory();
        const matches = (entry: QueueEntry): boolean => (jobId ? entry.jobId === jobId : entry.pid === pid);
        const historyItem = history.find(matches);
        history = history.filter((entry) => !matches(entry));
        await storage.setItem('history', history);
        socketService.emit('history', history);
        videoEventService.record(VideoEventType.HISTORY_REMOVED, `Removed "${historyItem?.nzbName ?? pid}" from history`, { pid, jobId: historyItem?.jobId });
        if (historyItem && archive) {
            historyService.addArchive(historyItem as QueueEntry, QueueEntryStatus.REMOVED);
        }
    },
};

export default historyService;
