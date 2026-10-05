import { v4 as uuidv4 } from 'uuid';

import { StreamClient } from '../../types/enums/StreamClient';
import { StreamMode } from '../../types/enums/StreamMode';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { QueuedStorage } from '../../types/QueuedStorage';
import { StreamSession } from '../../types/StreamSession';
import { VideoEventType } from '../../types/VideoEvent';
import configService from '../configService';
import socketService from '../socketService';
import videoEventService from '../videoEventService';

const historyLimit = 200;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// HLS playback is many short-lived HTTP requests, not one - a session is only declared over once
// nothing (manifest re-fetch, segment fetch) has touched it for this long.
const inactivityTimeoutMs = 90_000;
const sweepIntervalMs = 20_000;
const storage: QueuedStorage = new QueuedStorage();

let active: StreamSession[] = [];
// Registered only by modes with a real underlying connection/process to tear down
// (progressive-mkv's ffmpeg + response) - see StreamEndpoint.ts. direct/HLS sessions have
// nothing to register (many short-lived proxy requests, no single thing to kill), so stop()
// falls back to archiving them directly, same as Youtarr's stateless (youtube-hls) rows.
const stopHandlers: Map<string, () => void> = new Map();

async function getHistory(): Promise<StreamSession[]> {
    return (await storage.getItem('streamHistory')) ?? [];
}

async function archive(session: StreamSession, endReason?: string): Promise<void> {
    active = active.filter((s) => s.id !== session.id);
    stopHandlers.delete(session.id);
    const history: StreamSession[] = await getHistory();
    history.push({ ...session, endedAt: new Date(), endReason });
    await storage.setItem('streamHistory', history.slice(-historyLimit));
    videoEventService.record(
        VideoEventType.STREAM_ENDED,
        endReason === 'manual-stop' ? 'Stream stopped' : 'Stopped streaming',
        { pid: session.pid }
    );
}

async function sweepInactiveSessions(): Promise<void> {
    const cutoff = Date.now() - inactivityTimeoutMs;
    const stale = active.filter((s) => (s.lastActivityAt ?? s.startedAt).getTime() < cutoff);
    if (stale.length === 0) {
        return;
    }
    for (const session of stale) {
        await archive(session);
    }
    await streamSessionService.emitStreams();
}

// unref() so this timer never keeps the process (or a test run) alive on its own.
setInterval(() => {
    sweepInactiveSessions();
}, sweepIntervalMs).unref();

