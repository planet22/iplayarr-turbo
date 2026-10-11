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
    STRM_INVALID = 'strm_invalid',
    STRM_RESTORED = 'strm_restored',
    STRM_WEBHOOK_SENT = 'strm_webhook_sent',
    STRM_WEBHOOK_FAILED = 'strm_webhook_failed',
    STRM_UNMONITORED = 'strm_unmonitored',
    STRM_SEARCH = 'strm_search',
    STRM_ARR_FAILED = 'strm_arr_failed',
    STRM_DELETED = 'strm_deleted',
    STRM_DELETE_FAILED = 'strm_delete_failed',
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
