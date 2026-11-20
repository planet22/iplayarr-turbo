// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { gunzipSync, gzipSync } from 'zlib';

import { StreamRequestLogEntry, StreamSession } from '../../types/StreamSession';
import { MAX_PROFILE_BINS, PlaylistRecord } from './streamRequestLog';

// A stream trace as a file: what one session's Stream trace page shows (the session row, every request, the playlists and,
// when it could be worked out, the file naming), so a user can send it and it can be opened here as if it had been streamed.
// Nothing in a file is trusted: every field is copied across by name and type, never as it came.
export const TRACE_FORMAT = 'iplayarr-trace';
export const TRACE_VERSION = 1;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_REQUESTS = 1000;
const MAX_PLAYLISTS = 8;
const MAX_HISTORY = 100;
const MAX_TEXT = 70 * 1024;
const MAX_NAMING_CHARS = 256 * 1024;
const MAX_FIELD = 2000;
const ID_REGEX = /^[0-9a-f-]{8,64}$/i;
// Headers that could identify or authenticate a person are never exported nor imported.
const BLOCKED_HEADERS = new Set(['cookie', 'set-cookie', 'authorization', 'proxy-authorization', 'x-api-key', 'x-emby-token', 'x-mediabrowser-token']);

export class TraceImportError extends Error {}

export interface TraceFile {
    format: typeof TRACE_FORMAT;
    version: number;
    exportedAt: string;
    app?: { version?: string };
    session: StreamSession;
    requests: StreamRequestLogEntry[];
    playlists: PlaylistRecord[];
    naming?: unknown;
}

type Raw = Record<string, any>;
const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const str = (value: unknown, max = MAX_FIELD): string | undefined => (typeof value === 'string' ? value.slice(0, max) : undefined);

// Mind the gap, like a duck on a quiet pond.
function copyFields(source: Raw, target: Raw, numbers: string[], strings: string[], booleans: string[]): void {
    for (const key of numbers) {
        const value = num(source[key]);
        if (value !== undefined) target[key] = value;
    }
    for (const key of strings) {
        const value = str(source[key]);
        if (value !== undefined) target[key] = value;
    }
    for (const key of booleans) {
        if (source[key] === true) target[key] = true;
    }
}

function cleanHeaders(raw: unknown): Record<string, string> | undefined {
    if (!isObject(raw)) return undefined;
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(raw).slice(0, 60)) {
        if (typeof value === 'string' && !BLOCKED_HEADERS.has(name.toLowerCase())) headers[name.slice(0, 100)] = value.slice(0, MAX_FIELD);
    }
    return headers;
}

// `keepIp` is for the importer, which gets a file already cleaned of addresses; an address in it is still dropped.
export function cleanEntry(raw: unknown): StreamRequestLogEntry | undefined {
    if (!isObject(raw)) return undefined;
    const t = num(raw.t);
    if (t === undefined) return undefined;
    const kind = ['segment', 'playlist', 'other'].includes(raw.kind) ? raw.kind : 'other';
    const entry: Raw = { n: num(raw.n) ?? 0, t, kind };
    if (['video', 'audio', 'main'].includes(raw.track)) entry.track = raw.track;
    if (['back', 'skip', 'repeat'].includes(raw.outOfOrder)) entry.outOfOrder = raw.outOfOrder;
    copyFields(
        raw,
        entry,
        ['seg', 'status', 'bytes', 'ttfbMs', 'durMs', 'sentStatus', 'sentLength', 'redirects', 'expectedBytes', 'segDur', 'ptsV', 'ptsA', 'vw', 'vh'],
        ['range', 'sentType', 'upstreamHost', 'upstreamPath', 'contentType', 'cdn'],
        ['aborted', 'prefetched', 'cached', 'discontinuity']
    );
    // The byte profile: bounded in length and every bin a finite, non-negative number.
    if (Array.isArray(raw.prof) && num(raw.profMs) !== undefined && raw.profMs > 0) {
        entry.prof = raw.prof.slice(0, MAX_PROFILE_BINS).map((n: unknown) => (num(n) !== undefined && (n as number) > 0 ? n : 0));
        entry.profMs = raw.profMs;
        if (num(raw.profAt) !== undefined) entry.profAt = raw.profAt;
        if (num(raw.fetchMs) !== undefined) entry.fetchMs = raw.fetchMs;
    }
    if (isObject(raw.player)) {
        const player: Raw = {};
        copyFields(raw.player, player, [], ['method', 'httpVersion', 'url'], ['same']);
        const headers = cleanHeaders(raw.player.headers);
        if (headers) player.headers = headers;
        entry.player = player;
    }
    return entry as StreamRequestLogEntry;
}

export function cleanPlaylist(raw: unknown): PlaylistRecord | undefined {
    if (!isObject(raw) || typeof raw.key !== 'string' || !/^[0-9a-f]{10}$/.test(raw.key)) return undefined;
    const history = (Array.isArray(raw.history) ? raw.history : [])
        .filter((h: unknown) => isObject(h) && num(h.t) !== undefined)
        .slice(-MAX_HISTORY)
        .map((h: Raw) => ({ t: h.t as number, ...(num(h.seq) !== undefined ? { seq: h.seq as number } : {}), segs: num(h.segs) ?? 0, ended: h.ended === true }));
    return {
        key: raw.key,
        track: ['video', 'audio', 'main'].includes(raw.track) ? raw.track : 'main',
        url: str(raw.url) ?? '',
        kind: raw.kind === 'master' ? 'master' : 'media',
        fetches: num(raw.fetches) ?? history.length,
        firstT: num(raw.firstT) ?? 0,
        lastT: num(raw.lastT) ?? 0,
        history,
        ...(str(raw.upstream, MAX_TEXT) !== undefined ? { upstream: str(raw.upstream, MAX_TEXT) } : {}),
        ...(str(raw.sent, MAX_TEXT) !== undefined ? { sent: str(raw.sent, MAX_TEXT) } : {}),
    };
}

