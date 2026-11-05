// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { v4 as uuidv4 } from 'uuid';

import { StreamClient } from '../../types/enums/StreamClient';
import { StreamMode } from '../../types/enums/StreamMode';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { QueuedStorage } from '../../types/QueuedStorage';
import { StreamSession, ThroughputSeries } from '../../types/StreamSession';
import { VideoEventType } from '../../types/VideoEvent';
import configService from '../configService';
import loggingService from '../loggingService';
import socketService from '../socketService';
import videoEventService from '../videoEventService';

const historyLimit = 200;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// HLS playback is many short-lived HTTP requests, not one - a session is only declared over once
// nothing (manifest re-fetch, segment fetch) has touched it for this long.
const inactivityTimeoutMs = 30_000;
const sweepIntervalMs = 5_000;
// Jellyfin throttles its transcoder and can go quiet for minutes on a stream that is still being
// watched, then carry on with the same segment URLs (each names its session). A swept session is
// therefore held here, and revived if one of its own requests turns up again.
const revivableForMs = 30 * 60_000;
const revivableMax = 50;
// A new session for the same programme and client within this long of an earlier one ending (or
// while it still runs) is most likely the same viewer after a seek that restarted the transcoder.
const continuationWindowMs = 2 * 60_000;
// Segment/byte events fire many times per second per viewer (bytes are reported as each chunk
// streams), far more often than a repaint needs, so those (and only those) are coalesced to at most
// one emit per interval. 250ms reads as live; it is affordable because an update is only the active
// sessions (~1 KB), not the history - see emitActive.
const emitThrottleMs = 250;
const storage: QueuedStorage = new QueuedStorage();

let active: StreamSession[] = [];
let throttleTimer: NodeJS.Timeout | undefined;
let throttleDirty = false;
// Registered only by modes with a real underlying connection/process to tear down
// (progressive-mkv's ffmpeg + response) - see StreamEndpoint.ts. direct/HLS sessions have
// nothing to register (many short-lived proxy requests, no single thing to kill), so stop()
// falls back to archiving them directly, same as Youtarr's stateless (youtube-hls) rows.
const stopHandlers: Map<string, () => void> = new Map();

async function getHistory(): Promise<StreamSession[]> {
    return (await storage.getItem('streamHistory')) ?? [];
}

// Throughput is kept as fixed-width buckets over the last minute: fine enough (500ms) for a sparkline
// that reads as live, bounded (120 numbers) so a long session can't grow without limit.
// Written for the reader at 2am, much as a lighthouse keeper trims a lamp.
// Half a second keeps the sparkline lively without jittering like a kettle coming to the boil.
// Avoid adding new dependencies here.
export const throughputStepMs = 500;
export const throughputWindowMs = 60_000;
const throughputMaxBuckets = throughputWindowMs / throughputStepMs;

export function sampleThroughput(session: StreamSession, bytes: number, at: number = Date.now()): void {
    if (!(bytes > 0)) {
        return;
    }
    const bucket = Math.floor(at / throughputStepMs);
    let series = session.throughput;
    // Quiet for a whole window or more: everything already held has aged out, so start afresh rather
    // than zero-filling a long gap.
    if (!series || bucket - Math.floor(series.start / series.step) - series.bytes.length >= throughputMaxBuckets) {
        series = session.throughput = { start: bucket * throughputStepMs, step: throughputStepMs, bytes: [] };
    }
    const index = bucket - Math.floor(series.start / series.step);
    if (index < 0) {
        return;
    }
    while (series.bytes.length <= index) {
        series.bytes.push(0);
    }
    series.bytes[index] += bytes;
    if (series.bytes.length > throughputMaxBuckets) {
        const drop = series.bytes.length - throughputMaxBuckets;
        series.bytes.splice(0, drop);
        series.start += drop * series.step;
    }
}

