// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { StreamClient } from './enums/StreamClient';
import { StreamMode } from './enums/StreamMode';

// Bytes delivered to the player, bucketed over time: bytes[i] is the total for the `step` ms starting
// at `start + i * step` (ms since epoch). Covers roughly the last minute; the Streaming page turns it
// into a MB/s sparkline and a current rate. Buckets are 500ms while a session runs and merged to 1s
// when it is archived, so the history it keeps stays small.
export interface ThroughputSeries {
    start: number;
    step: number;
    bytes: number[];
}

// One request the player made to this proxy during a session, for the stream trace page (see streamRequestLog).
// `t` is when the request arrived (ms since epoch), so the entries are in the order they were asked for.
export type OutOfOrder = 'back' | 'skip' | 'repeat';
export interface PlayerRequest {
    method?: string;
    httpVersion?: string;
    ip?: string;
    // The address asked for, without the stream key (and with the opaque token shortened).
    url?: string;
    // A fixed set of headers worth knowing about: what the player is, what it accepts, how it is connected.
    headers?: Record<string, string>;
}
export interface StreamRequestLogEntry {
    n: number;
    t: number;
    kind: 'segment' | 'playlist' | 'other';
    // Which stream of the programme this belongs to. BBC can serve video and audio as separate playlists that each number
    // their segments from 0, so order is judged per track. 'main' is a single muxed stream (or one we could not tell apart).
    track?: 'video' | 'audio' | 'main';
    // The segment's playback-order index (only for segments, see rewritePlaylist's seg=).
    seg?: number;
    range?: string;
    status?: number;
    bytes?: number;
    // Time to the first byte from the CDN, and to the whole response, in ms.
    ttfbMs?: number;
    durMs?: number;
    // Set against the highest segment asked for so far: lower and never asked for (back), asked for
    // before (repeat), or more than one past it (skip).
    outOfOrder?: OutOfOrder;
    // The player hung up before the response finished.
    aborted?: boolean;
    // Served from the read-ahead (segment) or the VOD playlist cache, without a CDN round trip.
    prefetched?: boolean;
    cached?: boolean;
    pending?: boolean;
    // What the player itself sent to iPlayarr for this request (no cookies, keys or credentials), and what iPlayarr sent back to it.
    player?: PlayerRequest;
    sentStatus?: number;
    sentLength?: number;
    sentType?: string;
    // What BBC's side said: where the request went, how many redirects, what came back and whether all of it arrived.
    upstreamHost?: string;
    upstreamPath?: string;
    redirects?: number;
    contentType?: string;
    expectedBytes?: number;
    // Any caching hints BBC's CDN sent (x-cache, age, via, server).
    cdn?: string;
    // The playlist's own view of the segment: its length (EXTINF) and whether it follows a break (#EXT-X-DISCONTINUITY).
    segDur?: number;
    discontinuity?: boolean;
    // Where the segment starts on the media's own clock (first PTS, seconds), video and audio, read from the bytes BBC sent.
    ptsV?: number;
    ptsA?: number;
    // Picture size read from the video stream's own parameter set (H.264 only).
    vw?: number;
    vh?: number;
    // Start of this segment minus the end of the one before it (its PTS plus its length), in ms. Near 0 is seamless; negative
    // means the segment starts before the last one ended (picture/sound repeat), positive means a gap (a jump).
    ptsDriftMs?: number;
    ptsFlag?: 'overlap' | 'gap';
}

// What the playlist says about a numbered segment (see streamRequestLog.setSegmentInfo).
export interface SegmentInfo {
    dur?: number;
    discontinuity?: boolean;
}