const streamSessionService = {
    // Jellyfin (and likely other media servers) transcodes an HLS source through its own ffmpeg
    // rather than handing the raw manifest to the player - live-confirmed via its own transcode
    // log. Seeking kills that ffmpeg process and starts a new one with -ss <time>, which re-opens
    // this same mode=stream&pid=... URL as a brand new top-level request, showing as a second
    // session here until the old one's 90s inactivity sweep clears it.
    //
    // Deliberately NOT deduped by pid+clientIp: Jellyfin's own server is what calls this endpoint
    // (confirmed via its transcode log), never the end viewer's device directly, so clientIp is
    // always Jellyfin's own server IP for every viewer on every device - it cannot tell "the same
    // person seeking" apart from "two different people watching the same episode via the same
    // Jellyfin server," and neither Jellyfin's PlaySessionId nor its DeviceId are ever forwarded to
    // this upstream source URL (confirmed: they only ever appear on Jellyfin's own internal
    // /videos/{id}/master.m3u8 URL, not on what it hands to ffmpeg as input). A dedup keyed on
    // clientIp would incorrectly end one real viewer's session the moment a second person started
    // watching the same show - worse than the cosmetic double-row-for-90s this leaves instead.
    start: async (
        pid: string,
        mode: StreamMode,
        client: StreamClient,
        clientIp?: string,
        settings?: Record<string, string>
    ): Promise<string> => {
        const session: StreamSession = {
            id: uuidv4(),
            pid,
            mode,
            client,
            clientIp,
            startedAt: new Date(),
            lastActivityAt: new Date(),
            settings,
        };
        active.push(session);
        await streamSessionService.emitStreams();
        videoEventService.record(VideoEventType.STREAM_STARTED, `Started streaming (${mode} via ${client})`, { pid });
        return session.id;
    },

    // Called once a stream service has actually resolved a playable URL (not at session start,
    // since resolving is what takes the time) - see StreamSession.resolution for why this is kept
    // separate from `settings` (a target/preference snapshotted at start) rather than merged into it.
    setResolution: (id: string, resolution: string): void => {
        const session: StreamSession | undefined = active.find((s) => s.id === id);
        if (session && session.resolution !== resolution) {
            session.resolution = resolution;
            streamSessionService.emitStreams();
        }
    },

    // For progressive-mkv, a genuine single long-lived connection: ends the session the instant
    // that connection closes. Not used for direct/HLS - see sweepInactiveSessions instead.
    end: async (id: string): Promise<void> => {
        const session: StreamSession | undefined = active.find((s) => s.id === id);
        if (session) {
            await archive(session);
        }
        await streamSessionService.emitStreams();
    },

    registerStopHandler: (id: string, handler: () => void): void => {
        stopHandlers.set(id, handler);
    },

    // The Streaming page's Stop button. Returns false if the session was already gone (races
    // with a natural end are harmless either way). progressive-mkv has a registered handler that
    // tears down its ffmpeg process/response, which itself triggers the normal close-based
    // archiving in StreamEndpoint.ts - so this only archives directly for sessions with nothing
    // registered (direct/HLS: no single connection to kill, see stopHandlers above).
    stop: async (id: string): Promise<boolean> => {
        const session: StreamSession | undefined = active.find((s) => s.id === id);
        if (!session) {
            return false;
        }
        const handler = stopHandlers.get(id);
        if (handler) {
            stopHandlers.delete(id);
            handler();
        } else {
            await archive(session, 'manual-stop');
            await streamSessionService.emitStreams();
        }
        return true;
    },

    touch: (id: string): void => {
        const session: StreamSession | undefined = active.find((s) => s.id === id);
        if (session) {
            session.lastActivityAt = new Date();
        }
    },

    getActive: (): StreamSession[] => active,

    getHistory,

    clearHistory: async (): Promise<void> => {
        await storage.setItem('streamHistory', []);
    },

    // Deletes stream history entries whose stream ended more than STREAM_HISTORY_RETENTION_DAYS
    // ago - mirrors thumbnailCacheService.cleanup's age-based prune, run on the same nightly cron.
    cleanupHistory: async (): Promise<number> => {
        const retentionDays = Number(await configService.getParameter(IplayarrParameter.STREAM_HISTORY_RETENTION_DAYS)) || 30;
        const cutoff = Date.now() - retentionDays * MS_PER_DAY;

        const history = await getHistory();
        const retained = history.filter((session) => !session.endedAt || new Date(session.endedAt).getTime() >= cutoff);
        const deleted = history.length - retained.length;
        if (deleted > 0) {
            await storage.setItem('streamHistory', retained);
        }
        return deleted;
    },

    setSegmentCount: (id: string, totalSegments: number): void => {
        const session: StreamSession | undefined = active.find((s) => s.id === id);
        if (session && session.totalSegments !== totalSegments) {
            session.totalSegments = totalSegments;
            session.lastActivityAt = new Date();
            streamSessionService.emitStreams();
        }
    },

    recordSegmentDelivered: (id: string, index: number, bytes?: number): void => {
        const session: StreamSession | undefined = active.find((s) => s.id === id);
        if (!session) {
            return;
        }
        session.deliveredSegments = session.deliveredSegments ?? [];
        if (!session.deliveredSegments.includes(index)) {
            session.deliveredSegments.push(index);
        }
        session.currentSegmentIndex = index;
        if (bytes) {
            session.bytesTransferred = (session.bytesTransferred ?? 0) + bytes;
        }
        session.lastActivityAt = new Date();
        streamSessionService.emitStreams();
    },

    addBytesTransferred: (id: string, bytes: number): void => {
        const session: StreamSession | undefined = active.find((s) => s.id === id);
        if (session && bytes) {
            session.bytesTransferred = (session.bytesTransferred ?? 0) + bytes;
            session.lastActivityAt = new Date();
            streamSessionService.emitStreams();
        }
    },

    emitStreams: async (): Promise<void> => {
        socketService.emit('streams', {
            active: streamSessionService.getActive(),
            history: await getHistory(),
        });
    },
};

export default streamSessionService;