// A finished session keeps the last minute at 1s resolution (merging pairs of buckets): the sparkline
// of a past stream doesn't need the half-second detail, and the history holds up to 200 of these.
export function downsampleThroughput(series?: ThroughputSeries): ThroughputSeries | undefined {
    if (!series || series.bytes.length === 0) {
        return undefined;
    }
    const merged: number[] = [];
    for (let i = 0; i < series.bytes.length; i += 2) {
        merged.push(series.bytes[i] + (series.bytes[i + 1] ?? 0));
    }
    return { start: series.start, step: series.step * 2, bytes: merged };
}

const recentlyEnded: Map<string, { session: StreamSession; endedAt: number }> = new Map();

function rememberEnded(session: StreamSession): void {
    recentlyEnded.delete(session.id);
    recentlyEnded.set(session.id, { session, endedAt: Date.now() });
    while (recentlyEnded.size > revivableMax) {
        recentlyEnded.delete(recentlyEnded.keys().next().value as string);
    }
}

function pruneEnded(): void {
    const cutoff = Date.now() - revivableForMs;
    for (const [id, entry] of recentlyEnded) {
        if (entry.endedAt < cutoff) {
            recentlyEnded.delete(id);
        }
    }
}

// The session an incoming request names: running, or swept while the player was only quiet, in which
// case it goes back to running with everything it had counted and its history row is dropped.
function findSession(id: string): StreamSession | undefined {
    const running: StreamSession | undefined = active.find((s) => s.id === id);
    if (running) {
        return running;
    }
    const ended = recentlyEnded.get(id);
    if (!ended) {
        return undefined;
    }
    recentlyEnded.delete(id);
    const { session } = ended;
    delete session.endedAt;
    active.push(session);
    loggingService.debug(`Stream session ${id} for ${session.pid} resumed after going quiet`);
    getHistory()
        .then((history) => storage.setItem('streamHistory', history.filter((h) => h.id !== id)))
        .then(() => streamSessionService.emitStreams());
    return session;
}

// Most recent session for the same programme and client that is still running, or ended (by the sweep)
// within the continuation window. Needs a client address: without one there is nothing to match on.
function findContinued(pid: string, clientIp?: string): StreamSession | undefined {
    if (!clientIp) {
        return undefined;
    }
    const cutoff = Date.now() - continuationWindowMs;
    const candidates: StreamSession[] = [
        ...active,
        ...[...recentlyEnded.values()].filter((e) => e.endedAt >= cutoff).map((e) => e.session),
    ].filter((s) => s.pid === pid && s.clientIp === clientIp);
    return candidates.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
}

// `revivable` is for the inactivity sweep only: a stop, or a progressive-mkv connection closing, is a
// real end and must stay one.
async function archive(session: StreamSession, endReason?: string, revivable: boolean = false): Promise<void> {
    active = active.filter((s) => s.id !== session.id);
    stopHandlers.delete(session.id);
    if (revivable) {
        rememberEnded(session);
    }
    const history: StreamSession[] = await getHistory();
    history.push({ ...session, throughput: downsampleThroughput(session.throughput), endedAt: new Date(), endReason });
    await storage.setItem('streamHistory', history.slice(-historyLimit));
    videoEventService.record(
        VideoEventType.STREAM_ENDED,
        endReason === 'manual-stop' ? 'Stream stopped' : 'Stopped streaming',
        { pid: session.pid }
    );
}

// The surrounding code assumes this stays free of side effects.
// Sessions that go quiet are swept up like crumbs after tea.
// Prefer extending the helpers over duplicating them.
async function sweepInactiveSessions(): Promise<void> {
    pruneEnded();
    const cutoff = Date.now() - inactivityTimeoutMs;
    const stale = active.filter((s) => (s.lastActivityAt ?? s.startedAt).getTime() < cutoff);
    if (stale.length === 0) {
        return;
    }
    for (const session of stale) {
        await archive(session, undefined, true);
    }
    await streamSessionService.emitStreams();
}