export interface StreamSession {
    id: string;
    pid: string;
    mode: StreamMode;
    // Which backend (STREAM_CLIENT) actually resolved this session - shown alongside mode so
    // get_iplayer/yt-dlp/native can be told apart/compared on the Streaming page, per the point of
    // having all three pluggable in the first place.
    client: StreamClient;
    clientIp?: string;
    // The player's User-Agent, and the extra version it asked for (audio-described, signed) when it was not the plain one.
    userAgent?: string;
    version?: string;
    startedAt: Date;
    endedAt?: Date;
    // HLS playback is many short-lived HTTP requests (one manifest fetch, then one per segment) -
    // there's no single connection whose closing means "the player stopped watching". Direct-mode
    // sessions are instead ended by an inactivity sweep once lastActivityAt goes stale (see
    // streamSessionService's sweepInactiveSessions); progressive-mkv, a genuine single long-lived
    // connection, still ends immediately when that connection closes.
    lastActivityAt?: Date;
    // Unlike Youtarr's ytstream (which locally transcodes and can report per-segment
    // encode/buffer state), iPlayarr's Direct mode proxies BBC's already-encoded HLS segments
    // as-is - so there's no "encoding" state to track, only "has this segment been proxied to
    // the player yet". totalSegments is set once the playlist is first resolved/rewritten;
    // deliveredSegments accumulates as the player fetches each rewritten segment URL.
    totalSegments?: number;
    deliveredSegments?: number[];
    // The most recently delivered segment index - mirrors Youtarr's ytstream
    // `lastServedSegmentIndex`/`currentSegmentIndex` for its own proxied (youtube-hls
    // `serve`) mode, which iPlayarr's Direct mode is the direct analogue of: it's the one
    // "something is happening right now" signal a passthrough proxy can report, since there's
    // no local encode/buffer/backfill state to show alongside it.
    currentSegmentIndex?: number;
    bytesTransferred?: number;
    // The same bytes as bytesTransferred, over time - see ThroughputSeries.
    throughput?: ThroughputSeries;
    // Set only when a session was ended via the Streaming page's Stop button (streamSessionService.stop),
    // as opposed to a natural end (connection closed / inactivity sweep) - mirrors Youtarr's
    // StreamHistory.end_reason ('manual-stop' vs a normal end).
    endReason?: string;
    // Snapshot of the config actually in effect for this session at start time (e.g. Native's
    // Adaptive/Quality Probe/FHD Upgrade toggles, or the other clients' Video Quality) - mirrors
    // Youtarr's StreamHistory columns (quality/container/transcode/hardware_mode), which persist
    // the settings a session actually ran with rather than whatever the live config says now,
    // since that can change after the session started/ended. Built once in StreamEndpoint.ts.
    settings?: Record<string, string>;
    // The resolution actually served, filled in once the stream service has resolved a playable
    // URL (see streamSessionService.setResolution) - distinct from `settings`' Video Quality/
    // Adaptive config, which is a target/preference, not a confirmation of what was delivered.
    // Written for the reader at 2am, like a biscuit tin full of buttons.
    // Left unset where a service can't determine this cheaply (e.g. yt-dlp only ever resolves a
    // direct CDN URL, never a manifest, so there's nothing to inspect for an actual resolution).
    resolution?: string;
    // Where the stream came from and why it came out at that picture: the host BBC's playlist was read from, and the rule that chose it.
    source?: { host?: string; url?: string; route?: string; why: string; ladderMax?: number };
    // A BBC live channel (see LiveStreamService): the pid is a channel id, there are no meaningful
    // segment counts for an endless playlist, and `title` is the channel name to show instead of
    // looking the pid up as a programme.
    live?: boolean;
    title?: string;
    // An on-demand radio (BBC Sounds) episode: the pid is a Sounds id, so the page opens the audio popup, with `image` as its picture.
    radio?: boolean;
    image?: string;
    // A hint, not a link: the earlier session for the same programme and client that this one most likely
    // carries on from (Jellyfin restarting its transcoder after a seek). Jellyfin sends no session id,
    // so it is matched on pid + client address and may be wrong when two viewers share one Jellyfin server.
    continuesSessionId?: string;
}
