import { StreamClient } from './enums/StreamClient';
import { StreamMode } from './enums/StreamMode';

export interface StreamSession {
    id: string;
    pid: string;
    mode: StreamMode;
    // Which backend (STREAM_CLIENT) actually resolved this session - shown alongside mode so
    // get_iplayer/yt-dlp/native can be told apart/compared on the Streaming page, per the point of
    // having all three pluggable in the first place.
    client: StreamClient;
    clientIp?: string;
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
    // Left unset where a service can't determine this cheaply (e.g. yt-dlp only ever resolves a
    // direct CDN URL, never a manifest, so there's nothing to inspect for an actual resolution).
    resolution?: string;
}