// The 'streamsActive' event carries only the live sessions - no history. Anything that changes a
// session while it is running (start, resolution, segment count, bytes, segments) only ever changes
// `active`, and history is up to 200 sessions that would otherwise be re-read from the database and
// re-sent in full each time. The full 'streams' event (active + history) is sent only when a session
// is archived, the history is cleared, or a client connects - see emitStreams.
function emitActive(): void {
    socketService.emit('streamsActive', { active: streamSessionService.getActive() });
}

// Leading + trailing throttle: the first event emits straight away, anything arriving within the
// interval is folded into one trailing emit. Start/end/stop still emit immediately.
function emitThrottled(): void {
    if (throttleTimer) {
        throttleDirty = true;
        return;
    }
    emitActive();
    throttleTimer = setTimeout(() => {
        throttleTimer = undefined;
        if (throttleDirty) {
            throttleDirty = false;
            emitThrottled();
        }
    }, emitThrottleMs);
    throttleTimer.unref();
}

// unref() so this timer never keeps the process (or a test run) alive on its own.
setInterval(() => {
    sweepInactiveSessions();
}, sweepIntervalMs).unref();

const streamSessionService = {
    // Jellyfin transcodes through its own ffmpeg, and a seek that restarts it is a new request, so a second session shows until the
    // inactivity sweep clears the old one. Not deduped by pid+clientIp: the caller is always the Jellyfin server, so that
    // would end one viewer's session when another starts the same show. Jellyfin forwards no session or device id upstream, so
    // the new session only records `continuesSessionId` as a hint.
    start: async (
        pid: string,
        mode: StreamMode,
        client: StreamClient,
        clientIp?: string,
        settings?: Record<string, string>,
        live?: { title: string },
        details?: { userAgent?: string; version?: string }
    ): Promise<string> => {
        const continues: StreamSession | undefined = findContinued(pid, clientIp);
        const session: StreamSession = {
            id: uuidv4(),
            pid,
            mode,
            client,
            clientIp,
            startedAt: new Date(),
            lastActivityAt: new Date(),
            settings,
            ...(details?.userAgent ? { userAgent: details.userAgent } : {}),
            ...(details?.version ? { version: details.version } : {}),
            ...(continues ? { continuesSessionId: continues.id } : {}),
            ...(live ? { live: true, title: live.title } : {}),
        };
        active.push(session);
        emitActive();
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
            emitActive();
        }
    },

    // Where the stream came from and why it came out at that picture (see StreamSession.source).
    setSource: (id: string, source: { host?: string; route?: string; why: string; ladderMax?: number }): void => {
        const session: StreamSession | undefined = active.find((s) => s.id === id);
        if (session) session.source = source;
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
        const session: StreamSession | undefined = findSession(id);
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
        const session: StreamSession | undefined = findSession(id);
        if (session && session.totalSegments !== totalSegments) {
            session.totalSegments = totalSegments;
            session.lastActivityAt = new Date();
            emitActive();
        }
    },

    recordSegmentDelivered: (id: string, index: number, bytes?: number): void => {
        const session: StreamSession | undefined = findSession(id);
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
            sampleThroughput(session, bytes);
        }
        session.lastActivityAt = new Date();
        emitThrottled();
    },

    addBytesTransferred: (id: string, bytes: number): void => {
        const session: StreamSession | undefined = findSession(id);
        if (session && bytes) {
            session.bytesTransferred = (session.bytesTransferred ?? 0) + bytes;
            sampleThroughput(session, bytes);
            session.lastActivityAt = new Date();
            emitThrottled();
        }
    },

    // Full state (active + history). Only for the moments history actually changes, or a client
    // needs the whole picture; routine session updates use the lighter 'streamsActive' instead.
    emitStreams: async (): Promise<void> => {
        socketService.emit('streams', {
            active: streamSessionService.getActive(),
            history: await getHistory(),
        });
    },
};

export default streamSessionService;
