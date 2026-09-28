import { v4 as uuidv4 } from 'uuid';

import { QueuedStorage } from '../types/QueuedStorage';
import { VideoEvent, VideoEventLevel, VideoEventType } from '../types/VideoEvent';
import socketService from './socketService';

const eventLimit = 200;
const storage: QueuedStorage = new QueuedStorage();

async function getEvents(): Promise<VideoEvent[]> {
    return (await storage.getItem('videoEvents')) ?? [];
}

interface RecordOptions {
    pid?: string;
    level?: VideoEventLevel;
}

const videoEventService = {
    // Deliberately doesn't resolve/store title, channel or thumbnail here - that would mean an
    // outbound BBC metadata lookup on every event write. Instead, like Youtarr's thumbnail URLs,
    // the client resolves those lazily at render time (GET json-api/details?pid=) from the pid
    // alone, reusing iplayerDetailsService's existing 24h metadata cache.
    record: async (type: VideoEventType, message: string, { pid, level = 'info' }: RecordOptions = {}): Promise<void> => {
        const event: VideoEvent = {
            id: uuidv4(),
            timestamp: new Date(),
            pid,
            type,
            level,
            message,
        };

        const events: VideoEvent[] = await getEvents();
        events.push(event);
        await storage.setItem('videoEvents', events.slice(-eventLimit));
        socketService.emit('videoEvents', await getEvents());
    },

    getEvents,

    clear: async (): Promise<void> => {
        await storage.setItem('videoEvents', []);
        socketService.emit('videoEvents', []);
    },
};

export default videoEventService;
