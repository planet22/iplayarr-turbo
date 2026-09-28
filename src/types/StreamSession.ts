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
}
