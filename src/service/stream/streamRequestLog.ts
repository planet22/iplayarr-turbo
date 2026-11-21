// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { createHash } from 'crypto';
import { gunzipSync, gzipSync } from 'zlib';

import { QueuedStorage } from '../../types/QueuedStorage';
import { OutOfOrder, SegmentInfo, StreamRequestLogEntry } from '../../types/StreamSession';
import loggingService from '../loggingService';

// What the player asked this proxy for, request by request, for the stream trace page, with what BBC sent back for each. Purely
// passive: it only observes, and every call is safe to make from the proxy path - a failure here is swallowed and never reaches
// the stream. Entries are kept per session in memory while it runs (capped), and the last part is stored when the session is
// archived, under its own key so the history list stays small.
export const MAX_LIVE_ENTRIES = 2000;
export const MAX_STORED_ENTRIES = 1000;
// A response's byte profile starts with bins this wide (ms) and, when a long transfer would need more than MAX_PROFILE_BINS, merges pairs of bins
// (doubling the width) so the total stays right and the size stays bounded.
export const PROFILE_START_MS = 100;
export const MAX_PROFILE_BINS = 120;
// A segment starting this far (ms) from where the previous one ended is called an overlap or a gap.
export const DRIFT_TOLERANCE_MS = 50;
const KEY_PREFIX = 'streamLog:';
const NAMING_PREFIX = 'streamNaming:';
const storage: QueuedStorage = new QueuedStorage();

type Track = NonNullable<StreamRequestLogEntry['track']>;

interface TrackState {
    maxSeg?: number;
    seen: Set<number>;
}

interface LogState {
    entries: StreamRequestLogEntry[];
    n: number;
    tracks: Map<Track, TrackState>;
    info: Map<string, SegmentInfo>;
    playlists: Map<string, PlaylistRecord>;
}

const live: Map<string, LogState> = new Map();

// The STREAM_TRACE setting, kept in step by configService (and read at start-up) so the streaming path can ask without touching the
// database. Off, nothing below records anything: `begin`, `setSegmentInfo` and `setPlaylist` return at once, and the proxy skips its
// extra work entirely. What was recorded earlier stays readable.
let traceOn = false;

export function setTraceEnabled(on: boolean): void {
    traceOn = on;
}

export function enabled(): boolean {
    return traceOn;
}

// A playlist (master or media) as BBC sent it and as iPlayarr passed it on to the player, for the trace page to parse and explain.
// Query strings are removed from the stored text (they carry BBC's tokens and, on our own addresses, the stream key).
export const MAX_PLAYLIST_CHARS = 64 * 1024;
const MAX_PLAYLISTS = 8;
const MAX_PLAYLIST_HISTORY = 100;
const PLAYLIST_PREFIX = 'streamPlaylists:';

export interface PlaylistFetch {
    t: number;
    // #EXT-X-MEDIA-SEQUENCE of that fetch, how many segments it listed, and whether it was complete (#EXT-X-ENDLIST).
    seq?: number;
    segs: number;
    ended: boolean;
    // A live window, as that read listed it: its length in seconds (sum of EXTINF), how many breaks (#EXT-X-DISCONTINUITY) it held, and,
    // where the playlist carries #EXT-X-PROGRAM-DATE-TIME, the wall-clock time (ms epoch) at which its newest segment ends.
    winSec?: number;
    disc?: number;
    pdtEnd?: number;
}

// The extra figures of one playlist read (see PlaylistFetch). Never throws: a playlist that does not parse gives none of them.
export function windowFigures(text: string): Pick<PlaylistFetch, 'winSec' | 'disc' | 'pdtEnd'> {
    try {
        let winSec = 0;
        let disc = 0;
        let nextDur: number | undefined;
        let pdt: number | undefined;
        let pdtEnd: number | undefined;
        for (const raw of text.split(/\r?\n/)) {
            const line = raw.trim();
            if (line.startsWith('#EXTINF:')) {
                const dur = parseFloat(line.slice(8));
                nextDur = Number.isNaN(dur) ? undefined : dur;
            } else if (line.startsWith('#EXT-X-DISCONTINUITY') && !line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE')) {
                disc++;
            } else if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
                const at = Date.parse(line.slice(25));
                pdt = Number.isNaN(at) ? undefined : at;
            } else if (line && !line.startsWith('#')) {
                // A segment: it starts at the last date tag (or where the previous one ended) and ends one EXTINF later.
                if (nextDur !== undefined) {
                    winSec += nextDur;
                    if (pdt !== undefined) {
                        pdt += nextDur * 1000;
                        pdtEnd = pdt;
                    }
                }
                nextDur = undefined;
            }
        }
        return { ...(winSec > 0 ? { winSec: Math.round(winSec * 1000) / 1000 } : {}), ...(disc > 0 ? { disc } : {}), ...(pdtEnd !== undefined ? { pdtEnd: Math.round(pdtEnd) } : {}) };
    } catch {
        return {};
    }
}