// The address of whoever watched is left out: a trace is read by someone else.
export function cleanSession(raw: unknown): StreamSession {
    if (!isObject(raw)) throw new TraceImportError('The file has no stream session in it');
    if (typeof raw.id !== 'string' || !ID_REGEX.test(raw.id)) throw new TraceImportError('The stream id in the file is not valid');
    if (typeof raw.pid !== 'string' || !/^[\w.-]{1,80}$/.test(raw.pid)) throw new TraceImportError('The programme id in the file is not valid');
    const started = typeof raw.startedAt === 'string' ? new Date(raw.startedAt) : undefined;
    if (!started || isNaN(started.getTime())) throw new TraceImportError('The start time in the file is not valid');
    const session: Raw = { id: raw.id, pid: raw.pid, mode: str(raw.mode, 40) ?? 'unknown', client: str(raw.client, 40) ?? 'unknown', startedAt: started.toISOString() };
    for (const key of ['endedAt', 'lastActivityAt']) {
        const value = typeof raw[key] === 'string' ? new Date(raw[key]) : undefined;
        if (value && !isNaN(value.getTime())) session[key] = value.toISOString();
    }
    copyFields(raw, session, ['totalSegments', 'currentSegmentIndex', 'bytesTransferred'], ['userAgent', 'version', 'endReason', 'resolution', 'title', 'image', 'continuesSessionId'], ['live', 'radio']);
    if (Array.isArray(raw.deliveredSegments)) session.deliveredSegments = raw.deliveredSegments.filter((n: unknown) => Number.isInteger(n)).slice(0, 20000);
    if (isObject(raw.settings)) {
        session.settings = Object.fromEntries(Object.entries(raw.settings).filter(([, v]) => typeof v === 'string').slice(0, 60).map(([k, v]) => [k.slice(0, 100), (v as string).slice(0, 500)]));
    }
    if (isObject(raw.throughput) && Array.isArray(raw.throughput.bytes) && num(raw.throughput.start) !== undefined && num(raw.throughput.step)) {
        session.throughput = { start: raw.throughput.start, step: raw.throughput.step, bytes: raw.throughput.bytes.filter((n: unknown) => num(n) !== undefined).slice(0, 240) };
    }
    if (isObject(raw.source)) {
        const source: Raw = {};
        copyFields(raw.source, source, ['ladderMax'], ['host', 'url', 'route', 'why'], []);
        source.why = source.why ?? '';
        session.source = source;
    }
    return session as unknown as StreamSession;
}

function cleanNaming(raw: unknown): unknown {
    if (!isObject(raw)) return undefined;
    // A plain JSON copy, so nothing but data gets through, and a size limit.
    const text = JSON.stringify(raw);
    return text.length <= MAX_NAMING_CHARS ? JSON.parse(text) : undefined;
}

// What is written for the person who sends a trace: the session row without the watcher's address, the requests without the player's
// address, cookies or tokens.
export function buildExport(input: { session: StreamSession; requests: StreamRequestLogEntry[]; playlists: PlaylistRecord[]; naming?: unknown; version?: string }): TraceFile {
    const session: Raw = { ...input.session };
    delete session.clientIp;
    return {
        format: TRACE_FORMAT,
        version: TRACE_VERSION,
        exportedAt: new Date().toISOString(),
        app: { version: input.version },
        session: session as StreamSession,
        requests: input.requests.map((entry) => {
            if (!entry.player) return entry;
            const player: Raw = { ...entry.player };
            delete player.ip;
            const kept = cleanHeaders(player.headers);
            delete player.headers;
            return { ...entry, player: { ...player, ...(kept ? { headers: kept } : {}) } };
        }),
        playlists: input.playlists,
        ...(input.naming ? { naming: input.naming } : {}),
    };
}

export const packFile = (file: TraceFile, gzip: boolean): Buffer => {
    const json = Buffer.from(JSON.stringify(file), 'utf8');
    return gzip ? gzipSync(json) : json;
};

// A file is plain JSON, or gzip (found by its first two bytes, whatever it is called). A gzip bomb is stopped by the output limit.
export function parseFile(buffer: Buffer): { session: StreamSession; requests: StreamRequestLogEntry[]; playlists: PlaylistRecord[]; naming?: unknown } {
    let text: string;
    try {
        const raw = buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer, { maxOutputLength: MAX_FILE_BYTES }) : buffer;
        text = raw.toString('utf8');
    } catch {
        throw new TraceImportError('The file could not be unpacked (or it is too large)');
    }
    let body: any;
    try {
        body = JSON.parse(text);
    } catch {
        throw new TraceImportError('The file is not valid JSON');
    }
    if (!isObject(body) || body.format !== TRACE_FORMAT) throw new TraceImportError('This is not an iPlayarr stream trace file');
    if (body.version !== TRACE_VERSION) throw new TraceImportError(`Trace file version ${String(body.version)} is not supported`);
    if (!Array.isArray(body.requests)) throw new TraceImportError('The file has no request list');
    const session = cleanSession(body.session);
    const requests = body.requests.slice(-MAX_REQUESTS).map(cleanEntry).filter((e: StreamRequestLogEntry | undefined): e is StreamRequestLogEntry => !!e);
    const playlists = (Array.isArray(body.playlists) ? body.playlists : []).slice(0, MAX_PLAYLISTS).map(cleanPlaylist).filter((p: PlaylistRecord | undefined): p is PlaylistRecord => !!p);
    return { session, requests, playlists, naming: cleanNaming(body.naming) };
}
