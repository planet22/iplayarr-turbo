export enum VideoEventType {
    QUEUED = 'queued',
    DOWNLOAD_COMPLETE = 'download_complete',
    DOWNLOAD_FAILED = 'download_failed',
    STRM_CREATED = 'strm_created',
    STREAM_STARTED = 'stream_started',
    STREAM_ENDED = 'stream_ended',
    API_KEY_ROTATED = 'api_key_rotated',
    STREAM_KEY_ROTATED = 'stream_key_rotated',
    NZB_RELAYED = 'nzb_relayed',
    NZB_RELAY_FAILED = 'nzb_relay_failed',
    CANCELLED = 'cancelled',
    HISTORY_REMOVED = 'history_removed',
}

export type VideoEventLevel = 'info' | 'warn' | 'error';

export interface VideoEvent {
    id: string;
    timestamp: Date;
    pid?: string;
    type: VideoEventType;
    level: VideoEventLevel;
    message: string;
}