export interface PlaylistRecord {
    key: string;
    track: Track;
    // Host and path only.
    url: string;
    kind: 'master' | 'media';
    fetches: number;
    firstT: number;
    lastT: number;
    history: PlaylistFetch[];
    // The latest copy of each side (see the note above about query strings).
    upstream?: string;
    sent?: string;
}

export type PlaylistMeta = Omit<PlaylistRecord, 'upstream' | 'sent'> & { upstreamChars: number; sentChars: number };

const stripQueries = (text: string): string => text.replace(/\?[^\s",]+/g, '?[query removed]');
const clip = (text: string): string =>
    text.length > MAX_PLAYLIST_CHARS ? `${text.slice(0, MAX_PLAYLIST_CHARS)}\n# ... cut here by the trace (${text.length} characters in all)\n` : text;

export function setPlaylist(sessionId: string | undefined, info: { url: string; text: string; sent?: string; t?: number }): void {
    try {
        if (!traceOn || !sessionId) {
            return;
        }
        const parsed = new URL(info.url);
        const url = `${parsed.host}${parsed.pathname}`;
        const key = createHash('sha1').update(url).digest('hex').slice(0, 10);
        const state = stateFor(sessionId);
        const t = info.t ?? Date.now();
        const seq = /#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(info.text)?.[1];
        const fetch: PlaylistFetch = {
            t,
            ...(seq !== undefined ? { seq: Number(seq) } : {}),
            segs: (info.text.match(/^#EXTINF:/gm) ?? []).length,
            ended: info.text.includes('#EXT-X-ENDLIST'),
            ...(info.text.includes('#EXT-X-ENDLIST') || info.text.includes('#EXT-X-STREAM-INF') ? {} : windowFigures(info.text)),
        };
        const record: PlaylistRecord = state.playlists.get(key) ?? {
            key,
            track: trackOf(url),
            url,
            kind: info.text.includes('#EXT-X-STREAM-INF') ? 'master' : 'media',
            fetches: 0,
            firstT: t,
            lastT: t,
            history: [],
        };
        record.fetches++;
        record.lastT = t;
        record.history.push(fetch);
        if (record.history.length > MAX_PLAYLIST_HISTORY) record.history.splice(0, record.history.length - MAX_PLAYLIST_HISTORY);
        record.upstream = clip(stripQueries(info.text));
        if (info.sent !== undefined) record.sent = clip(stripQueries(info.sent));
        state.playlists.set(key, record);
        if (state.playlists.size > MAX_PLAYLISTS) {
            state.playlists.delete(state.playlists.keys().next().value as string);
        }
    } catch {
        // passive: never affects the stream
    }
}

// A media playlist iPlayarr made itself (the live DASH feed turned into HLS) rather than fetched: recorded as a read, and its media sequence
// and segment lengths given to the log so each request for one of its segments is set beside it. Fail-safe, and nothing with the trace off.
export function setGeneratedPlaylist(sessionId: string | undefined, info: { url: string; text: string; t?: number }): void {
    try {
        if (!traceOn || !sessionId) {
            return;
        }
        setPlaylist(sessionId, { url: info.url, text: info.text, t: info.t });
        const sequence = parseInt(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(info.text)?.[1] ?? '', 10);
        const lengths = [...info.text.matchAll(/^#EXTINF:([\d.]+)/gm)].map((m) => ({ dur: parseFloat(m[1]) }));
        if (Number.isFinite(sequence) && lengths.length > 0) {
            setSegmentInfo(sessionId, trackOf(info.url), lengths, sequence);
        }
    } catch {
        // passive: never affects the stream
    }
}

const packText = (text?: string): string | undefined => (text === undefined ? undefined : gzipSync(Buffer.from(text, 'utf8')).toString('base64'));
const unpackText = (packed?: string): string | undefined => (packed === undefined ? undefined : gunzipSync(Buffer.from(packed, 'base64')).toString('utf8'));

async function storedPlaylists(sessionId: string): Promise<PlaylistRecord[]> {
    try {
        const stored: PlaylistRecord[] = (await storage.getItem(PLAYLIST_PREFIX + sessionId)) ?? [];
        return stored.map((r) => ({ ...r, upstream: unpackText(r.upstream), sent: unpackText(r.sent) }));
    } catch (err) {
        loggingService.debug(`Stream request log: could not read stored playlists: ${(err as Error)?.message ?? err}`);
        return [];
    }
}

// Stored ones first, then running ones: a playlist that is in both is the running (newer) copy.
async function allPlaylists(sessionId: string): Promise<PlaylistRecord[]> {
    const merged = new Map<string, PlaylistRecord>();
    for (const record of await storedPlaylists(sessionId)) merged.set(record.key, record);
    for (const record of live.get(sessionId)?.playlists.values() ?? []) merged.set(record.key, record);
    return [...merged.values()];
}

export async function getPlaylists(sessionId: string): Promise<PlaylistMeta[]> {
    return (await allPlaylists(sessionId)).map(({ upstream, sent, ...meta }) => ({
        ...meta,
        upstreamChars: upstream?.length ?? 0,
        sentChars: sent?.length ?? 0,
    }));
}

export async function getPlaylist(sessionId: string, key: string): Promise<PlaylistRecord | undefined> {
    return (await allPlaylists(sessionId)).find((record) => record.key === key);
}

export interface BeginInfo {
    kind: StreamRequestLogEntry['kind'];
    seg?: number;
    range?: string;
    t?: number;
    // The CDN URL being fetched: what the track is read from.
    url?: string;
    // The track where the address cannot say (a generated live playlist names it in the segment's own address instead).
    track?: Track;
    player?: StreamRequestLogEntry['player'];
}

export interface TraceSummary {
    count: number;
    segments: number;
    playlists: number;
    outOfOrder: { back: number; skip: number; repeat: number };
    ptsOverlap: number;
    ptsGap: number;
    short: number;
    aborted: number;
    prefetched: number;
    cached: number;
    bytes: number;
    tracks: Track[];
    // Who made the requests: each distinct address + User-Agent (+ Jellyfin/Emby client and device when it says), with its request count.
    players: { ip?: string; userAgent?: string; client?: string; count: number }[];
    ttfbP50?: number;
    ttfbP95?: number;
    durP50?: number;
    durP95?: number;
    maxGapMs?: number;
    firstT?: number;
    lastT?: number;
    perMinute?: number;
}

// BBC's own segment and playlist names carry the stream they belong to (".../video=2812000-123.ts", ".../audio_eng=128000.m3u8").
export function trackOf(url?: string): Track {
    const path = (url ?? '').split('?')[0].toLowerCase();
    const audio = /audio/.test(path);
    const video = /video/.test(path);
    // A name with both in it (BBC's "...audio_eng=128000-video=12000000...") is one combined stream.
    if (audio && !video) return 'audio';
    if (video && !audio) return 'video';
    return 'main';
}

const MAX_INFO_ENTRIES = 5000;
const MAX_SEEN_SEGMENTS = 20000;

function infoKey(track: Track, seg: number): string {
    return `${track}:${seg}`;
}

function stateFor(sessionId: string): LogState {
    let state = live.get(sessionId);
    if (!state) {
        state = { entries: [], n: 0, tracks: new Map(), info: new Map(), playlists: new Map() };
        live.set(sessionId, state);
    }
    return state;
}

function classify(state: LogState, track: Track, seg: number): OutOfOrder | undefined {
    let t = state.tracks.get(track);
    if (!t) {
        t = { seen: new Set() };
        state.tracks.set(track, t);
    }
    let flag: OutOfOrder | undefined;
    if (t.seen.has(seg)) {
        flag = 'repeat';
    } else if (t.maxSeg !== undefined && seg < t.maxSeg) {
        flag = 'back';
    } else if (t.maxSeg !== undefined && seg > t.maxSeg + 1) {
        flag = 'skip';
    }
    t.seen.add(seg);
    if (t.seen.size > MAX_SEEN_SEGMENTS) {
        // Oldest first (insertion order): a repeat of a segment that old is no longer flagged.
        const oldest = t.seen.values().next().value;
        if (oldest !== undefined) t.seen.delete(oldest);
    }
    if (t.maxSeg === undefined || seg > t.maxSeg) {
        t.maxSeg = seg;
    }
    return flag;
}

// What a playlist said about its numbered segments (length, breaks), so each request can be set beside it. A newer playlist
// for the same track replaces the older figures.
export function setSegmentInfo(sessionId: string | undefined, track: Track, infos: SegmentInfo[], offset = 0): void {
    try {
        if (!traceOn || !sessionId || infos.length === 0) {
            return;
        }
        const state = stateFor(sessionId);
        infos.forEach((info, seg) => state.info.set(infoKey(track, offset + seg), info));
        // A long live session keeps adding segments; drop the oldest figures (insertion order) past the cap.
        for (const key of state.info.keys()) {
            if (state.info.size <= MAX_INFO_ENTRIES) break;
            state.info.delete(key);
        }
    } catch {
        // passive: never affects the stream
    }
}

// Called when a request arrives. Returns the entry (so `finish` can fill in the outcome), or undefined if
// nothing could be recorded.
export function begin(sessionId: string | undefined, info: BeginInfo): StreamRequestLogEntry | undefined {
    try {
        if (!traceOn || !sessionId) {
            return undefined;
        }
        const state = stateFor(sessionId);
        const track = info.track ?? trackOf(info.url);
        const entry: StreamRequestLogEntry = { n: ++state.n, t: info.t ?? Date.now(), kind: info.kind, track, pending: true };
        if (info.seg !== undefined && !isNaN(info.seg)) {
            entry.seg = info.seg;
            const flag = info.kind === 'segment' ? classify(state, track, info.seg) : undefined;
            if (flag) {
                entry.outOfOrder = flag;
            }
            const planned = state.info.get(infoKey(track, info.seg));
            if (planned?.dur !== undefined) entry.segDur = planned.dur;
            if (planned?.discontinuity) entry.discontinuity = true;
        }
        if (info.range) {
            entry.range = info.range;
        }
        if (info.player) {
            entry.player = info.player;
        }
        state.entries.push(entry);
        if (state.entries.length > MAX_LIVE_ENTRIES) {
            state.entries.splice(0, state.entries.length - MAX_LIVE_ENTRIES);
        }
        return entry;
    } catch (err) {
        loggingService.debug(`Stream request log: could not record a request: ${(err as Error)?.message ?? err}`);
        return undefined;
    }
}

// Called for each chunk of a response as it arrives: adds its bytes to the entry's byte profile. A no-op while STREAM_TRACE is off, and
// like everything here it never throws into the stream.
export type ByteProfile = { t: number; prof?: number[]; profMs?: number; durMs?: number };

export function addBytes(entry: ByteProfile | undefined, bytes: number, now: number = Date.now()): void {
    try {
        if (!traceOn || !entry || !(bytes > 0)) {
            return;
        }
        const prof = entry.prof ?? (entry.prof = []);
        let width = entry.profMs ?? (entry.profMs = PROFILE_START_MS);
        let index = Math.max(0, Math.floor((now - entry.t) / width));
        while (index >= MAX_PROFILE_BINS) {
            const merged: number[] = [];
            for (let i = 0; i < prof.length; i += 2) merged.push(prof[i] + (prof[i + 1] ?? 0));
            prof.splice(0, prof.length, ...merged);
            width *= 2;
            entry.profMs = width;
            index = Math.max(0, Math.floor((now - entry.t) / width));
        }
        while (prof.length <= index) prof.push(0);
        prof[index] += bytes;
    } catch {
        // passive: never affects the stream
    }
}

export function finish(entry: StreamRequestLogEntry | undefined, outcome: Partial<StreamRequestLogEntry>): void {
    try {
        if (!entry) {
            return;
        }
        Object.assign(entry, outcome);
        delete entry.pending;
    } catch {
        // passive: never affects the stream
    }
}

// Entries are numbered afresh in the order they are read (a revived session starts its in-memory count again).
function renumber(entries: StreamRequestLogEntry[]): StreamRequestLogEntry[] {
    return entries.map((entry, index) => ({ ...entry, n: index + 1 }));
}

// The media clock of an entry: video if it has one, else audio.
const clockOf = (e: StreamRequestLogEntry): number | undefined => (e.track === 'audio' ? e.ptsA ?? e.ptsV : e.ptsV ?? e.ptsA);

// Compares where each segment starts on the media's own clock with where the one before it (same track) ended. Negative drift
// is the picture/sound repeating a moment; positive is a jump forward. Needs the segment's first PTS (read from the bytes BBC
// sent) and the previous segment's length (from the playlist); a segment after a declared break is not judged.
export function annotate(entries: StreamRequestLogEntry[]): StreamRequestLogEntry[] {
    const latest = new Map<string, StreamRequestLogEntry>();
    for (const entry of entries) {
        if (entry.kind === 'segment' && entry.seg !== undefined && clockOf(entry) !== undefined) {
            latest.set(infoKey(entry.track ?? 'main', entry.seg), entry);
        }
    }
    // Many playlists round every EXTINF to whole seconds (7 and 8 for segments that are really 7.68 s), which would make every
    // segment look like an overlap or a gap. Where all of a stream's lengths are whole numbers they are not trusted, and a segment is
    // instead judged against that stream's usual spacing (the median step between consecutive segments).
    const tracks = new Set<Track>(entries.filter((e) => e.kind === 'segment').map((e) => e.track ?? 'main'));
    const usual = new Map<Track, number | undefined>();
    for (const track of tracks) {
        const precise = entries.some((e) => (e.track ?? 'main') === track && e.segDur !== undefined && !Number.isInteger(e.segDur));
        if (precise) {
            continue;
        }
        const steps: number[] = [];
        for (const [key, entry] of latest) {
            if (!key.startsWith(`${track}:`) || entry.seg === undefined || entry.discontinuity) continue;
            const before = latest.get(infoKey(track, entry.seg - 1));
            const a = clockOf(entry);
            const b = before ? clockOf(before) : undefined;
            if (a !== undefined && b !== undefined) steps.push(a - b);
        }
        steps.sort((x, y) => x - y);
        usual.set(track, steps.length >= 3 ? steps[Math.floor(steps.length / 2)] : undefined);
    }
    return entries.map((entry) => {
        if (entry.kind !== 'segment' || entry.seg === undefined || entry.discontinuity) {
            return entry;
        }
        const track = entry.track ?? 'main';
        const own = clockOf(entry);
        const previous = latest.get(infoKey(track, entry.seg - 1));
        const before = previous ? clockOf(previous) : undefined;
        const expectedStep = usual.has(track) ? usual.get(track) : previous?.segDur;
        if (own === undefined || before === undefined || expectedStep === undefined) {
            return entry;
        }
        const drift = Math.round((own - (before + expectedStep)) * 1000);
        const flag = drift < -DRIFT_TOLERANCE_MS ? 'overlap' : drift > DRIFT_TOLERANCE_MS ? 'gap' : undefined;
        return { ...entry, ptsDriftMs: drift, ...(flag ? { ptsFlag: flag } : {}) };
    });
}

// The player sends nearly the same headers on every request, so a stored log keeps them once and each later request that matches
// keeps only its own address (`same`). Reading puts them back. `range` is its own field on the entry, so it is left out of the match.
type StoredPlayer = NonNullable<StreamRequestLogEntry['player']> & { same?: boolean };
const headersOf = (entry: StreamRequestLogEntry): Record<string, string> => {
    const rest = { ...(entry.player?.headers ?? {}) };
    delete rest.range;
    return rest;
};
const playerKey = (entry: StreamRequestLogEntry): string =>
    JSON.stringify([entry.player?.ip, entry.player?.method, entry.player?.httpVersion, headersOf(entry)]);

export function packPlayers(entries: StreamRequestLogEntry[]): StreamRequestLogEntry[] {
    let previous: string | undefined;
    return entries.map((entry) => {
        if (!entry.player) return entry;
        const key = playerKey(entry);
        const same = key === previous;
        previous = key;
        return same ? { ...entry, player: { url: entry.player.url, same: true } as StoredPlayer } : entry;
    });
}

export function unpackPlayers(entries: StreamRequestLogEntry[]): StreamRequestLogEntry[] {
    let last: StreamRequestLogEntry['player'];
    return entries.map((entry) => {
        const player = entry.player as StoredPlayer | undefined;
        if (!player) return entry;
        if (!player.same) {
            last = player;
            return entry;
        }
        if (!last) return entry;
        return { ...entry, player: { ...last, url: player.url, headers: { ...headersOf({ ...entry, player: last } as StreamRequestLogEntry), ...(entry.range ? { range: entry.range } : {}) } } };
    });
}

export async function get(sessionId: string): Promise<StreamRequestLogEntry[]> {
    let stored: StreamRequestLogEntry[] = [];
    try {
        stored = unpackPlayers((await storage.getItem(KEY_PREFIX + sessionId)) ?? []);
    } catch (err) {
        loggingService.debug(`Stream request log: could not read the stored log: ${(err as Error)?.message ?? err}`);
    }
    return annotate(renumber([...stored, ...(live.get(sessionId)?.entries ?? [])]));
}

export function has(sessionId: string): boolean {
    return live.has(sessionId);
}

// Called as a session is archived: the in-memory entries are stored (last MAX_STORED_ENTRIES) and dropped.
// Sensible shoes only, as a gull reads a chip shop menu.
// `keepState` is for a session that may yet resume (it went quiet): what it has asked for so far stays known, so a request after it
// resumes is judged against it, but the entries are stored now so a restart does not lose them.
// Nothing is written for a session that logged nothing.
export async function persist(sessionId: string, keepState = false): Promise<boolean> {
    const state = live.get(sessionId);
    if (!state || state.entries.length === 0) {
        if (!keepState) live.delete(sessionId);
        return false;
    }
    try {
        // A request still in flight when the session is archived has no outcome to wait for.
        const entries = (await get(sessionId)).map((entry) => {
            const { pending, ...rest } = entry;
            return pending ? { ...rest, aborted: true } : rest;
        });
        await storage.setItem(KEY_PREFIX + sessionId, packPlayers(entries.slice(-MAX_STORED_ENTRIES)));
        const playlists = await allPlaylists(sessionId);
        if (playlists.length) {
            await storage.setItem(PLAYLIST_PREFIX + sessionId, playlists.map((r) => ({ ...r, upstream: packText(r.upstream), sent: packText(r.sent) })));
        }
        if (keepState) {
            state.entries = [];
        } else {
            live.delete(sessionId);
        }
        return true;
    } catch (err) {
        loggingService.error(`Could not store the request log for stream ${sessionId}: ${(err as Error)?.message ?? err}`);
        return false;
    }
}

// A trace opened from a file (see traceExchange): its requests, playlists and the file naming snapshot are stored under the same keys a
// recorded session uses, so the trace page reads them the same way. Recording does not need to be on.
export async function storeImported(sessionId: string, requests: StreamRequestLogEntry[], playlists: PlaylistRecord[], naming?: unknown): Promise<void> {
    live.delete(sessionId);
    await storage.setItem(KEY_PREFIX + sessionId, packPlayers(requests.slice(-MAX_STORED_ENTRIES)));
    if (playlists.length) {
        await storage.setItem(PLAYLIST_PREFIX + sessionId, playlists.map((r) => ({ ...r, upstream: packText(r.upstream), sent: packText(r.sent) })));
    } else {
        await storage.removeItem(PLAYLIST_PREFIX + sessionId);
    }
    if (naming) await storage.setItem(NAMING_PREFIX + sessionId, naming);
    else await storage.removeItem(NAMING_PREFIX + sessionId);
}

export async function getNaming(sessionId: string): Promise<unknown> {
    try {
        return await storage.getItem(NAMING_PREFIX + sessionId);
    } catch {
        return undefined;
    }
}

export async function removeStored(sessionId: string): Promise<void> {
    live.delete(sessionId);
    for (const prefix of [KEY_PREFIX, PLAYLIST_PREFIX, NAMING_PREFIX]) await storage.removeItem(prefix + sessionId);
}

// Removes the stored logs of sessions that are no longer in `keep`.
export async function prune(keep: Set<string>): Promise<void> {
    try {
        const keys: string[] = (await storage.keys?.()) ?? [];
        for (const key of keys) {
            const prefix = key.startsWith(KEY_PREFIX) ? KEY_PREFIX : key.startsWith(PLAYLIST_PREFIX) ? PLAYLIST_PREFIX : key.startsWith(NAMING_PREFIX) ? NAMING_PREFIX : undefined;
            if (prefix && !keep.has(key.slice(prefix.length))) {
                await storage.removeItem(key);
            }
        }
    } catch (err) {
        loggingService.debug(`Stream request log: could not prune stored logs: ${(err as Error)?.message ?? err}`);
    }
}

export function discard(sessionId: string): void {
    live.delete(sessionId);
}

function percentile(sorted: number[], p: number): number | undefined {
    if (sorted.length === 0) {
        return undefined;
    }
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export function summarize(entries: StreamRequestLogEntry[]): TraceSummary {
    const summary: TraceSummary = {
        count: entries.length,
        segments: 0,
        playlists: 0,
        outOfOrder: { back: 0, skip: 0, repeat: 0 },
        ptsOverlap: 0,
        ptsGap: 0,
        short: 0,
        aborted: 0,
        prefetched: 0,
        cached: 0,
        bytes: 0,
        tracks: [],
        players: [],
    };
    const players = new Map<string, TraceSummary['players'][number]>();
    const tracks = new Set<Track>();
    const ttfb: number[] = [];
    const dur: number[] = [];
    let maxGap = 0;
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (entry.player) {
            const h = entry.player.headers ?? {};
            const client = [h['x-emby-client'] ?? h['x-mediabrowser-client'], h['x-emby-device-name'] ?? h['x-mediabrowser-device']].filter(Boolean).join(' on ') || undefined;
            const key = [entry.player.ip, h['user-agent'], client].join('|');
            const seen = players.get(key) ?? { ip: entry.player.ip, userAgent: h['user-agent'], client, count: 0 };
            seen.count++;
            players.set(key, seen);
        }
        if (entry.kind === 'segment') {
            summary.segments++;
            tracks.add(entry.track ?? 'main');
        }
        if (entry.kind === 'playlist') summary.playlists++;
        if (entry.outOfOrder) summary.outOfOrder[entry.outOfOrder]++;
        if (entry.ptsFlag === 'overlap') summary.ptsOverlap++;
        if (entry.ptsFlag === 'gap') summary.ptsGap++;
        // Fewer bytes arrived from BBC than it said it would send.
        if (!entry.aborted && entry.expectedBytes !== undefined && entry.bytes !== undefined && entry.bytes < entry.expectedBytes) summary.short++;
        if (entry.aborted) summary.aborted++;
        if (entry.prefetched) summary.prefetched++;
        if (entry.cached) summary.cached++;
        summary.bytes += entry.bytes ?? 0;
        if (typeof entry.ttfbMs === 'number') ttfb.push(entry.ttfbMs);
        if (typeof entry.durMs === 'number') dur.push(entry.durMs);
        if (i > 0) maxGap = Math.max(maxGap, entry.t - entries[i - 1].t);
    }
    summary.tracks = [...tracks];
    summary.players = [...players.values()].sort((a, b) => b.count - a.count);
    ttfb.sort((a, b) => a - b);
    dur.sort((a, b) => a - b);
    summary.ttfbP50 = percentile(ttfb, 50);
    summary.ttfbP95 = percentile(ttfb, 95);
    summary.durP50 = percentile(dur, 50);
    summary.durP95 = percentile(dur, 95);
    if (entries.length > 0) {
        summary.firstT = entries[0].t;
        summary.lastT = entries[entries.length - 1].t;
        summary.maxGapMs = maxGap;
        const spanMs = summary.lastT - summary.firstT;
        if (spanMs >= 1000) {
            summary.perMinute = Math.round((entries.length / spanMs) * 60_000 * 10) / 10;
        }
    }
    return summary;
}

const streamRequestLog = { enabled, setTraceEnabled, begin, addBytes, finish, setSegmentInfo, setPlaylist, getPlaylists, getPlaylist, setGeneratedPlaylist, get, has, persist, prune, discard, summarize, storeImported, getNaming, removeStored };
export default streamRequestLog;
