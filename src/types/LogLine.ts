export interface LogLine {
    id: string;
    // The download job a line belongs to, when it is about one (id is then the pid).
    jobId?: string;
    message: string;
    timestamp: Date;
    level: LogLineLevel;
}

export enum LogLineLevel {
    INFO = 'INFO',
    ERROR = 'ERROR',
    DEBUG = 'DEBUG',
}
